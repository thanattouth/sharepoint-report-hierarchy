export type GraphPilotAuthConfig =
  | {
      mode: "default";
      managedIdentityClientId?: string;
    }
  | {
      mode: "client-secret";
      tenantId: string;
      clientId: string;
      clientSecret: string;
    };

export type GraphPilotConfig = {
  tenantId: string;
  allowedSiteId: string;
  reportableLabelIds: Set<string>;
  reportableLabelNames: Map<string, string>;
  maxConcurrency: number;
  maxRetries: number;
  auth: GraphPilotAuthConfig;
};

export class ScannerConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScannerConfigurationError";
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SITE_ID_PATTERN = /^[A-Za-z0-9,._=-]+$/;

function required(env: Record<string, string | undefined>, name: string) {
  const value = env[name]?.trim();
  if (!value) throw new ScannerConfigurationError(`${name} is required`);
  return value;
}

function uuid(value: string, name: string) {
  if (!UUID_PATTERN.test(value)) throw new ScannerConfigurationError(`${name} must be a UUID`);
  return value;
}

function boundedInteger(value: string | undefined, fallback: number, min: number, max: number, name: string) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new ScannerConfigurationError(`${name} must be an integer from ${min} to ${max}`);
  }
  return parsed;
}

function reportableLabelNames(
  value: string | undefined,
  reportableLabelIds: Set<string>,
): Map<string, string> {
  if (!value?.trim()) return new Map();
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new ScannerConfigurationError("SCANNER_LABEL_DISPLAY_NAMES_JSON must be valid JSON");
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new ScannerConfigurationError("SCANNER_LABEL_DISPLAY_NAMES_JSON must be a JSON object");
  }
  const result = new Map<string, string>();
  for (const [id, name] of Object.entries(parsed)) {
    uuid(id, "SCANNER_LABEL_DISPLAY_NAMES_JSON key");
    if (!reportableLabelIds.has(id)) {
      throw new ScannerConfigurationError(
        "SCANNER_LABEL_DISPLAY_NAMES_JSON contains a label outside SCANNER_REPORTABLE_LABEL_IDS",
      );
    }
    if (typeof name !== "string" || !name.trim()) {
      throw new ScannerConfigurationError(
        "SCANNER_LABEL_DISPLAY_NAMES_JSON values must be non-empty strings",
      );
    }
    result.set(id, name.trim());
  }
  return result;
}

export function loadGraphPilotConfig(env: Record<string, string | undefined>): GraphPilotConfig {
  const tenantId = uuid(required(env, "SCANNER_TENANT_ID"), "SCANNER_TENANT_ID");
  const allowedSiteId = required(env, "SCANNER_ALLOWED_SITE_ID");
  if (!SITE_ID_PATTERN.test(allowedSiteId)) {
    throw new ScannerConfigurationError("SCANNER_ALLOWED_SITE_ID has an invalid Graph site ID format");
  }

  const reportableLabelIds = new Set(
    required(env, "SCANNER_REPORTABLE_LABEL_IDS")
      .split(",")
      .map((value) => uuid(value.trim(), "SCANNER_REPORTABLE_LABEL_IDS")),
  );
  const labelNames = reportableLabelNames(
    env.SCANNER_LABEL_DISPLAY_NAMES_JSON,
    reportableLabelIds,
  );
  const mode = env.SCANNER_AUTH_MODE?.trim() || "default";
  if (!(["default", "client-secret"] as const).includes(mode as "default" | "client-secret")) {
    throw new ScannerConfigurationError("SCANNER_AUTH_MODE must be default or client-secret");
  }

  const auth: GraphPilotAuthConfig = mode === "client-secret"
    ? {
        mode,
        tenantId,
        clientId: uuid(required(env, "SCANNER_CLIENT_ID"), "SCANNER_CLIENT_ID"),
        clientSecret: required(env, "SCANNER_CLIENT_SECRET"),
      }
    : {
        mode: "default",
        managedIdentityClientId: env.SCANNER_MANAGED_IDENTITY_CLIENT_ID
          ? uuid(env.SCANNER_MANAGED_IDENTITY_CLIENT_ID.trim(), "SCANNER_MANAGED_IDENTITY_CLIENT_ID")
          : undefined,
      };

  return {
    tenantId,
    allowedSiteId,
    reportableLabelIds,
    reportableLabelNames: labelNames,
    maxConcurrency: boundedInteger(env.SCANNER_MAX_CONCURRENCY, 4, 1, 16, "SCANNER_MAX_CONCURRENCY"),
    maxRetries: boundedInteger(env.SCANNER_MAX_RETRIES, 3, 0, 8, "SCANNER_MAX_RETRIES"),
    auth,
  };
}
