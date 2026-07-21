import "server-only";

import type { AppCapability, ScanStatus } from "../domain/types";
import type { GovernancePrincipalContext } from "../domain/types";
import { demoPersonas } from "../fixtures/data";
import { fetchReportFromApi } from "./api-client";
import { loadReportCacheConfig } from "./cache-config";
import {
  buildReport,
  ReportAuthorizationError,
  type DemoScenario,
  type ReportData,
  type ReportFilters,
  type ReportRequest,
} from "./report-service";
import { loadReportSource } from "./report-source";

export type RawSearchParams = Record<string, string | string[] | undefined>;
export type AuthenticatedReportIdentity = GovernancePrincipalContext & { capability: AppCapability };

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function parseReportRequest(
  params: RawSearchParams,
  defaultUserUpn = "nipaporn@contoso.com",
) {
  const scenarioValues: DemoScenario[] = ["current", "partial", "stale", "no-scan", "cache-error"];
  const statusValues: ScanStatus[] = ["success", "no-label", "unsupported", "locked", "throttled", "failed"];
  const scenarioValue = single(params.scenario) as DemoScenario | undefined;
  const statusValue = single(params.status) as ScanStatus | undefined;
  const capabilityValue = single(params.capability);
  const freshnessValue = single(params.freshness);
  const filters: ReportFilters = {
    nodeId: single(params.node) || undefined,
    siteId: single(params.site) || undefined,
    library: single(params.library) || undefined,
    labelId: single(params.label) || undefined,
    search: single(params.q) || undefined,
    scanStatus: statusValue && statusValues.includes(statusValue) ? statusValue : undefined,
    freshness:
      freshnessValue === "current" || freshnessValue === "stale"
        ? freshnessValue
        : undefined,
    page: Number(single(params.page) ?? "1") || 1,
    pageSize: 6,
  };
  return {
    userUpn: single(params.user) ?? defaultUserUpn,
    capability: (capabilityValue === "ReportViewer" ? "ReportViewer" : "ReportAdmin") as AppCapability,
    scenario:
      scenarioValue && scenarioValues.includes(scenarioValue) ? scenarioValue : "current",
    filters,
  };
}

export async function loadReportPage(
  params: RawSearchParams,
  identity?: AuthenticatedReportIdentity,
): Promise<ReportData> {
  const cacheConfig = loadReportCacheConfig(process.env);
  const defaultUserUpn = cacheConfig.mode === "azure-api" ? identity?.userUpn : undefined;
  const parsed = parseReportRequest(params, defaultUserUpn);
  if (cacheConfig.mode === "azure-api") {
    if (!identity) throw new ReportAuthorizationError("An authenticated Entra identity is required");
    return fetchReportFromApi(
      cacheConfig,
      {
        ...parsed,
        userUpn: identity.userUpn,
        principalContext: identity,
        capability: identity.capability,
        scenario: "current",
      },
    );
  }
  const request: ReportRequest = cacheConfig.mode === "azure-table"
    ? { ...parsed, scenario: "current" }
    : parsed;
  if (request.scenario === "cache-error") throw new Error("Fixture cache unavailable");
  return buildReport(await loadReportSource(request, cacheConfig), request);
}

export async function getDemoOptions() {
  return structuredClone(demoPersonas);
}

export function getReportMode() {
  return loadReportCacheConfig(process.env).mode;
}

export async function buildScopedCsv(params: RawSearchParams): Promise<string> {
  const cacheConfig = loadReportCacheConfig(process.env);
  if (cacheConfig.mode === "azure-api") {
    throw new ReportAuthorizationError("Export is disabled for the read-only API pilot");
  }
  const parsed = parseReportRequest(params);
  const request: ReportRequest = cacheConfig.mode === "azure-table"
    ? { ...parsed, scenario: "current" }
    : parsed;
  if (request.capability !== "ReportAdmin") {
    throw new ReportAuthorizationError("Export requires ReportAdmin");
  }
  const source = await loadReportSource(
    { ...request, filters: { ...request.filters, page: 1, pageSize: 50 } },
    cacheConfig,
  );
  const fullReport = buildReport(
    source,
    { ...request, filters: { ...request.filters, page: 1, pageSize: 50 } },
  );
  if (fullReport.detailsRequireSiteSelection) {
    throw new ReportAuthorizationError("Select one authorized Site before exporting a large scope");
  }
  const header = [
    "File name",
    "File path",
    "Site",
    "Site ID",
    "Library",
    "Label ID",
    "Label",
    "Assignment method",
    "Scan status",
    "Scanned at",
  ];
  const rows = fullReport.rows.map((item) => {
    const label = item.sensitivityLabels.find((candidate) =>
      source.reportableLabelIds.has(candidate.id),
    );
    return [
      item.fileName,
      item.filePath,
      item.siteName,
      item.siteId,
      item.libraryName,
      label?.id ?? "",
      label?.displayName ?? "",
      label?.assignmentMethod ?? "",
      item.scanStatus,
      item.scannedAt,
    ];
  });
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

function csvCell(value: string): string {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
