export type EntraAuthConfig = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  sessionSecret: Uint8Array;
  allowedOrigins: ReadonlySet<string>;
  sessionSeconds: number;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function required(env: Record<string, string | undefined>, name: string) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required for Entra authentication`);
  return value;
}

function decodeBase64Url(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("ENTRA_AUTH_SESSION_SECRET must be base64url encoded");
  }
  const padded = value.replace(/-/g, "+").replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  try {
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new Error("ENTRA_AUTH_SESSION_SECRET must be base64url encoded");
  }
}

function parseAllowedOrigins(value: string) {
  const origins = value.split(",").map((item) => item.trim()).filter(Boolean).map((item) => {
    const url = new URL(item);
    if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
      throw new Error("ENTRA_AUTH_ALLOWED_ORIGINS must contain origins only");
    }
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
      throw new Error("ENTRA_AUTH_ALLOWED_ORIGINS must use HTTPS outside local development");
    }
    return url.origin;
  });
  if (origins.length === 0) throw new Error("ENTRA_AUTH_ALLOWED_ORIGINS must contain at least one origin");
  return new Set(origins);
}

export function loadEntraAuthConfig(
  env: Record<string, string | undefined>,
): EntraAuthConfig {
  const tenantId = required(env, "ENTRA_AUTH_TENANT_ID");
  const clientId = required(env, "ENTRA_AUTH_CLIENT_ID");
  if (!UUID_PATTERN.test(tenantId)) throw new Error("ENTRA_AUTH_TENANT_ID must be a UUID");
  if (!UUID_PATTERN.test(clientId)) throw new Error("ENTRA_AUTH_CLIENT_ID must be a UUID");
  const clientSecret = required(env, "ENTRA_AUTH_CLIENT_SECRET");
  if (clientSecret.length < 16) throw new Error("ENTRA_AUTH_CLIENT_SECRET is too short");
  const sessionSecret = decodeBase64Url(required(env, "ENTRA_AUTH_SESSION_SECRET"));
  if (sessionSecret.byteLength !== 32) {
    throw new Error("ENTRA_AUTH_SESSION_SECRET must decode to exactly 32 bytes");
  }
  const sessionHours = Number(env.ENTRA_AUTH_SESSION_HOURS ?? "8");
  if (!Number.isInteger(sessionHours) || sessionHours < 1 || sessionHours > 24) {
    throw new Error("ENTRA_AUTH_SESSION_HOURS must be an integer from 1 to 24");
  }
  return {
    tenantId: tenantId.toLocaleLowerCase(),
    clientId: clientId.toLocaleLowerCase(),
    clientSecret,
    sessionSecret,
    allowedOrigins: parseAllowedOrigins(required(env, "ENTRA_AUTH_ALLOWED_ORIGINS")),
    sessionSeconds: sessionHours * 60 * 60,
  };
}

export function resolveAllowedRequestOrigin(request: Request, config: EntraAuthConfig) {
  const origin = new URL(request.url).origin;
  if (!config.allowedOrigins.has(origin)) throw new Error("Request origin is not allowed for Entra authentication");
  return origin;
}

export function validateMutationOrigin(request: Request, config: EntraAuthConfig) {
  const requestOrigin = resolveAllowedRequestOrigin(request, config);
  const origin = request.headers.get("origin");
  if (origin && origin !== requestOrigin) throw new Error("Mutation origin does not match the application origin");
}
