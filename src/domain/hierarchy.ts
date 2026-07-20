import type {
  GovernedSharePointSite,
  GovernanceHierarchyAssignment,
  GovernanceHierarchyNode,
  GovernanceHierarchySiteMapping,
  GovernancePrincipalContext,
} from "./types";

const UPN_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HOSTNAME_PATTERN = /^(?=.{1,253}$)(?!-)[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i;

export class HierarchyConfigurationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid hierarchy configuration: ${issues.join("; ")}`);
    this.name = "HierarchyConfigurationError";
  }
}

export function validateHierarchyConfiguration(
  nodes: GovernanceHierarchyNode[],
  assignments: GovernanceHierarchyAssignment[],
  sites: GovernedSharePointSite[],
  siteMappings: GovernanceHierarchySiteMapping[],
): void {
  const issues: string[] = [];
  const ids = new Set<string>();

  for (const node of nodes) {
    if (ids.has(node.id)) issues.push(`duplicate node id: ${node.id}`);
    ids.add(node.id);
    if (node.parentId === node.id) issues.push(`self parent: ${node.id}`);
  }

  for (const node of nodes) {
    if (node.parentId && !ids.has(node.parentId)) {
      issues.push(`missing parent ${node.parentId} for ${node.id}`);
    }
  }

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const requiredParentType: Partial<Record<GovernanceHierarchyNode["type"], GovernanceHierarchyNode["type"]>> = {
    Department: "EVP",
    Group: "Department",
    Project: "Group",
  };
  for (const node of nodes) {
    if (node.type === "EVP") {
      if (node.parentId) issues.push(`EVP node must be a root: ${node.id}`);
      continue;
    }
    const expectedParentType = requiredParentType[node.type];
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (!node.parentId || (parent && parent.type !== expectedParentType)) {
      issues.push(`${node.type} node must have a ${expectedParentType} parent: ${node.id}`);
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) {
      issues.push(`cycle detected at ${id}`);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    const parentId = byId.get(id)?.parentId;
    if (parentId && byId.has(parentId)) visit(parentId);
    visiting.delete(id);
    visited.add(id);
  };
  nodes.forEach((node) => visit(node.id));

  for (const assignment of assignments) {
    const principalType = assignment.principalType ?? "User";
    if (principalType === "User" && !assignment.principalObjectId
      && !UPN_PATTERN.test(assignment.userUpn ?? "")) {
      issues.push(`User assignment requires an object ID or valid UPN: ${assignment.id ?? assignment.nodeId}`);
    }
    if (principalType === "Group" && !assignment.principalObjectId?.trim()) {
      issues.push(`Group assignment requires an object ID: ${assignment.id ?? assignment.nodeId}`);
    }
    if (!ids.has(assignment.nodeId)) {
      issues.push(`assignment references missing node: ${assignment.nodeId}`);
    }
  }

  const siteIds = new Set<string>();
  for (const site of sites) {
    if (siteIds.has(site.id)) issues.push(`duplicate site id: ${site.id}`);
    siteIds.add(site.id);
    if (!HOSTNAME_PATTERN.test(site.hostname)) issues.push(`invalid hostname: ${site.id}`);
    if (!site.path.startsWith("/") || site.path.includes("..")) {
      issues.push(`invalid site path: ${site.id}`);
    }
  }

  const mappingKeys = new Set<string>();
  const activePlacements = new Map<string, number>();
  for (const mapping of siteMappings) {
    const key = `${mapping.nodeId}:${mapping.siteId}`;
    if (mappingKeys.has(key)) issues.push(`duplicate site mapping: ${key}`);
    mappingKeys.add(key);
    if (!ids.has(mapping.nodeId)) issues.push(`site mapping references missing node: ${mapping.nodeId}`);
    if (!siteIds.has(mapping.siteId)) issues.push(`site mapping references missing site: ${mapping.siteId}`);
    if (mapping.active) {
      activePlacements.set(mapping.siteId, (activePlacements.get(mapping.siteId) ?? 0) + 1);
    }
  }
  for (const [siteId, placements] of activePlacements) {
    if (placements > 1) issues.push(`site has multiple active hierarchy placements: ${siteId}`);
  }

  if (issues.length > 0) throw new HierarchyConfigurationError([...new Set(issues)]);
}

export type ResolvedScope = {
  assignedNodeIds: string[];
  visibleNodeIds: string[];
  allowedSiteIds: string[];
};

export function resolveHierarchyScope(
  principal: string | GovernancePrincipalContext,
  nodes: GovernanceHierarchyNode[],
  assignments: GovernanceHierarchyAssignment[],
  sites: GovernedSharePointSite[],
  siteMappings: GovernanceHierarchySiteMapping[],
): ResolvedScope {
  validateHierarchyConfiguration(nodes, assignments, sites, siteMappings);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const children = new Map<string, GovernanceHierarchyNode[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    const siblings = children.get(node.parentId) ?? [];
    siblings.push(node);
    children.set(node.parentId, siblings);
  }

  const context: GovernancePrincipalContext = typeof principal === "string"
    ? { userUpn: principal }
    : principal;
  const groupObjectIds = new Set((context.groupObjectIds ?? []).map((id) => id.toLocaleLowerCase()));
  const activeAssignments = assignments.filter(
    (assignment) =>
      assignment.active &&
      assignmentMatchesPrincipal(assignment, context, groupObjectIds) &&
      byId.get(assignment.nodeId)?.active,
  );
  const visible = new Set<string>();
  const addDescendants = (nodeId: string): void => {
    const node = byId.get(nodeId);
    if (!node?.active || visible.has(nodeId)) return;
    visible.add(nodeId);
    for (const child of children.get(nodeId) ?? []) addDescendants(child.id);
  };

  for (const assignment of activeAssignments) {
    if (assignment.includeDescendants) addDescendants(assignment.nodeId);
    else visible.add(assignment.nodeId);
  }

  const activeSiteIds = new Set(sites.filter((site) => site.active).map((site) => site.id));
  const allowedSites = new Set(
    siteMappings
      .filter(
        (mapping) =>
          mapping.active && visible.has(mapping.nodeId) && activeSiteIds.has(mapping.siteId),
      )
      .map((mapping) => mapping.siteId),
  );
  return {
    assignedNodeIds: [...new Set(activeAssignments.map((item) => item.nodeId))],
    visibleNodeIds: [...visible],
    allowedSiteIds: [...allowedSites],
  };
}

function assignmentMatchesPrincipal(
  assignment: GovernanceHierarchyAssignment,
  context: GovernancePrincipalContext,
  groupObjectIds: Set<string>,
): boolean {
  if ((assignment.principalType ?? "User") === "Group") {
    return Boolean(assignment.principalObjectId && groupObjectIds.has(assignment.principalObjectId.toLocaleLowerCase()));
  }
  if (assignment.principalObjectId && context.userObjectId) {
    return assignment.principalObjectId.toLocaleLowerCase() === context.userObjectId.toLocaleLowerCase();
  }
  return Boolean(assignment.userUpn
    && assignment.userUpn.toLowerCase() === context.userUpn.toLowerCase());
}

export function siteIdsUnderNode(
  nodeId: string,
  nodes: GovernanceHierarchyNode[],
  visibleNodeIds: string[],
  sites: GovernedSharePointSite[],
  siteMappings: GovernanceHierarchySiteMapping[],
): string[] {
  const visible = new Set(visibleNodeIds);
  if (!visible.has(nodeId)) return [];
  const descendants = new Set<string>([nodeId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (
        node.active &&
        node.parentId &&
        descendants.has(node.parentId) &&
        visible.has(node.id) &&
        !descendants.has(node.id)
      ) {
        descendants.add(node.id);
        changed = true;
      }
    }
  }
  const activeSiteIds = new Set(sites.filter((site) => site.active).map((site) => site.id));
  return [
    ...new Set(
      siteMappings
        .filter(
          (mapping) =>
            mapping.active &&
            descendants.has(mapping.nodeId) &&
            activeSiteIds.has(mapping.siteId),
        )
        .map((mapping) => mapping.siteId),
    ),
  ];
}
