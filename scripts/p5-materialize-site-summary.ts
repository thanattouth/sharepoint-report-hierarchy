import { buildSiteSensitivitySummary } from "../src/domain/site-summary";
import { loadGraphPilotConfig } from "../src/scanner/graph/config";
import { createAzureTableCredential } from "../src/stores/azure-table/auth";
import { loadAzureTableStoreConfig } from "../src/stores/azure-table/config";
import { createAzureTableStores } from "../src/stores/azure-table/stores";

const graphConfig = loadGraphPilotConfig(process.env);
const tableConfig = loadAzureTableStoreConfig(process.env);
const credential = createAzureTableCredential(tableConfig.auth);
const { inventoryStore, scanRunStore, siteSummaryStore } = createAzureTableStores({
  config: tableConfig,
  credential,
  tenantId: graphConfig.tenantId,
});

const items = await inventoryStore.listCurrentBySiteIds([graphConfig.allowedSiteId]);
if (items.length === 0) throw new Error("Cannot materialize a Site summary without inventory");
const runs = await scanRunStore.listRecent();
const latestRun = runs.find((run) =>
  run.targetSiteIds.includes(graphConfig.allowedSiteId)
    && ["succeeded", "partial"].includes(run.status),
);
const updatedAt = new Date().toISOString();
const summary = buildSiteSensitivitySummary({
  tenantId: graphConfig.tenantId,
  siteId: graphConfig.allowedSiteId,
  siteName: items[0].siteName,
  siteWebUrl: items[0].siteWebUrl,
  items,
  reportableLabelIds: graphConfig.reportableLabelIds,
  latestRunId: latestRun?.id,
  updatedAt,
});
await siteSummaryStore.save(summary);
const persisted = await siteSummaryStore.listBySiteIds([graphConfig.allowedSiteId]);
if (persisted.length !== 1) throw new Error("Site summary round-trip did not return exactly one row");

process.stdout.write(`${JSON.stringify({
  status: "materialized",
  siteId: summary.siteId,
  latestRunId: summary.latestRunId,
  inventoryCount: summary.inventoryCount,
  sensitiveCount: summary.sensitiveCount,
  libraryCount: summary.libraryCount,
  statusCounts: summary.statusCounts,
  labelCounts: summary.labelCounts.map(({ id, count }) => ({ id, count })),
}, null, 2)}\n`);
