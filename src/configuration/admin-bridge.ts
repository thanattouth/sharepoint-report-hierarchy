import type {
  SiteMappingChange,
  SiteMappingInboxPage,
  SiteMappingInboxStatus,
  SiteMappingPreview,
} from "./site-mapping";

export type SiteMappingNodeOption = {
  id: string;
  type: "EVP" | "Department" | "Group" | "Project";
  name: string;
  breadcrumb: string;
};

export type SiteMappingInboxResponse = SiteMappingInboxPage & {
  nodes: SiteMappingNodeOption[];
  capabilities: {
    preview: true;
    apply: false;
    applyReason: "authenticated-administrator-required";
  };
};

export type ConfigurationAdminBridgeConfig = {
  baseUrl: string;
  functionKey: string;
  actor: string;
  timeoutMs: number;
};

const UPN_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STATUS_VALUES = new Set<SiteMappingInboxStatus>([
  "all",
  "mapped",
  "unmapped",
  "inactive",
]);

function required(env: Record<string, string | undefined>, name: string) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the Configuration Admin bridge`);
  return value;
}

export function loadConfigurationAdminBridgeConfig(
  env: Record<string, string | undefined>,
): ConfigurationAdminBridgeConfig {
  const baseUrl = new URL(required(env, "CONFIG_ADMIN_API_BASE_URL"));
  if (baseUrl.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(baseUrl.hostname)) {
    throw new Error("CONFIG_ADMIN_API_BASE_URL must use HTTPS outside local development");
  }
  if (baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
    throw new Error("CONFIG_ADMIN_API_BASE_URL must not contain credentials, a query, or a fragment");
  }
  const actor = required(env, "CONFIG_ADMIN_BRIDGE_ACTOR").toLocaleLowerCase();
  if (!UPN_PATTERN.test(actor)) throw new Error("CONFIG_ADMIN_BRIDGE_ACTOR must be a UPN");
  const timeoutMs = Number(env.CONFIG_ADMIN_API_TIMEOUT_MS ?? "10000");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30000) {
    throw new Error("CONFIG_ADMIN_API_TIMEOUT_MS must be an integer from 1000 to 30000");
  }
  return {
    baseUrl: baseUrl.toString().replace(/\/$/, ""),
    functionKey: required(env, "CONFIG_ADMIN_API_FUNCTION_KEY"),
    actor,
    timeoutMs,
  };
}

export function parseSiteMappingInboxQuery(url: string) {
  const params = new URL(url).searchParams;
  const rawStatus = params.get("status")?.trim() || "all";
  if (!STATUS_VALUES.has(rawStatus as SiteMappingInboxStatus)) {
    throw new Error("status is invalid");
  }
  const query = params.get("q")?.trim() ?? "";
  if (query.length > 200) throw new Error("q is too long");
  const page = boundedInteger(params.get("page"), 1, 1, 100_000, "page");
  const pageSize = boundedInteger(params.get("pageSize"), 25, 1, 50, "pageSize");
  return { status: rawStatus as SiteMappingInboxStatus, query, page, pageSize };
}

function boundedInteger(
  value: string | null,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string,
) {
  if (!value) return fallback;
  const result = Number(value);
  if (!Number.isInteger(result) || result < minimum || result > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return result;
}

async function callConfigurationAdminApi(
  config: ConfigurationAdminBridgeConfig,
  path: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
) {
  const response = await fetchImpl(`${config.baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-configuration-actor": config.actor,
      "x-functions-key": config.functionKey,
    },
    redirect: "manual",
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  if (response.status >= 300 && response.status < 400) {
    throw new Error("Configuration Admin API redirects are not allowed");
  }
  return response;
}

function isNodeOption(value: unknown): value is SiteMappingNodeOption {
  if (!value || typeof value !== "object") return false;
  const node = value as Partial<SiteMappingNodeOption>;
  return typeof node.id === "string"
    && typeof node.name === "string"
    && typeof node.breadcrumb === "string"
    && ["EVP", "Department", "Group", "Project"].includes(node.type ?? "");
}

function isInboxResponse(value: unknown): value is Omit<SiteMappingInboxResponse, "capabilities"> {
  if (!value || typeof value !== "object") return false;
  const inbox = value as Partial<SiteMappingInboxResponse>;
  return Array.isArray(inbox.rows)
    && inbox.rows.every((row) => row
      && typeof row.siteId === "string"
      && typeof row.siteName === "string"
      && typeof row.siteUrl === "string"
      && ["mapped", "unmapped", "inactive"].includes(row.status)
      && Number.isInteger(row.version))
    && Array.isArray(inbox.nodes)
    && inbox.nodes.every(isNodeOption)
    && Number.isInteger(inbox.total)
    && Number.isInteger(inbox.page)
    && Number.isInteger(inbox.pageSize)
    && Number.isInteger(inbox.pageCount);
}

export async function fetchSiteMappingInbox(
  config: ConfigurationAdminBridgeConfig,
  input: ReturnType<typeof parseSiteMappingInboxQuery>,
  fetchImpl: typeof fetch = fetch,
): Promise<SiteMappingInboxResponse> {
  const params = new URLSearchParams({
    status: input.status,
    q: input.query,
    page: String(input.page),
    pageSize: String(input.pageSize),
  });
  const response = await callConfigurationAdminApi(
    config,
    `/configuration/site-mappings?${params.toString()}`,
    { method: "GET" },
    fetchImpl,
  );
  if (!response.ok) throw new Error(`Configuration Admin API returned HTTP ${response.status}`);
  const body: unknown = await response.json();
  if (!isInboxResponse(body)) throw new Error("Configuration Admin API returned an invalid inbox");
  return {
    ...body,
    capabilities: {
      preview: true,
      apply: false,
      applyReason: "authenticated-administrator-required",
    },
  };
}

function isPreview(value: unknown): value is SiteMappingPreview {
  if (!value || typeof value !== "object") return false;
  const preview = value as Partial<SiteMappingPreview>;
  return typeof preview.targetNodeId === "string"
    && typeof preview.targetBreadcrumb === "string"
    && Number.isInteger(preview.selectedSiteCount)
    && Number.isInteger(preview.newAssignments)
    && Number.isInteger(preview.moves)
    && Number.isInteger(preview.unchanged)
    && Array.isArray(preview.affectedPrincipals);
}

export async function fetchSiteMappingPreview(
  config: ConfigurationAdminBridgeConfig,
  input: { targetNodeId: string; changes: SiteMappingChange[] },
  fetchImpl: typeof fetch = fetch,
): Promise<SiteMappingPreview> {
  const response = await callConfigurationAdminApi(
    config,
    "/configuration/site-mappings/preview",
    { method: "POST", body: JSON.stringify(input) },
    fetchImpl,
  );
  if (response.status === 409) throw new Error("Site mapping changed; refresh and preview again");
  if (!response.ok) throw new Error(`Configuration Admin API returned HTTP ${response.status}`);
  const body: unknown = await response.json();
  if (!isPreview(body)) throw new Error("Configuration Admin API returned an invalid preview");
  return body;
}
