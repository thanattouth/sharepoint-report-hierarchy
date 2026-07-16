import { resolveHierarchyScope } from "../domain/hierarchy";
import type {
  GovernedSharePointSite,
  GovernanceHierarchySiteMapping,
} from "../domain/types";
import { REPORTABLE_LABEL_IDS } from "../fixtures/data";
import {
  FixtureHierarchyStore,
  FixtureInventoryStore,
  FixtureScanRunStore,
} from "../stores/fixture-store";
import type { ReportCacheConfig } from "./cache-config";
import {
  ReportAuthorizationError,
  type ReportRequest,
  type ReportSource,
} from "./report-service";

const hierarchyStore = new FixtureHierarchyStore();
const fixtureInventoryStore = new FixtureInventoryStore();
const fixtureScanRunStore = new FixtureScanRunStore();

export async function loadReportSource(
  request: ReportRequest,
  cacheConfig: ReportCacheConfig,
): Promise<ReportSource> {
  const [nodes, assignments] = await Promise.all([
    hierarchyStore.getNodes(),
    hierarchyStore.getAssignments(),
  ]);
  if (cacheConfig.mode === "fixture") {
    const [sites, siteMappings, runs] = await Promise.all([
      hierarchyStore.getSites(),
      hierarchyStore.getSiteMappings(),
      fixtureScanRunStore.listRecent(),
    ]);
    const inventory = await fixtureInventoryStore.listCurrentBySiteIds(
      sites.filter((site) => site.active).map((site) => site.id),
    );
    return {
      nodes,
      assignments,
      sites,
      siteMappings,
      inventory,
      runs,
      reportableLabelIds: REPORTABLE_LABEL_IDS,
    };
  }
  if (cacheConfig.mode !== "azure-table") {
    throw new Error("Azure API mode must be loaded through the server-side API client");
  }

  const [{ createAzureTableCredential }, { createAzureTableStores }] = await Promise.all([
    import("../stores/azure-table/auth"),
    import("../stores/azure-table/stores"),
  ]);
  const stores = createAzureTableStores({
    config: cacheConfig.table,
    credential: createAzureTableCredential(cacheConfig.table.auth),
    tenantId: cacheConfig.cacheTenantId,
  });
  let sites: GovernedSharePointSite[];
  let siteMappings: GovernanceHierarchySiteMapping[];
  if (cacheConfig.siteSource === "mapping-table") {
    siteMappings = await stores.siteMappingStore.listActive();
    const siteIds = [...new Set(siteMappings.map((mapping) => mapping.siteId))];
    const resolvedSites = await Promise.all(siteIds.map((siteId) => stores.siteStore.get(siteId)));
    if (resolvedSites.some((site) => !site || !site.active)) {
      throw new Error("An active hierarchy mapping references a missing or inactive Site");
    }
    sites = resolvedSites.filter((site) => site !== null);
  } else {
    if (!nodes.some((node) => node.id === cacheConfig.pilotSiteNodeId && node.active)) {
      throw new Error("REPORT_PILOT_SITE_NODE_ID must reference an active hierarchy node");
    }
    sites = [cacheConfig.pilotSite];
    siteMappings = [{
      nodeId: cacheConfig.pilotSiteNodeId,
      siteId: cacheConfig.pilotSite.id,
      active: true,
    }];
  }
  const scope = resolveHierarchyScope(
    request.userUpn,
    nodes,
    assignments,
    sites,
    siteMappings,
  );
  const base: ReportSource = {
    nodes,
    assignments,
    sites,
    siteMappings,
    inventory: [],
    runs: [],
    reportableLabelIds: cacheConfig.reportableLabelIds,
    siteSummaries: [],
    inventoryCoverage: "scope",
    now: new Date(),
    nextScheduledScan: cacheConfig.nextScheduledScan,
  };
  if (request.filters.siteId && !scope.allowedSiteIds.includes(request.filters.siteId)) {
    throw new ReportAuthorizationError();
  }
  if (request.filters.nodeId && !scope.visibleNodeIds.includes(request.filters.nodeId)) {
    throw new ReportAuthorizationError();
  }
  if (scope.allowedSiteIds.length === 0 || request.scenario === "no-scan") return base;

  const selectedSiteId = request.filters.siteId;
  const inventoryCoverage = selectedSiteId && scope.allowedSiteIds.length > 1
    ? "selected-site"
    : !selectedSiteId && scope.allowedSiteIds.length > cacheConfig.maxDetailSites
      ? "selected-site"
      : "scope";
  const detailSiteIds = selectedSiteId
    ? [selectedSiteId]
    : inventoryCoverage === "scope"
      ? scope.allowedSiteIds
      : [];
  const [siteSummaries, runs, inventory] = await Promise.all([
    stores.siteSummaryStore.listBySiteIds(scope.allowedSiteIds),
    stores.scanRunStore.listRecent(),
    stores.inventoryStore.listCurrentBySiteIds(detailSiteIds),
  ]);
  return {
    ...base,
    inventory,
    runs,
    siteSummaries,
    inventoryCoverage,
  };
}
