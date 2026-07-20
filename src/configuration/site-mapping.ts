import type {
  GovernedSharePointSite,
  GovernanceHierarchyAssignment,
  GovernanceHierarchyNode,
  GovernanceHierarchySiteMapping,
  SiteMappingAuditEvent,
} from "../domain/types";
import type { SiteMappingAuditStore, SiteMappingStore } from "../stores/contracts";

export type SiteMappingInboxRow = {
  siteId: string;
  siteName: string;
  siteUrl: string;
  status: "mapped" | "unmapped" | "inactive";
  nodeId?: string;
  nodeBreadcrumb?: string;
  version: number;
  updatedAt?: string;
  updatedBy?: string;
};

export type SiteMappingPreview = {
  targetNodeId: string;
  targetBreadcrumb: string;
  selectedSiteCount: number;
  newAssignments: number;
  moves: number;
  unchanged: number;
  affectedPrincipals: Array<{ label: string; businessRole: string }>;
};

export type SiteMappingChange = {
  siteId: string;
  expectedVersion: number;
};

export function hierarchyBreadcrumb(
  nodeId: string,
  nodes: GovernanceHierarchyNode[],
): string {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const labels: string[] = [];
  const seen = new Set<string>();
  let current = byId.get(nodeId);
  while (current) {
    if (seen.has(current.id)) throw new Error(`Hierarchy cycle detected at ${current.id}`);
    seen.add(current.id);
    labels.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  if (labels.length === 0) throw new Error(`Unknown hierarchy node: ${nodeId}`);
  return labels.join(" / ");
}

export function buildSiteMappingInbox(
  sites: GovernedSharePointSite[],
  nodes: GovernanceHierarchyNode[],
  mappings: GovernanceHierarchySiteMapping[],
): SiteMappingInboxRow[] {
  const activeNodes = new Map(nodes.filter((node) => node.active).map((node) => [node.id, node]));
  const placementBySite = new Map(
    mappings.filter((mapping) => mapping.active).map((mapping) => [mapping.siteId, mapping]),
  );
  return sites.map<SiteMappingInboxRow>((site) => {
    const placement = placementBySite.get(site.id);
    const node = placement ? activeNodes.get(placement.nodeId) : undefined;
    return {
      siteId: site.id,
      siteName: site.name,
      siteUrl: `https://${site.hostname}${site.path}`,
      status: !site.active ? "inactive" : node ? "mapped" : "unmapped",
      nodeId: node?.id,
      nodeBreadcrumb: node ? hierarchyBreadcrumb(node.id, nodes) : undefined,
      version: placement?.version ?? 0,
      updatedAt: placement?.updatedAt,
      updatedBy: placement?.updatedBy,
    };
  }).sort((left, right) => {
    const order = { unmapped: 0, mapped: 1, inactive: 2 };
    return order[left.status] - order[right.status] || left.siteName.localeCompare(right.siteName);
  });
}

export function previewSiteMappingChange(input: {
  changes: SiteMappingChange[];
  targetNodeId: string;
  nodes: GovernanceHierarchyNode[];
  sites: GovernedSharePointSite[];
  mappings: GovernanceHierarchySiteMapping[];
  assignments: GovernanceHierarchyAssignment[];
}): SiteMappingPreview {
  if (input.changes.length === 0) throw new Error("Select at least one Site");
  const target = input.nodes.find((node) => node.id === input.targetNodeId && node.active);
  if (!target) throw new Error("Target node must exist and be active");
  const sites = new Map(input.sites.filter((site) => site.active).map((site) => [site.id, site]));
  const current = new Map(input.mappings.filter((mapping) => mapping.active).map((mapping) => [mapping.siteId, mapping]));
  let newAssignments = 0;
  let moves = 0;
  let unchanged = 0;
  for (const change of input.changes) {
    if (!sites.has(change.siteId)) throw new Error(`Site is missing or inactive: ${change.siteId}`);
    const placement = current.get(change.siteId);
    if (!placement) newAssignments += 1;
    else if (placement.nodeId === input.targetNodeId) unchanged += 1;
    else moves += 1;
  }
  const affectedPrincipals = input.assignments
    .filter((assignment) => assignment.active && assignment.nodeId === input.targetNodeId)
    .map((assignment) => ({
      label: assignment.principalDisplayName
        ?? assignment.userUpn
        ?? assignment.principalObjectId
        ?? assignment.id
        ?? "Unknown principal",
      businessRole: assignment.businessRole,
    }));
  return {
    targetNodeId: target.id,
    targetBreadcrumb: hierarchyBreadcrumb(target.id, input.nodes),
    selectedSiteCount: input.changes.length,
    newAssignments,
    moves,
    unchanged,
    affectedPrincipals,
  };
}

export async function applySiteMappingChanges(input: {
  changes: SiteMappingChange[];
  targetNodeId: string;
  actor: string;
  now?: Date;
  nodes: GovernanceHierarchyNode[];
  mappingStore: SiteMappingStore;
  auditStore: SiteMappingAuditStore;
}): Promise<GovernanceHierarchySiteMapping[]> {
  const target = input.nodes.find((node) => node.id === input.targetNodeId && node.active);
  if (!target) throw new Error("Target node must exist and be active");
  if (!input.actor.trim()) throw new Error("Actor is required");
  const occurredAt = (input.now ?? new Date()).toISOString();
  const saved: GovernanceHierarchySiteMapping[] = [];
  for (const change of input.changes) {
    const previous = await input.mappingStore.get(change.siteId);
    const actualVersion = previous?.version ?? 0;
    if (actualVersion !== change.expectedVersion) {
      throw new Error(`Site mapping version conflict for ${change.siteId}`);
    }
    if (previous?.active && previous.nodeId === target.id) {
      saved.push(previous);
      continue;
    }
    const version = actualVersion + 1;
    const mapping: GovernanceHierarchySiteMapping = {
      siteId: change.siteId,
      nodeId: target.id,
      active: true,
      version,
      updatedAt: occurredAt,
      updatedBy: input.actor,
    };
    await input.mappingStore.save(mapping, actualVersion);
    const event: SiteMappingAuditEvent = {
      id: crypto.randomUUID(),
      siteId: change.siteId,
      previousNodeId: previous?.nodeId,
      nodeId: target.id,
      action: !previous ? "assigned" : previous.active ? "moved" : "reactivated",
      actor: input.actor,
      occurredAt,
      version,
    };
    await input.auditStore.save(event);
    saved.push(mapping);
  }
  return saved;
}
