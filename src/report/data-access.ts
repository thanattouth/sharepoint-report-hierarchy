import "server-only";

import type { AppCapability, ScanStatus } from "../domain/types";
import { REPORTABLE_LABEL_IDS, demoPersonas } from "../fixtures/data";
import {
  FixtureHierarchyStore,
  FixtureInventoryStore,
  FixtureScanRunStore,
} from "../stores/fixture-store";
import {
  buildReport,
  ReportAuthorizationError,
  type DemoScenario,
  type ReportData,
  type ReportFilters,
} from "./report-service";

const hierarchyStore = new FixtureHierarchyStore();
const inventoryStore = new FixtureInventoryStore();
const scanRunStore = new FixtureScanRunStore();

export type RawSearchParams = Record<string, string | string[] | undefined>;

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function parseReportRequest(params: RawSearchParams) {
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
    userUpn: single(params.user) ?? "nipaporn@contoso.com",
    capability: (capabilityValue === "ReportViewer" ? "ReportViewer" : "ReportAdmin") as AppCapability,
    scenario:
      scenarioValue && scenarioValues.includes(scenarioValue) ? scenarioValue : "current",
    filters,
  };
}

export async function loadReportPage(params: RawSearchParams): Promise<ReportData> {
  const request = parseReportRequest(params);
  if (request.scenario === "cache-error") throw new Error("Fixture cache unavailable");
  const [nodes, assignments, sites, siteMappings, runs] = await Promise.all([
    hierarchyStore.getNodes(),
    hierarchyStore.getAssignments(),
    hierarchyStore.getSites(),
    hierarchyStore.getSiteMappings(),
    scanRunStore.listRecent(),
  ]);
  const inventory = await inventoryStore.listCurrentBySiteIds(
    sites.filter((site) => site.active).map((site) => site.id),
  );
  return buildReport(
    { nodes, assignments, sites, siteMappings, inventory, runs, reportableLabelIds: REPORTABLE_LABEL_IDS },
    request,
  );
}

export async function getDemoOptions() {
  return structuredClone(demoPersonas);
}

export async function buildScopedCsv(params: RawSearchParams): Promise<string> {
  const request = parseReportRequest(params);
  if (request.capability !== "ReportAdmin") {
    throw new ReportAuthorizationError("Export requires ReportAdmin");
  }
  const report = await loadReportPage({ ...params, page: "1" });
  const [nodes, assignments, sites, siteMappings, inventory, runs] = await Promise.all([
    hierarchyStore.getNodes(),
    hierarchyStore.getAssignments(),
    hierarchyStore.getSites(),
    hierarchyStore.getSiteMappings(),
    inventoryStore.listCurrentBySiteIds(report.allowedSiteIds),
    scanRunStore.listRecent(),
  ]);
  const fullReport = buildReport(
    { nodes, assignments, sites, siteMappings, inventory, runs, reportableLabelIds: REPORTABLE_LABEL_IDS },
    { ...request, filters: { ...request.filters, page: 1, pageSize: 50 } },
  );
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
    const label = item.sensitivityLabels.find((candidate) => REPORTABLE_LABEL_IDS.has(candidate.id));
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
