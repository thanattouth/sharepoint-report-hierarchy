import { baselineRunId } from "../src/scanner/scheduled/job";
import { loadGraphPilotConfig } from "../src/scanner/graph/config";
import { createAzureTableCredential } from "../src/stores/azure-table/auth";
import { loadAzureTableStoreConfig } from "../src/stores/azure-table/config";
import { createAzureTableStores } from "../src/stores/azure-table/stores";

const rawIds = process.env.P5_BASELINE_WAVE_ONE_SITE_IDS_JSON?.trim();
if (!rawIds) throw new Error("P5_BASELINE_WAVE_ONE_SITE_IDS_JSON is required");
let parsed: unknown;
try {
  parsed = JSON.parse(rawIds);
} catch {
  throw new Error("P5_BASELINE_WAVE_ONE_SITE_IDS_JSON must be valid JSON");
}
if (!Array.isArray(parsed)
  || parsed.length < 1
  || parsed.length > 10
  || parsed.some((value) => typeof value !== "string" || !value.trim())
  || new Set(parsed).size !== parsed.length) {
  throw new Error("Wave 1 audit requires 1 to 10 unique non-empty Site IDs");
}
const expectedSiteIds = new Set(parsed as string[]);
const graphConfig = loadGraphPilotConfig(process.env);
const tableConfig = loadAzureTableStoreConfig(process.env);
const stores = createAzureTableStores({
  config: tableConfig,
  credential: createAzureTableCredential(tableConfig.auth),
  tenantId: graphConfig.tenantId,
});
const sites = await stores.siteStore.listByBaselineWave(1);
if (sites.length !== expectedSiteIds.size || sites.some((site) => !expectedSiteIds.has(site.id))) {
  throw new Error("Stored Wave 1 Sites do not match the exact approved scope");
}
const runs = await Promise.all(sites.map((site) =>
  stores.scanRunStore.get(baselineRunId({ wave: 1, siteId: site.id }))));
for (let index = 0; index < runs.length; index += 1) {
  const run = runs[index];
  if (run && (run.targetSiteIds.length !== 1 || run.targetSiteIds[0] !== sites[index].id)) {
    throw new Error("Baseline run target does not match its deterministic Site");
  }
}
const runStatusCounts: Record<string, number> = { missing: 0 };
for (const run of runs) {
  const status = run?.status ?? "missing";
  runStatusCounts[status] = (runStatusCounts[status] ?? 0) + 1;
}
const totals = runs.filter((run) => run !== null).reduce((current, run) => ({
  scannedCount: current.scannedCount + run.scannedCount,
  sensitiveCount: current.sensitiveCount + run.sensitiveCount,
  noLabelCount: current.noLabelCount + run.noLabelCount,
  lockedCount: current.lockedCount + run.lockedCount,
  throttledCount: current.throttledCount + run.throttledCount,
  unsupportedCount: current.unsupportedCount + run.unsupportedCount,
  failedCount: current.failedCount + run.failedCount,
}), {
  scannedCount: 0,
  sensitiveCount: 0,
  noLabelCount: 0,
  lockedCount: 0,
  throttledCount: 0,
  unsupportedCount: 0,
  failedCount: 0,
});
const inventory = await stores.inventoryStore.listCurrentBySiteIds(sites.map((site) => site.id));
const inventoryStatusCounts: Record<string, number> = {};
const observedLabelIds = new Set<string>();
let reportableLabeledItemCount = 0;
for (const item of inventory) {
  inventoryStatusCounts[item.scanStatus] = (inventoryStatusCounts[item.scanStatus] ?? 0) + 1;
  for (const label of item.sensitivityLabels) observedLabelIds.add(label.id);
  if (item.sensitivityLabels.some((label) => graphConfig.reportableLabelIds.has(label.id))) {
    reportableLabeledItemCount += 1;
  }
}
const summaries = await stores.siteSummaryStore.listBySiteIds(sites.map((site) => site.id));
const driveIds = sites.flatMap((site) => site.scanLibraryIds ?? []);
const deltaStates = await Promise.all(driveIds.map((driveId) => stores.deltaStateStore.get(driveId)));

process.stdout.write(`${JSON.stringify({
  wave: 1,
  siteCount: sites.length,
  libraryCount: driveIds.length,
  runStatusCounts,
  ...totals,
  inventoryCount: inventory.length,
  inventoryStatusCounts,
  labeledItemCount: inventory.filter((item) => item.sensitivityLabels.length > 0).length,
  observedLabelIdCount: observedLabelIds.size,
  reportableLabeledItemCount,
  summaryCount: summaries.length,
  deltaCursorCount: deltaStates.filter(Boolean).length,
})}\n`);
