import { TableServiceClient } from "@azure/data-tables";
import { validateHierarchyConfiguration } from "../src/domain/hierarchy";
import type { GovernanceHierarchyAssignment } from "../src/domain/types";
import { hierarchyAssignments, hierarchyNodes } from "../src/fixtures/data";
import { createAzureTableCredential } from "../src/stores/azure-table/auth";
import { loadAzureTableStoreConfig } from "../src/stores/azure-table/config";
import { createAzureTableStores } from "../src/stores/azure-table/stores";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function assignmentId(assignment: GovernanceHierarchyAssignment, index: number) {
  return assignment.id ?? [
    assignment.principalType ?? "User",
    assignment.principalObjectId ?? assignment.userUpn ?? "unknown",
    assignment.nodeId,
    index,
  ].join(":").toLowerCase();
}

async function ensureTable(service: TableServiceClient, name: string) {
  try {
    await service.createTable(name);
  } catch (error) {
    if (!error || typeof error !== "object" || !("statusCode" in error)
      || (error as { statusCode?: number }).statusCode !== 409) throw error;
  }
}

const apply = process.argv.includes("--apply");
const tenantId = required("REPORT_CACHE_TENANT_ID");
const baseConfig = loadAzureTableStoreConfig(process.env);
const credential = createAzureTableCredential(baseConfig.auth);
const legacyStores = createAzureTableStores({
  config: { ...baseConfig, siteMappingTableName: "HierarchySiteMappings" },
  credential,
  tenantId,
});
const targetConfig = {
  ...baseConfig,
  siteMappingTableName: "HierarchySitePlacements",
  hierarchyNodeTableName: "HierarchyNodes",
  scopeAssignmentTableName: "ScopeAssignments",
  siteMappingAuditTableName: "HierarchySiteMappingAudit",
};
const targetStores = createAzureTableStores({ config: targetConfig, credential, tenantId });
const [sites, legacyMappings] = await Promise.all([
  legacyStores.siteStore.listActive(),
  legacyStores.siteMappingStore.listActive(),
]);
const assignments = hierarchyAssignments.map((assignment, index) => ({
  ...assignment,
  id: assignmentId(assignment, index),
  principalType: assignment.principalType ?? "User" as const,
}));
validateHierarchyConfiguration(hierarchyNodes, assignments, sites, legacyMappings);
const duplicateSites = legacyMappings.filter((mapping, index) =>
  legacyMappings.findIndex((candidate) => candidate.siteId === mapping.siteId) !== index);
if (duplicateSites.length > 0) throw new Error("Legacy mapping contains duplicate active Site placements");

const plan = {
  mode: apply ? "apply" : "dry-run",
  hierarchyNodes: hierarchyNodes.length,
  scopeAssignments: assignments.length,
  sitePlacements: legacyMappings.length,
  tables: [
    targetConfig.hierarchyNodeTableName,
    targetConfig.scopeAssignmentTableName,
    targetConfig.siteMappingTableName,
    targetConfig.siteMappingAuditTableName,
  ],
};
if (!apply) {
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  process.exit(0);
}

const service = new TableServiceClient(baseConfig.endpoint, credential);
for (const table of plan.tables) await ensureTable(service, table);
for (const node of hierarchyNodes) await targetStores.hierarchyNodeStore.save(node);
for (const assignment of assignments) await targetStores.scopeAssignmentStore.save(assignment);
const migratedAt = new Date().toISOString();
for (const mapping of legacyMappings) {
  const current = await targetStores.siteMappingStore.get(mapping.siteId);
  if (current) continue;
  await targetStores.siteMappingStore.save({
    ...mapping,
    version: 1,
    updatedAt: migratedAt,
    updatedBy: "p7-configuration-migration",
  }, 0);
}
const [persistedNodes, persistedAssignments, persistedMappings] = await Promise.all([
  targetStores.hierarchyNodeStore.listAll(),
  targetStores.scopeAssignmentStore.listAll(),
  targetStores.siteMappingStore.listActive(),
]);
validateHierarchyConfiguration(persistedNodes, persistedAssignments, sites, persistedMappings);
if (persistedNodes.length !== hierarchyNodes.length
  || persistedAssignments.length !== assignments.length
  || persistedMappings.length !== legacyMappings.length) {
  throw new Error("Persistent configuration verification count mismatch");
}
process.stdout.write(`${JSON.stringify({
  ...plan,
  status: "completed",
  verified: {
    hierarchyNodes: persistedNodes.length,
    scopeAssignments: persistedAssignments.length,
    sitePlacements: persistedMappings.length,
  },
}, null, 2)}\n`);
