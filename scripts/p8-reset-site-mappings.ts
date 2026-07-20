import { buildSiteMappingInbox, deactivateSiteMappingChanges } from "../src/configuration/site-mapping";
import { createAzureTableCredential } from "../src/stores/azure-table/auth";
import { loadAzureTableStoreConfig } from "../src/stores/azure-table/config";
import { createAzureTableStores } from "../src/stores/azure-table/stores";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function expectedCount() {
  const argument = process.argv.find((value) => value.startsWith("--confirm-active-count="));
  if (!argument) return undefined;
  const value = Number(argument.split("=", 2)[1]);
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    throw new Error("--confirm-active-count must be an integer from 0 to 100");
  }
  return value;
}

const apply = process.argv.includes("--apply");
const tenantId = required("REPORT_CACHE_TENANT_ID");
const actor = required("CONFIG_ADMIN_ALLOWED_ACTORS").split(",")[0]?.trim().toLocaleLowerCase();
if (!actor) throw new Error("CONFIG_ADMIN_ALLOWED_ACTORS has no actor");
const config = loadAzureTableStoreConfig(process.env);
const stores = createAzureTableStores({
  config: {
    ...config,
    siteMappingTableName: "HierarchySitePlacements",
    siteMappingAuditTableName: "HierarchySiteMappingAudit",
  },
  credential: createAzureTableCredential(config.auth),
  tenantId,
});
const [sites, mappings] = await Promise.all([
  stores.siteStore.listActive(),
  stores.siteMappingStore.listAll(),
]);
const activeMappings = mappings.filter((mapping) => mapping.active);
const plan = {
  mode: apply ? "apply" : "dry-run",
  activeRegistrySites: sites.length,
  totalCanonicalPlacementRows: mappings.length,
  activeMappingsToDeactivate: activeMappings.length,
  alreadyUnmappedRegistrySites: sites.length - activeMappings.length,
};
if (!apply) {
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  process.exit(0);
}
const confirmation = expectedCount();
if (confirmation === undefined || confirmation !== activeMappings.length) {
  throw new Error(
    `Refusing reset: pass --confirm-active-count=${activeMappings.length} after reviewing the dry-run`,
  );
}
const saved = activeMappings.length === 0 ? [] : await deactivateSiteMappingChanges({
  siteIds: activeMappings.map((mapping) => mapping.siteId),
  actor,
  mappingStore: stores.siteMappingStore,
  auditStore: stores.siteMappingAuditStore,
});
const [verifiedMappings, verifiedSites] = await Promise.all([
  stores.siteMappingStore.listAll(),
  stores.siteStore.listActive(),
]);
const inbox = buildSiteMappingInbox(verifiedSites, await stores.hierarchyNodeStore.listAll(), verifiedMappings);
const mapped = inbox.filter((row) => row.status === "mapped");
const unmapped = inbox.filter((row) => row.status === "unmapped");
if (saved.length !== activeMappings.length
  || verifiedMappings.filter((mapping) => mapping.active).length !== 0
  || mapped.length !== 0
  || unmapped.length !== verifiedSites.length) {
  throw new Error("Bulk unmap verification failed");
}
process.stdout.write(`${JSON.stringify({
  ...plan,
  status: "completed",
  deactivatedMappings: saved.length,
  verifiedMappedSites: mapped.length,
  verifiedUnmappedActiveSites: unmapped.length,
}, null, 2)}\n`);
