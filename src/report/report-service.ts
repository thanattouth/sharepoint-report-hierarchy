import { resolveHierarchyScope, siteIdsUnderNode } from "../domain/hierarchy";
import type {
  AppCapability,
  GovernedSharePointSite,
  GovernanceHierarchyAssignment,
  GovernanceHierarchyNode,
  GovernanceHierarchySiteMapping,
  ScanStatus,
  SensitivityInventoryItem,
  SensitivityScanRun,
} from "../domain/types";
import { stableFileKey } from "../domain/types";

export type DemoScenario =
  | "current"
  | "partial"
  | "stale"
  | "no-scan"
  | "cache-error";

export type ReportFilters = {
  nodeId?: string;
  siteId?: string;
  library?: string;
  labelId?: string;
  search?: string;
  scanStatus?: ScanStatus;
  freshness?: "current" | "stale";
  page?: number;
  pageSize?: number;
};

export type ReportRequest = {
  userUpn: string;
  capability: AppCapability;
  scenario: DemoScenario;
  filters: ReportFilters;
};

export type ReportData = {
  state: "ready" | "no-assignment" | "no-sites" | "no-scan" | "zero-sensitive";
  userUpn: string;
  capability: AppCapability;
  assignedNodeIds: string[];
  visibleNodeIds: string[];
  allowedSiteIds: string[];
  scopeSensitiveCount: number;
  filteredSensitiveCount: number;
  siteCount: number;
  libraryCount: number;
  rows: SensitivityInventoryItem[];
  page: number;
  pageSize: number;
  pageCount: number;
  hierarchyRollups: Array<{
    nodeId: string;
    parentId?: string;
    name: string;
    type: GovernanceHierarchyNode["type"];
    depth: number;
    count: number;
    siteCount: number;
    childCount: number;
  }>;
  siteRollups: Array<{
    siteId: string;
    siteName: string;
    webUrl: string;
    nodeId: string;
    nodeName: string;
    count: number;
    lastScannedAt?: string;
    scanState: "current" | "stale" | "attention" | "never-scanned";
  }>;
  libraryRollups: Array<{
    siteId: string;
    siteName: string;
    libraryName: string;
    count: number;
  }>;
  options: {
    nodes: Array<{ id: string; name: string; type: GovernanceHierarchyNode["type"] }>;
    sites: Array<{ id: string; name: string }>;
    libraries: string[];
    labels: Array<{ id: string; name: string }>;
  };
  statusCounts: Record<ScanStatus, number>;
  latestRun?: SensitivityScanRun;
  lastSuccessfulScan?: string;
  nextScheduledScan?: string;
  freshness: "current" | "stale" | "partial" | "unknown";
};

export class ReportAuthorizationError extends Error {
  constructor(message = "The requested scope is not authorized") {
    super(message);
    this.name = "ReportAuthorizationError";
  }
}

type ReportSource = {
  nodes: GovernanceHierarchyNode[];
  assignments: GovernanceHierarchyAssignment[];
  sites: GovernedSharePointSite[];
  siteMappings: GovernanceHierarchySiteMapping[];
  inventory: SensitivityInventoryItem[];
  runs: SensitivityScanRun[];
  reportableLabelIds: Set<string>;
};

const STATUS_VALUES: ScanStatus[] = [
  "success",
  "no-label",
  "unsupported",
  "locked",
  "throttled",
  "failed",
];

