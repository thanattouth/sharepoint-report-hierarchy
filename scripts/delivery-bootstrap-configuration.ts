import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { loadCustomerDeliveryManifest } from "../src/delivery/manifest";
import { validateHierarchyConfiguration } from "../src/domain/hierarchy";
import type { GovernanceHierarchyAssignment, GovernanceHierarchyNode, GovernanceHierarchySiteMapping } from "../src/domain/types";
import { createAzureTableCredential } from "../src/stores/azure-table/auth";
import { loadAzureTableStoreConfig } from "../src/stores/azure-table/config";
import { createAzureTableStores } from "../src/stores/azure-table/stores";

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`Expected ${name} <value>`);
  return value;
}

function azJson<T>(args: string[]): T {
  const result = spawnSync("az", [...args, "--only-show-errors", "--output", "json"], { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.trim() || `az ${args[0]} failed`);
  return JSON.parse(result.stdout) as T;
}

function escapedOData(value: string): string {
  return value.replaceAll("'", "''");
}

function exactGroup(displayName: string): { id: string; displayName: string } {
  const groups = azJson<Array<{ id: string; displayName: string }>>([
    "ad", "group", "list",
    "--filter", `displayName eq '${escapedOData(displayName)}'`,
    "--query", "[].{id:id,displayName:displayName}",
  ]);
  if (groups.length !== 1) throw new Error(`Expected exactly one Entra group: ${displayName}`);
  return groups[0];
}

const manifest = loadCustomerDeliveryManifest(argument("--manifest"));
const workloads = manifest.workloads;
const businessScope = workloads?.businessScope;
if (!workloads || !businessScope) throw new Error("Delivery manifest does not contain workload businessScope configuration");
if (!process.argv.includes("--apply")) throw new Error("Expected --apply");
const account = azJson<{ tenantId: string; id: string }>(["account", "show", "--query", "{tenantId:tenantId,id:id}"]);
if (account.tenantId.toLowerCase() !== manifest.tenantId.toLowerCase()
  || account.id.toLowerCase() !== manifest.subscriptionId.toLowerCase()) {
  throw new Error("Azure CLI tenant/subscription does not match the delivery manifest");
}

const groups = businessScope.scopeGroups.map((group) => ({ ...group, ...exactGroup(group.displayName) }));
const config = loadAzureTableStoreConfig({
  ...process.env,
  AZURE_STORAGE_ACCOUNT_NAME: manifest.storageAccountName,
  AZURE_STORAGE_TENANT_ID: manifest.tenantId,
  AZURE_TABLE_AUTH_MODE: "azure-cli",
});
const credential = createAzureTableCredential(config.auth);
const stores = createAzureTableStores({ config, credential, tenantId: manifest.tenantId });
const now = new Date().toISOString();
const actor = `customer-delivery:${manifest.deploymentName}`;
const desiredSite = {
  id: workloads.bootstrapSite.id,
  name: workloads.bootstrapSite.name,
  hostname: workloads.bootstrapSite.hostname,
  path: workloads.bootstrapSite.path,
  active: true,
  scanEnabled: true,
};
const desiredNodes: GovernanceHierarchyNode[] = businessScope.nodes.map((node) => ({
  ...node,
  version: 1,
  updatedAt: now,
  updatedBy: actor,
}));
const desiredAssignments: GovernanceHierarchyAssignment[] = groups.map((group) => ({
  id: `group:${group.id}:${group.nodeId}`,
  principalType: "Group",
  principalObjectId: group.id.toLowerCase(),
  principalDisplayName: group.displayName,
  nodeId: group.nodeId,
  businessRole: group.businessRole,
  includeDescendants: group.includeDescendants,
  active: true,
  version: 1,
  updatedAt: now,
  updatedBy: actor,
}));
const desiredPlacement: GovernanceHierarchySiteMapping = {
  siteId: desiredSite.id,
  nodeId: workloads.bootstrapSite.businessNodeId,
  active: true,
  version: 1,
  updatedAt: now,
  updatedBy: actor,
};
validateHierarchyConfiguration(desiredNodes, desiredAssignments, [desiredSite], [desiredPlacement]);

const changes: string[] = [];
const existingSite = await stores.siteStore.get(desiredSite.id);
if (!existingSite) {
  await stores.siteStore.save(desiredSite);
  changes.push(`create-site:${desiredSite.name}`);
} else if (existingSite.name !== desiredSite.name || existingSite.hostname !== desiredSite.hostname
  || existingSite.path !== desiredSite.path || !existingSite.active || !existingSite.scanEnabled) {
  throw new Error(`Existing ScannerSites row conflicts with bootstrap Site: ${desiredSite.id}`);
}

for (const node of desiredNodes) {
  const existing = await stores.hierarchyNodeStore.get(node.id);
  if (!existing) {
    await stores.hierarchyNodeStore.save(node, 0);
    await stores.hierarchyConfigurationAuditStore.save({
      id: randomUUID(), entityType: "HierarchyNode", entityId: node.id, action: "created",
      actor, occurredAt: now, version: 1, summary: `Bootstrap ${node.type} ${node.name}`,
    });
    changes.push(`create-node:${node.id}`);
  } else if (existing.name !== node.name || existing.type !== node.type
    || existing.parentId !== node.parentId || existing.active !== node.active) {
    throw new Error(`Existing hierarchy node conflicts with bootstrap manifest: ${node.id}`);
  }
}

for (const assignment of desiredAssignments) {
  const existing = await stores.scopeAssignmentStore.get(assignment.id!);
  if (!existing) {
    await stores.scopeAssignmentStore.save(assignment, 0);
    await stores.hierarchyConfigurationAuditStore.save({
      id: randomUUID(), entityType: "ScopeAssignment", entityId: assignment.id!, action: "created",
      actor, occurredAt: now, version: 1, summary: `Bootstrap ${assignment.businessRole} ${assignment.principalDisplayName}`,
    });
    changes.push(`create-scope-assignment:${assignment.principalDisplayName}`);
  } else if (existing.principalObjectId?.toLowerCase() !== assignment.principalObjectId
    || existing.nodeId !== assignment.nodeId || existing.businessRole !== assignment.businessRole
    || existing.includeDescendants !== assignment.includeDescendants || !existing.active) {
    throw new Error(`Existing scope assignment conflicts with bootstrap manifest: ${assignment.id}`);
  }
}

const existingPlacement = await stores.siteMappingStore.get(desiredPlacement.siteId);
if (!existingPlacement) {
  await stores.siteMappingStore.save(desiredPlacement, 0);
  await stores.siteMappingAuditStore.save({
    id: randomUUID(), siteId: desiredPlacement.siteId, nodeId: desiredPlacement.nodeId,
    action: "assigned", actor, occurredAt: now, version: 1,
  });
  changes.push(`place-site:${desiredSite.name}:${desiredPlacement.nodeId}`);
} else if (existingPlacement.nodeId !== desiredPlacement.nodeId || !existingPlacement.active) {
  throw new Error(`Existing Site placement conflicts with bootstrap manifest: ${desiredPlacement.siteId}`);
}

const [persistedNodes, persistedAssignments, persistedSites, persistedPlacements] = await Promise.all([
  stores.hierarchyNodeStore.listAll(),
  stores.scopeAssignmentStore.listAll(),
  stores.siteStore.listActive(),
  stores.siteMappingStore.listActive(),
]);
validateHierarchyConfiguration(persistedNodes, persistedAssignments, persistedSites, persistedPlacements);
for (const id of desiredNodes.map(({ id }) => id)) {
  if (!persistedNodes.some((node) => node.id === id)) throw new Error(`Bootstrap verification is missing node: ${id}`);
}
for (const assignment of desiredAssignments) {
  if (!persistedAssignments.some(({ id }) => id === assignment.id)) throw new Error(`Bootstrap verification is missing assignment: ${assignment.id}`);
}
if (!persistedPlacements.some(({ siteId, nodeId, active }) => active && siteId === desiredSite.id && nodeId === desiredPlacement.nodeId)) {
  throw new Error("Bootstrap verification is missing the Site placement");
}

process.stdout.write(`${JSON.stringify({
  event: "customer-delivery-bootstrap-configuration",
  status: "verified",
  changes,
  businessNodes: desiredNodes.length,
  scopeAssignments: desiredAssignments.length,
  bootstrapSite: desiredSite.name,
  bootstrapNodeId: desiredPlacement.nodeId,
})}\n`);
