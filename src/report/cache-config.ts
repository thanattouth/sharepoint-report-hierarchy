import type { GovernedSharePointSite } from "../domain/types";
import {
  loadAzureTableStoreConfig,
  type AzureTableStoreConfig,
} from "../stores/azure-table/config";

type FixtureReportCacheConfig = {
  mode: "fixture";
};

export type AzureApiReportCacheConfig = {
  mode: "azure-api";
  baseUrl: string;
  functionKey: string;
  timeoutMs: number;
};

export type AzureReportCacheConfig = {
  mode: "azure-table";
  hierarchySource: "fixture" | "table";
  siteSource: "single-site" | "mapping-table";
  cacheTenantId: string;
  reportableLabelIds: Set<string>;
  pilotSite: GovernedSharePointSite;
  pilotSiteNodeId: string;
  maxDetailSites: number;
  nextScheduledScan?: string;
  table: AzureTableStoreConfig;
};

export type ReportCacheConfig =
  | FixtureReportCacheConfig
  | AzureApiReportCacheConfig
  | AzureReportCacheConfig;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HOSTNAME_PATTERN = /^(?=.{1,253}$)(?!-)[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i;

function required(env: Record<string, string | undefined>, name: string) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required for Azure report cache mode`);
  return value;
}

function uuid(value: string, name: string) {
  if (!UUID_PATTERN.test(value)) throw new Error(`${name} must be a UUID`);
  return value;
}

export function loadReportCacheConfig(
  env: Record<string, string | undefined>,
): ReportCacheConfig {
  const mode = env.REPORT_DATA_SOURCE?.trim() || "fixture";
  if (mode === "fixture") return { mode };
  if (mode === "azure-api") {
    const baseUrl = new URL(required(env, "REPORT_API_BASE_URL"));
    if (baseUrl.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(baseUrl.hostname)) {
      throw new Error("REPORT_API_BASE_URL must use HTTPS outside local development");
    }
    if (baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
      throw new Error("REPORT_API_BASE_URL must not contain credentials, a query, or a fragment");
    }
    const timeoutMs = Number(env.REPORT_API_TIMEOUT_MS ?? "10000");
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30000) {
      throw new Error("REPORT_API_TIMEOUT_MS must be an integer from 1000 to 30000");
    }
    return {
      mode,
      baseUrl: baseUrl.toString().replace(/\/$/, ""),
      functionKey: required(env, "REPORT_API_FUNCTION_KEY"),
      timeoutMs,
    };
  }
  if (mode !== "azure-table") {
    throw new Error("REPORT_DATA_SOURCE must be fixture, azure-api, or azure-table");
  }

  const hostname = required(env, "REPORT_PILOT_SITE_HOSTNAME");
  const path = required(env, "REPORT_PILOT_SITE_PATH");
  if (!HOSTNAME_PATTERN.test(hostname)) throw new Error("REPORT_PILOT_SITE_HOSTNAME is invalid");
  if (!path.startsWith("/") || path.includes("..")) {
    throw new Error("REPORT_PILOT_SITE_PATH is invalid");
  }
  const maxDetailSites = Number(env.REPORT_MAX_DETAIL_SITES ?? "25");
  if (!Number.isInteger(maxDetailSites) || maxDetailSites < 1 || maxDetailSites > 100) {
    throw new Error("REPORT_MAX_DETAIL_SITES must be an integer from 1 to 100");
  }
  const nextScheduledScan = env.REPORT_NEXT_SCHEDULED_SCAN?.trim();
  if (nextScheduledScan && Number.isNaN(Date.parse(nextScheduledScan))) {
    throw new Error("REPORT_NEXT_SCHEDULED_SCAN must be an ISO-compatible timestamp");
  }
  const siteSource = env.REPORT_SITE_SOURCE?.trim() || "single-site";
  if (siteSource !== "single-site" && siteSource !== "mapping-table") {
    throw new Error("REPORT_SITE_SOURCE must be single-site or mapping-table");
  }
  const hierarchySource = env.REPORT_HIERARCHY_SOURCE?.trim() || "fixture";
  if (hierarchySource !== "fixture" && hierarchySource !== "table") {
    throw new Error("REPORT_HIERARCHY_SOURCE must be fixture or table");
  }

  return {
    mode,
    hierarchySource,
    siteSource,
    cacheTenantId: uuid(
      required(env, "REPORT_CACHE_TENANT_ID"),
      "REPORT_CACHE_TENANT_ID",
    ),
    reportableLabelIds: new Set(
      required(env, "REPORT_REPORTABLE_LABEL_IDS")
        .split(",")
        .map((id) => uuid(id.trim(), "REPORT_REPORTABLE_LABEL_IDS")),
    ),
    pilotSite: {
      id: required(env, "REPORT_PILOT_SITE_ID"),
      name: required(env, "REPORT_PILOT_SITE_NAME"),
      hostname,
      path,
      active: true,
      scanEnabled: true,
    },
    pilotSiteNodeId: required(env, "REPORT_PILOT_SITE_NODE_ID"),
    maxDetailSites,
    nextScheduledScan,
    table: loadAzureTableStoreConfig(env),
  };
}
