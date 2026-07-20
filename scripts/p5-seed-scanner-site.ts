import { loadGraphPilotConfig } from "../src/scanner/graph/config";
import { createAzureTableCredential } from "../src/stores/azure-table/auth";
import { loadAzureTableStoreConfig } from "../src/stores/azure-table/config";
import { createAzureTableStores } from "../src/stores/azure-table/stores";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const graphConfig = loadGraphPilotConfig(process.env);
const tableConfig = loadAzureTableStoreConfig(process.env);
const credential = createAzureTableCredential(tableConfig.auth);
const { siteStore } = createAzureTableStores({
  config: tableConfig,
  credential,
  tenantId: graphConfig.tenantId,
});
const site = {
  id: graphConfig.allowedSiteId,
  name: required("REPORT_PILOT_SITE_NAME"),
  hostname: required("REPORT_PILOT_SITE_HOSTNAME"),
  path: required("REPORT_PILOT_SITE_PATH"),
  active: true,
  scanEnabled: true,
};
await siteStore.save(site);
const saved = await siteStore.get(site.id);
if (!saved || !saved.active || !saved.scanEnabled) {
  throw new Error("Scanner Site registry verification failed");
}
process.stdout.write(`${JSON.stringify({
  status: "seeded",
  siteId: saved.id,
  active: saved.active,
  scanEnabled: saved.scanEnabled,
})}\n`);