export function buildReport(source: ReportSource, request: ReportRequest): ReportData {
  if (!request.userUpn || !["ReportAdmin", "ReportViewer"].includes(request.capability)) {
    throw new ReportAuthorizationError("A valid capability and UPN are required");
  }

  const scope = resolveHierarchyScope(
    request.userUpn,
    source.nodes,
    source.assignments,
    source.sites,
    source.siteMappings,
  );
  const pageSize = Math.min(Math.max(request.filters.pageSize ?? 6, 1), 50);
  const requestedPage = Math.max(request.filters.page ?? 1, 1);

  const emptyBase = {
    userUpn: request.userUpn,
    capability: request.capability,
    assignedNodeIds: scope.assignedNodeIds,
    visibleNodeIds: scope.visibleNodeIds,
    allowedSiteIds: scope.allowedSiteIds,
    scopeSensitiveCount: 0,
    filteredSensitiveCount: 0,
    siteCount: scope.allowedSiteIds.length,
    libraryCount: 0,
    rows: [],
    page: 1,
    pageSize,
    pageCount: 1,
    hierarchyRollups: [],
    siteRollups: [],
    libraryRollups: [],
    options: { nodes: [], sites: [], libraries: [], labels: [] },
    statusCounts: Object.fromEntries(STATUS_VALUES.map((status) => [status, 0])) as Record<
      ScanStatus,
      number
    >,
    freshness: "unknown" as const,
  };

  if (scope.assignedNodeIds.length === 0) {
    return { state: "no-assignment", ...emptyBase };
  }
  if (scope.allowedSiteIds.length === 0) return { state: "no-sites", ...emptyBase };
  if (request.scenario === "no-scan") {
    return { state: "no-scan", ...emptyBase };
  }

  const allowedSites = new Set(scope.allowedSiteIds);
  const scopedInventory = source.inventory.filter(
    (item) => allowedSites.has(item.siteId) && !item.deletedAt,
  );
  const statusCounts = Object.fromEntries(
    STATUS_VALUES.map((status) => [
      status,
      scopedInventory.filter((item) => item.scanStatus === status).length,
    ]),
  ) as Record<ScanStatus, number>;

  const isReportable = (item: SensitivityInventoryItem) =>
    item.sensitivityLabels.some((label) => source.reportableLabelIds.has(label.id));
  const sensitiveRows = dedupe(scopedInventory.filter(isReportable));
  const scopeSensitiveCount = sensitiveRows.length;

  let filtered = sensitiveRows;
  let explorerSiteIds = new Set(scope.allowedSiteIds);
  if (request.filters.nodeId) {
    if (!scope.visibleNodeIds.includes(request.filters.nodeId)) {
      throw new ReportAuthorizationError();
    }
    const nodeSites = new Set(
      siteIdsUnderNode(
        request.filters.nodeId,
        source.nodes,
        scope.visibleNodeIds,
        source.sites,
        source.siteMappings,
      ),
    );
    explorerSiteIds = nodeSites;
    filtered = filtered.filter((item) => nodeSites.has(item.siteId));
  }
  if (request.filters.siteId) {
    if (!allowedSites.has(request.filters.siteId)) throw new ReportAuthorizationError();
  }
  if (request.filters.library) {
    filtered = filtered.filter((item) => item.libraryName === request.filters.library);
  }
  if (request.filters.labelId) {
    filtered = filtered.filter((item) =>
      item.sensitivityLabels.some((label) =>
        label.id === request.filters.labelId && source.reportableLabelIds.has(label.id),
      ),
    );
  }
  if (request.filters.search?.trim()) {
    const query = request.filters.search.trim().toLocaleLowerCase();
    filtered = filtered.filter((item) =>
      [item.fileName, item.filePath, item.siteName, item.libraryName].some((value) =>
        value.toLocaleLowerCase().includes(query),
      ),
    );
  }
  if (request.filters.scanStatus) {
    filtered = filtered.filter((item) => item.scanStatus === request.filters.scanStatus);
  }

  const effectiveNow = new Date(
    request.scenario === "stale" ? "2026-07-18T08:00:00Z" : "2026-07-14T08:00:00Z",
  );
  const isFreshTimestamp = (value: string) =>
    effectiveNow.getTime() - new Date(value).getTime() <= 24 * 60 * 60 * 1000;
  const isFresh = (item: SensitivityInventoryItem) => isFreshTimestamp(item.scannedAt);
  if (request.filters.freshness) {
    filtered = filtered.filter((item) =>
      request.filters.freshness === "current" ? isFresh(item) : !isFresh(item),
    );
  }

  const siteFacetRows = filtered;
  if (request.filters.siteId) {
    filtered = filtered.filter((item) => item.siteId === request.filters.siteId);
  }

  filtered = [...filtered].sort(
    (a, b) =>
      a.siteName.localeCompare(b.siteName) || a.fileName.localeCompare(b.fileName),
  );
  const filteredSensitiveCount = filtered.length;
  const pageCount = Math.max(Math.ceil(filteredSensitiveCount / pageSize), 1);
  const page = Math.min(requestedPage, pageCount);
  const rows = filtered.slice((page - 1) * pageSize, page * pageSize);

  const nodeDepth = (nodeId: string): number => {
    const byId = new Map(source.nodes.map((node) => [node.id, node]));
    let depth = 0;
    let current = byId.get(nodeId);
    while (current?.parentId) {
      depth += 1;
      current = byId.get(current.parentId);
    }
    return depth;
  };
  const visibleNodes = source.nodes.filter(
    (node) => node.active && scope.visibleNodeIds.includes(node.id),
  );
  const hierarchyRollups = visibleNodes.map((node) => {
    const siteIds = new Set(
      siteIdsUnderNode(
        node.id,
        source.nodes,
        scope.visibleNodeIds,
        source.sites,
        source.siteMappings,
      ),
    );
    return {
      nodeId: node.id,
      parentId: node.parentId,
      name: node.name,
      type: node.type,
      depth: nodeDepth(node.id),
      count: dedupe(filtered.filter((item) => siteIds.has(item.siteId))).length,
      siteCount: siteIds.size,
      childCount: visibleNodes.filter((candidate) => candidate.parentId === node.id).length,
    };
  });

  const libraryMap = new Map<
    string,
    { siteId: string; siteName: string; libraryName: string; items: SensitivityInventoryItem[] }
  >();
  for (const item of filtered) {
    const key = `${item.siteId}:${item.libraryName}`;
    const library = libraryMap.get(key) ?? {
      siteId: item.siteId,
      siteName: item.siteName,
      libraryName: item.libraryName,
      items: [],
    };
    library.items.push(item);
    libraryMap.set(key, library);
  }
  const visibleNodeById = new Map(visibleNodes.map((node) => [node.id, node]));
  const activeMappingBySite = new Map(
    source.siteMappings
      .filter((mapping) => mapping.active)
      .map((mapping) => [mapping.siteId, mapping]),
  );
  const siteRollups = source.sites
    .filter((site) => site.active && explorerSiteIds.has(site.id))
    .map((site) => {
      const siteItems = scopedInventory.filter((item) => item.siteId === site.id);
      const lastScannedAt = siteItems
        .map((item) => item.scannedAt)
        .sort((a, b) => b.localeCompare(a))[0];
      const hasAttention = siteItems.some((item) =>
        ["locked", "throttled", "failed"].includes(item.scanStatus),
      );
      const mapping = activeMappingBySite.get(site.id);
      const node = mapping ? visibleNodeById.get(mapping.nodeId) : undefined;
      const scanState = !lastScannedAt
        ? "never-scanned"
        : hasAttention
          ? "attention"
          : isFreshTimestamp(lastScannedAt)
            ? "current"
            : "stale";
      return {
        siteId: site.id,
        siteName: site.name,
        webUrl: `https://${site.hostname}${site.path}`,
        nodeId: mapping?.nodeId ?? "unmapped",
        nodeName: node?.name ?? "Unmapped",
        count: dedupe(siteFacetRows.filter((item) => item.siteId === site.id)).length,
        lastScannedAt,
        scanState,
      } as const;
    })
    .sort((a, b) => b.count - a.count || a.siteName.localeCompare(b.siteName));
  const libraryRollups = [...libraryMap.values()].map((value) => ({
    siteId: value.siteId,
    siteName: value.siteName,
    libraryName: value.libraryName,
    count: dedupe(value.items).length,
  }));

  const allLibraries = [...new Set(scopedInventory.map((item) => item.libraryName))].sort();
  const allLabels = [...new Map(
    sensitiveRows.flatMap((item) => item.sensitivityLabels)
      .filter((label) => source.reportableLabelIds.has(label.id))
      .map((label) => [label.id, { id: label.id, name: label.displayName ?? label.id }]),
  ).values()].sort((a, b) => a.name.localeCompare(b.name));
  const completedRun = source.runs.find((run) => run.status === "succeeded");
  const partialRun = source.runs.find((run) => run.status === "partial");
  const latestRun = request.scenario === "partial" ? partialRun : completedRun;
  const freshness = request.scenario === "partial" ? "partial" : request.scenario === "stale" ? "stale" : "current";

  return {
    state: scopeSensitiveCount === 0 ? "zero-sensitive" : "ready",
    userUpn: request.userUpn,
    capability: request.capability,
    assignedNodeIds: scope.assignedNodeIds,
    visibleNodeIds: scope.visibleNodeIds,
    allowedSiteIds: scope.allowedSiteIds,
    scopeSensitiveCount,
    filteredSensitiveCount,
    siteCount: scope.allowedSiteIds.length,
    libraryCount: new Set(scopedInventory.map((item) => `${item.siteId}:${item.libraryName}`)).size,
    rows,
    page,
    pageSize,
    pageCount,
    hierarchyRollups,
    siteRollups,
    libraryRollups,
    options: {
      nodes: visibleNodes.map((node) => ({ id: node.id, name: node.name, type: node.type })),
      sites: source.sites
        .filter((site) => site.active && allowedSites.has(site.id))
        .map((site) => ({ id: site.id, name: site.name })),
      libraries: allLibraries,
      labels: allLabels,
    },
    statusCounts,
    latestRun,
    lastSuccessfulScan: completedRun?.finishedAt,
    nextScheduledScan: "2026-07-15T01:00:00+07:00",
    freshness,
  };
}

function dedupe(items: SensitivityInventoryItem[]): SensitivityInventoryItem[] {
  return [...new Map(items.map((item) => [stableFileKey(item), item])).values()];
}
