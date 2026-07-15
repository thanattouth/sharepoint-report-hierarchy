import type { GovernedSharePointSite } from "../domain/types";
import {
  loadAzureTableStoreConfig,
  type AzureTableStoreConfig,
} from "../stores/azure-table/config";

type FixtureReportCacheConfig = {
  mode: "fixture";
};

export type AzureReportCacheConfig = {
  mode: "azure-table";
  cacheTenantId: string;
  reportableLabelIds: Set<string>;
  pilotSite: GovernedSharePointSite;
  pilotSiteNodeId: string;
  maxDetailSites: number;
  nextScheduledScan?: string;
  table: AzureTableStoreConfig;
};

export type ReportCacheConfig = FixtureReportCacheConfig | AzureReportCacheConfig;

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
  if (mode !== "azure-table") {
    throw new Error("REPORT_DATA_SOURCE must be fixture or azure-table");
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

  return {
    mode,
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
