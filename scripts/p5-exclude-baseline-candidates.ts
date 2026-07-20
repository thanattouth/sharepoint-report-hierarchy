import { excludeBaselineCandidates } from "../src/scanner/scheduled/baseline-rollout";
import { loadGraphPilotConfig } from "../src/scanner/graph/config";
import { createAzureTableCredential } from "../src/stores/azure-table/auth";
import { loadAzureTableStoreConfig } from "../src/stores/azure-table/config";
import { createAzureTableStores } from "../src/stores/azure-table/stores";

if (process.argv[2] !== "--apply") throw new Error("Expected explicit --apply");
const rawIds = process.env.P5_BASELINE_EXCLUDE_SITE_IDS_JSON?.trim();
if (!rawIds) throw new Error("P5_BASELINE_EXCLUDE_SITE_IDS_JSON is required");
let parsed: unknown;
try {
  parsed = JSON.parse(rawIds);
} catch {
  throw new Error("P5_BASELINE_EXCLUDE_SITE_IDS_JSON must be valid JSON");
}
if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== "string")) {
  throw new Error("P5_BASELINE_EXCLUDE_SITE_IDS_JSON must be a JSON string array");
}
const graphConfig = loadGraphPilotConfig(process.env);
const tableConfig = loadAzureTableStoreConfig(process.env);
const stores = createAzureTableStores({
  config: tableConfig,
  credential: createAzureTableCredential(tableConfig.auth),
  tenantId: graphConfig.tenantId,
});
const result = await excludeBaselineCandidates({
  siteStore: stores.siteStore,
  siteIds: parsed,
  reason: "operator-review",
});
process.stdout.write(`${JSON.stringify({ status: "excluded", ...result })}\n`);
