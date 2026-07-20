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
  || parsed.length !== 8
  || parsed.some((value) => typeof value !== "string" || !value.trim())
  || new Set(parsed).size !== parsed.length) {
  throw new Error("Wave 1 activation requires exactly 8 unique non-empty Site IDs");
}
const approvedSiteIds = new Set(parsed as string[]);
const graphConfig = loadGraphPilotConfig(process.env);
const tableConfig = loadAzureTableStoreConfig(process.env);
const stores = createAzureTableStores({
  config: tableConfig,
  credential: createAzureTableCredential(tableConfig.auth),
  tenantId: graphConfig.tenantId,
});

const waveSites = await stores.siteStore.listByBaselineWave(1);
if (waveSites.length !== approvedSiteIds.size
  || waveSites.some((site) => !approvedSiteIds.has(site.id))) {
  throw new Error("Stored Wave 1 Sites do not match the exact approved scope");
}
for (const site of waveSites) {
  const alreadyApproved = site.active && site.scanEnabled && site.baselineState === "approved";
  const safeLegacyOrCurrentCandidate = !site.active
    && !site.scanEnabled
    && (site.baselineState === undefined || site.baselineState === "candidate");
  if (!alreadyApproved && !safeLegacyOrCurrentCandidate) {
    throw new Error("Wave 1 contains a Site that is not a disabled candidate");
  }
  if (!site.scanLibraryIds?.length || new Set(site.scanLibraryIds).size !== site.scanLibraryIds.length) {
    throw new Error("Wave 1 Site has no valid exact scan-library allowlist");
  }
}

const pilot = await stores.siteStore.get(graphConfig.allowedSiteId);
if (!pilot || !pilot.active || !pilot.scanEnabled) {
  throw new Error("The bounded pilot Site is missing, inactive or disabled");
}
const pilotInventory = await stores.inventoryStore.listCurrentBySiteIds([pilot.id]);
const pilotDriveIds = new Set<string>();
for (const libraryName of graphConfig.allowedLibraryNames) {
  const driveIds = new Set(
    pilotInventory
      .filter((item) => item.libraryName === libraryName)
      .map((item) => item.driveId),
  );
  if (driveIds.size !== 1) {
    throw new Error("Pilot inventory cannot resolve one exact drive ID per approved library");
  }
  pilotDriveIds.add([...driveIds][0]);
}
if (pilotDriveIds.size !== graphConfig.allowedLibraryNames.size) {
  throw new Error("Pilot approved libraries resolve to duplicate drive IDs");
}

let changedSiteCount = 0;
const pilotAllowlist = [...pilotDriveIds].sort();
if (JSON.stringify([...(pilot.scanLibraryIds ?? [])].sort()) !== JSON.stringify(pilotAllowlist)
  || pilot.baselineState !== "completed") {
  await stores.siteStore.save({
    ...pilot,
    scanLibraryIds: pilotAllowlist,
    baselineState: "completed",
  });
  changedSiteCount += 1;
}
for (const site of waveSites) {
  if (site.active && site.scanEnabled && site.baselineState === "approved") continue;
  await stores.siteStore.save({
    ...site,
    active: true,
    scanEnabled: true,
    baselineState: "approved",
  });
  changedSiteCount += 1;
}
process.stdout.write(`${JSON.stringify({
  status: "activated",
  wave: 1,
  siteCount: waveSites.length,
  libraryCount: waveSites.reduce((total, site) => total + (site.scanLibraryIds?.length ?? 0), 0),
  pilotLibraryCount: pilotAllowlist.length,
  changedSiteCount,
})}\n`);
