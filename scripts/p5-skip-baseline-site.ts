import { skipBaselineSite } from "../src/scanner/scheduled/baseline-rollout";
import { loadGraphPilotConfig } from "../src/scanner/graph/config";
import { createAzureTableCredential } from "../src/stores/azure-table/auth";
import { loadAzureTableStoreConfig } from "../src/stores/azure-table/config";
import { createAzureTableStores } from "../src/stores/azure-table/stores";

if (process.argv[2] !== "--apply") throw new Error("Expected explicit --apply");
const siteId = process.env.P5_BASELINE_SKIP_SITE_ID?.trim();
if (!siteId) throw new Error("P5_BASELINE_SKIP_SITE_ID is required");
const wave = Number(process.env.P5_BASELINE_SKIP_WAVE ?? "1");
if (!Number.isInteger(wave) || wave < 1) throw new Error("P5_BASELINE_SKIP_WAVE is invalid");
const graphConfig = loadGraphPilotConfig(process.env);
const tableConfig = loadAzureTableStoreConfig(process.env);
const stores = createAzureTableStores({
  config: tableConfig,
  credential: createAzureTableCredential(tableConfig.auth),
  tenantId: graphConfig.tenantId,
});
const result = await skipBaselineSite({
  siteStore: stores.siteStore,
  scanRunStore: stores.scanRunStore,
  siteId,
  wave,
  reason: "operator-approved-problem-skip",
});
process.stdout.write(`${JSON.stringify({ status: "skipped", wave, ...result })}\n`);
