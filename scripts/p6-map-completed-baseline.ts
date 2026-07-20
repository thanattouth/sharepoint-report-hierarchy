import { loadGraphPilotConfig } from "../src/scanner/graph/config";
import { createAzureTableCredential } from "../src/stores/azure-table/auth";
import { loadAzureTableStoreConfig } from "../src/stores/azure-table/config";
import { createAzureTableStores } from "../src/stores/azure-table/stores";

if (process.argv[2] !== "--apply") throw new Error("Expected explicit --apply");
const nodeId = process.env.REPORT_PILOT_SITE_NODE_ID?.trim();
if (!nodeId) throw new Error("REPORT_PILOT_SITE_NODE_ID is required");
const wave = Number(process.env.P6_REPORT_BASELINE_WAVE ?? "1");
const expectedSiteCount = Number(process.env.P6_EXPECTED_COMPLETED_WAVE_SITE_COUNT);
if (!Number.isInteger(wave) || wave < 1) throw new Error("P6_REPORT_BASELINE_WAVE is invalid");
if (!Number.isInteger(expectedSiteCount) || expectedSiteCount < 1 || expectedSiteCount > 10) {
  throw new Error("P6_EXPECTED_COMPLETED_WAVE_SITE_COUNT must be an integer from 1 to 10");
}
const graphConfig = loadGraphPilotConfig(process.env);
const tableConfig = loadAzureTableStoreConfig(process.env);
const stores = createAzureTableStores({
  config: tableConfig,
  credential: createAzureTableCredential(tableConfig.auth),
  tenantId: graphConfig.tenantId,
});
const waveSites = await stores.siteStore.listByBaselineWave(wave);
const completedSites = waveSites.filter((site) =>
  site.active && site.scanEnabled && site.baselineState === "completed");
const skippedSites = waveSites.filter((site) =>
  !site.active && !site.scanEnabled && site.baselineState === "skipped");
if (completedSites.length !== expectedSiteCount
  || completedSites.length + skippedSites.length !== waveSites.length) {
  throw new Error("Baseline wave is not in the expected completed/skipped state");
}
const existing = await stores.siteMappingStore.listActive();
const existingBySite = new Map(existing.map((mapping) => [mapping.siteId, mapping]));
for (const site of completedSites) {
  const current = existingBySite.get(site.id);
  if (current && current.nodeId !== nodeId) {
    throw new Error("A completed Site already has another active business mapping");
  }
}
let savedMappingCount = 0;
for (const site of completedSites) {
  if (existingBySite.get(site.id)?.nodeId === nodeId) continue;
  await stores.siteMappingStore.save({ nodeId, siteId: site.id, active: true });
  savedMappingCount += 1;
}
process.stdout.write(`${JSON.stringify({
  status: "mapped",
  wave,
  completedSiteCount: completedSites.length,
  skippedSiteCount: skippedSites.length,
  savedMappingCount,
})}\n`);
