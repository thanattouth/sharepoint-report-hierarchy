import { hierarchyNodes } from "../src/fixtures/data";
import { loadGraphPilotConfig } from "../src/scanner/graph/config";
import { createAzureTableCredential } from "../src/stores/azure-table/auth";
import { loadAzureTableStoreConfig } from "../src/stores/azure-table/config";
import { createAzureTableStores } from "../src/stores/azure-table/stores";

function required(...names: string[]) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  throw new Error(`${names.join(" or ")} is required`);
}

if (process.argv[2] !== "--apply") throw new Error("Expected explicit --apply");
const siteId = required("P6_MAPPING_SITE_ID", "REPORT_PILOT_SITE_ID");
const nodeId = required("P6_MAPPING_NODE_ID", "REPORT_PILOT_SITE_NODE_ID");
const node = hierarchyNodes.find((candidate) => candidate.id === nodeId && candidate.active);
if (!node) throw new Error("P6_MAPPING_NODE_ID must reference an active hierarchy node");

const graphConfig = loadGraphPilotConfig(process.env);
const tableConfig = loadAzureTableStoreConfig(process.env);
const stores = createAzureTableStores({
  config: tableConfig,
  credential: createAzureTableCredential(tableConfig.auth),
  tenantId: graphConfig.tenantId,
});
const site = await stores.siteStore.get(siteId);
if (!site?.active) throw new Error("P6_MAPPING_SITE_ID must reference an active registered Site");

const existing = (await stores.siteMappingStore.listActive())
  .find((mapping) => mapping.siteId === siteId);
if (existing && existing.nodeId !== nodeId) {
  throw new Error("The Site already has another active canonical business placement");
}
if (!existing) {
  await stores.siteMappingStore.save({ nodeId, siteId, active: true });
}

process.stdout.write(`${JSON.stringify({
  status: existing ? "already-mapped" : "mapped",
  siteName: site.name,
  nodeId,
})}\n`);
