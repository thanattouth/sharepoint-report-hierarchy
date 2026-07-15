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

export function parseReportApiRequest(url: string, config: ReportApiConfig): ReportRequest {
  const params = new URL(url).searchParams;
  const userUpn = params.get("user")?.trim().toLocaleLowerCase();
  if (!userUpn) throw new ReportApiRequestError("user is required");
  if (!config.allowedPilotUpns.has(userUpn)) {
    throw new ReportApiRequestError("The requested pilot persona is not allowed");
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
    capability: "ReportViewer",
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
