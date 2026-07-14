export interface GraphAccessTokenProvider {
  getAccessToken(): Promise<string>;
}

export interface GraphLogger {
  info(event: string, details: Record<string, unknown>): void;
  warn(event: string, details: Record<string, unknown>): void;
}

export type GraphClientOptions = {
  tokenProvider: GraphAccessTokenProvider;
  fetch?: typeof fetch;
  logger?: GraphLogger;
  maxRetries?: number;
  maxRetryDelayMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
  baseUrl?: string;
};

type GraphErrorPayload = {
  error?: {
    code?: string;
    message?: string;
  };
};

const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);
const DEFAULT_BASE_URL = "https://graph.microsoft.com/v1.0/";

export class GraphRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly requestId?: string,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "GraphRequestError";
  }
}

function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(at - now, 0);
}

async function readGraphError(response: Response) {
  try {
    return await response.json() as GraphErrorPayload;
  } catch {
    return {} satisfies GraphErrorPayload;
  }
}

export class GraphClient {
  private readonly baseUrl: URL;
  private readonly fetchImpl: typeof fetch;
  private readonly logger?: GraphLogger;
  private readonly maxRetries: number;
  private readonly maxRetryDelayMs: number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly random: () => number;

  constructor(private readonly options: GraphClientOptions) {
    this.baseUrl = new URL(options.baseUrl ?? DEFAULT_BASE_URL);
    this.fetchImpl = options.fetch ?? fetch;
    this.logger = options.logger;
    this.maxRetries = options.maxRetries ?? 3;
    this.maxRetryDelayMs = options.maxRetryDelayMs ?? 60_000;
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.random = options.random ?? Math.random;
  }

  async request<T>(pathOrUrl: string, init: RequestInit = {}): Promise<T> {
    const url = this.resolveUrl(pathOrUrl);
    const method = init.method ?? "GET";

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const accessToken = await this.options.tokenProvider.getAccessToken();
      let response: Response;
      try {
        const headers = new Headers(init.headers);
        headers.set("accept", "application/json");
        headers.set("authorization", `Bearer ${accessToken}`);
        response = await this.fetchImpl(url, {
          ...init,
          headers,
        });
      } catch {
        if (attempt < this.maxRetries) {
          const delayMs = Math.min(1_000 * 2 ** attempt + Math.floor(this.random() * 250), this.maxRetryDelayMs);
          this.logger?.warn("graph.request.retry", {
            method,
            path: url.pathname,
            status: 0,
            code: "NETWORK_ERROR",
            attempt,
            delayMs,
          });
          await this.sleep(delayMs);
          continue;
        }
        throw new GraphRequestError("Microsoft Graph network request failed", 0, "NETWORK_ERROR");
      }

      if (response.ok) {
        this.logger?.info("graph.request.succeeded", {
          method,
          path: url.pathname,
          status: response.status,
          attempt,
          requestId: response.headers.get("request-id") ?? undefined,
        });
        if (response.status === 204) return undefined as T;
        return await response.json() as T;
      }

      const payload = await readGraphError(response);
      const code = payload.error?.code ?? `HTTP_${response.status}`;
      const requestId = response.headers.get("request-id") ?? undefined;
      const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
      const retryable = RETRYABLE_STATUSES.has(response.status);

      if (retryable && attempt < this.maxRetries) {
        const exponentialDelay = Math.min(1_000 * 2 ** attempt + Math.floor(this.random() * 250), this.maxRetryDelayMs);
        const delayMs = Math.min(retryAfterMs ?? exponentialDelay, this.maxRetryDelayMs);
        this.logger?.warn("graph.request.retry", {
          method,
          path: url.pathname,
          status: response.status,
          code,
          attempt,
          delayMs,
          requestId,
        });
        await this.sleep(delayMs);
        continue;
      }

      throw new GraphRequestError(
        payload.error?.message ?? `Microsoft Graph request failed with ${response.status}`,
        response.status,
        code,
        requestId,
        retryAfterMs,
      );
    }

    throw new Error("Microsoft Graph retry loop ended unexpectedly");
  }

  private resolveUrl(pathOrUrl: string) {
    const url = /^https:\/\//i.test(pathOrUrl)
      ? new URL(pathOrUrl)
      : new URL(pathOrUrl.replace(/^\//, ""), this.baseUrl);
    const basePath = this.baseUrl.pathname.endsWith("/") ? this.baseUrl.pathname : `${this.baseUrl.pathname}/`;
    if (url.origin !== this.baseUrl.origin || !url.pathname.startsWith(basePath)) {
      throw new Error("Refusing Microsoft Graph URL outside the configured v1.0 endpoint");
    }
    return url;
  }
}
