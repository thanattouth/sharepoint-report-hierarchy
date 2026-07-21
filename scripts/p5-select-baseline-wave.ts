import { configureBaselineWaveCandidates } from "../src/scanner/scheduled/baseline-rollout";
import { loadGraphPilotConfig } from "../src/scanner/graph/config";
import { createAzureTableCredential } from "../src/stores/azure-table/auth";
import { loadAzureTableStoreConfig } from "../src/stores/azure-table/config";
import { createAzureTableStores } from "../src/stores/azure-table/stores";

if (process.argv[2] !== "--apply") throw new Error("Expected explicit --apply");
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
  throw new Error("Wave 1 selection requires 1 to 10 unique non-empty Site IDs");
}

const graphConfig = loadGraphPilotConfig(process.env);
const tableConfig = loadAzureTableStoreConfig(process.env);
const stores = createAzureTableStores({
  config: tableConfig,
  credential: createAzureTableCredential(tableConfig.auth),
  tenantId: graphConfig.tenantId,
});
const result = await configureBaselineWaveCandidates({
  siteStore: stores.siteStore,
  wave: 1,
  siteIds: parsed as string[],
  exclusionReason: "controlled-visibility-wave",
});
process.stdout.write(`${JSON.stringify({ status: "selected", ...result })}\n`);
