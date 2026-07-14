import type {
  GovernanceHierarchyAssignment,
  GovernanceHierarchyNode,
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
): void {
  const issues: string[] = [];
  const ids = new Set<string>();

  for (const node of nodes) {
    if (ids.has(node.id)) issues.push(`duplicate node id: ${node.id}`);
    ids.add(node.id);
    if (node.parentId === node.id) issues.push(`self parent: ${node.id}`);
    if (node.site) {
      if (!HOSTNAME_PATTERN.test(node.site.hostname)) {
        issues.push(`invalid hostname: ${node.id}`);
      }
      if (!node.site.path.startsWith("/") || node.site.path.includes("..")) {
        issues.push(`invalid site path: ${node.id}`);
      }
    }
  }

  for (const node of nodes) {
    if (node.parentId && !ids.has(node.parentId)) {
      issues.push(`missing parent ${node.parentId} for ${node.id}`);
    }
  }

  const byId = new Map(nodes.map((node) => [node.id, node]));
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
    if (!UPN_PATTERN.test(assignment.userUpn)) {
      issues.push(`invalid UPN: ${assignment.userUpn || "<empty>"}`);
    }
    if (!ids.has(assignment.nodeId)) {
      issues.push(`assignment references missing node: ${assignment.nodeId}`);
    }
  }

  if (issues.length > 0) throw new HierarchyConfigurationError([...new Set(issues)]);
}

export type ResolvedScope = {
  assignedNodeIds: string[];
  visibleNodeIds: string[];
  allowedSiteIds: string[];
};

export function resolveHierarchyScope(
  userUpn: string,
  nodes: GovernanceHierarchyNode[],
  assignments: GovernanceHierarchyAssignment[],
): ResolvedScope {
  validateHierarchyConfiguration(nodes, assignments);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const children = new Map<string, GovernanceHierarchyNode[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    const siblings = children.get(node.parentId) ?? [];
    siblings.push(node);
    children.set(node.parentId, siblings);
  }

  const activeAssignments = assignments.filter(
    (assignment) =>
      assignment.active &&
      assignment.userUpn.toLowerCase() === userUpn.toLowerCase() &&
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

  const allowedSites = new Set<string>();
  for (const nodeId of visible) {
    const siteId = byId.get(nodeId)?.site?.siteId;
    if (siteId) allowedSites.add(siteId);
  }

  return {
    assignedNodeIds: [...new Set(activeAssignments.map((item) => item.nodeId))],
    visibleNodeIds: [...visible],
    allowedSiteIds: [...allowedSites],
  };
}

export function siteIdsUnderNode(
  nodeId: string,
  nodes: GovernanceHierarchyNode[],
  visibleNodeIds: string[],
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
  return [
    ...new Set(
      nodes
        .filter((node) => descendants.has(node.id))
        .map((node) => node.site?.siteId)
        .filter((siteId): siteId is string => Boolean(siteId)),
    ),
  ];
}
