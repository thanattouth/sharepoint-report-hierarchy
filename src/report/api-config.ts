import type { ReportRequest } from "./report-service";

export class ReportApiRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportApiRequestError";
  }
}

export type ReportApiConfig = {
  allowedPilotUpns: Set<string>;
};

const UPN_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUS_VALUES = new Set([
  "success",
  "no-label",
  "unsupported",
  "locked",
  "throttled",
  "failed",
]);

function required(env: Record<string, string | undefined>, name: string) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the report API`);
  return value;
}

export function loadReportApiConfig(
  env: Record<string, string | undefined>,
): ReportApiConfig {
  const allowedPilotUpns = new Set(
    required(env, "REPORT_PILOT_ALLOWED_UPNS")
      .split(",")
      .map((value) => value.trim().toLocaleLowerCase())
      .filter(Boolean),
  );
  if (allowedPilotUpns.size === 0 || [...allowedPilotUpns].some((upn) => !UPN_PATTERN.test(upn))) {
    throw new Error("REPORT_PILOT_ALLOWED_UPNS must contain valid comma-separated UPNs");
  }
  return { allowedPilotUpns };
}

export function selectAllowedPilotPersonas<T extends { upn: string }>(
  personas: T[],
  config: ReportApiConfig,
): T[] {
  const byUpn = new Map(
    personas.map((persona) => [persona.upn.toLocaleLowerCase(), persona]),
  );
  return [...config.allowedPilotUpns].map((upn) => {
    const persona = byUpn.get(upn);
    if (!persona) {
      throw new Error(`Allowed pilot UPN ${upn} has no configured demo persona`);
    }
    return persona;
  });
}

function optional(value: string | null, maximum: number, name: string) {
  const result = value?.trim();
  if (!result) return undefined;
  if (result.length > maximum) throw new ReportApiRequestError(`${name} is too long`);
  return result;
}

function integer(value: string | null, fallback: number, minimum: number, maximum: number, name: string) {
  if (!value) return fallback;
  const result = Number(value);
  if (!Number.isInteger(result) || result < minimum || result > maximum) {
    throw new ReportApiRequestError(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return result;
}

export function parseReportApiRequest(
  url: string,
  config: ReportApiConfig,
  headers: Pick<Headers, "get"> = new Headers(),
): ReportRequest {
  const params = new URL(url).searchParams;
  const userUpn = headers.get("x-report-user-upn")?.trim().toLocaleLowerCase();
  if (!userUpn || !UPN_PATTERN.test(userUpn)) throw new ReportApiRequestError("verified user header is required");
  if (!config.allowedPilotUpns.has(userUpn)) {
    throw new ReportApiRequestError("The authenticated pilot user is not allowed");
  }
  const userObjectId = headers.get("x-report-user-object-id")?.trim().toLocaleLowerCase();
  if (!userObjectId || !UUID_PATTERN.test(userObjectId)) {
    throw new ReportApiRequestError("verified user object ID header is required");
  }
  const rawGroupIds = headers.get("x-report-group-object-ids") ?? "";
  if (rawGroupIds.length > 8_000) throw new ReportApiRequestError("group identity header is too long");
  const groupObjectIds = [...new Set(rawGroupIds.split(",").map((value) => value.trim().toLocaleLowerCase()).filter(Boolean))];
  if (groupObjectIds.length > 100 || groupObjectIds.some((id) => !UUID_PATTERN.test(id))) {
    throw new ReportApiRequestError("group identity header is invalid");
  }
  const capability = headers.get("x-report-capability");
  if (capability !== "ReportAdmin" && capability !== "ReportViewer") {
    throw new ReportApiRequestError("verified capability header is required");
  }
  const scanStatus = optional(params.get("status"), 32, "status");
  if (scanStatus && !STATUS_VALUES.has(scanStatus)) {
    throw new ReportApiRequestError("status is invalid");
  }
  const freshness = optional(params.get("freshness"), 16, "freshness");
  if (freshness && freshness !== "current" && freshness !== "stale") {
    throw new ReportApiRequestError("freshness is invalid");
  }

  return {
    userUpn,
    principalContext: { userUpn, userObjectId, groupObjectIds },
    capability,
    scenario: "current",
    filters: {
      nodeId: optional(params.get("node"), 256, "node"),
      siteId: optional(params.get("site"), 512, "site"),
      library: optional(params.get("library"), 256, "library"),
      labelId: optional(params.get("label"), 64, "label"),
      search: optional(params.get("q"), 200, "q"),
      scanStatus: scanStatus as ReportRequest["filters"]["scanStatus"],
      freshness: freshness as ReportRequest["filters"]["freshness"],
      page: integer(params.get("page"), 1, 1, 100_000, "page"),
      pageSize: integer(params.get("pageSize"), 25, 1, 50, "pageSize"),
    },
  };
}
