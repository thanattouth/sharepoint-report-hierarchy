import { validateHierarchyConfiguration } from "../domain/hierarchy";
import type {
  BusinessRole,
  GovernedSharePointSite,
  GovernanceHierarchyAssignment,
  GovernanceHierarchyNode,
  GovernanceHierarchySiteMapping,
  GovernancePrincipalType,
  HierarchyConfigurationAuditEvent,
  HierarchyNodeType,
} from "../domain/types";
import type {
  HierarchyConfigurationAuditStore,
  HierarchyNodeStore,
  ScopeAssignmentStore,
} from "../stores/contracts";
import { hierarchyBreadcrumb } from "./site-mapping";

const UPN_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NODE_TYPES = new Set<HierarchyNodeType>(["EVP", "Department", "Group", "Project"]);
const BUSINESS_ROLES = new Set<BusinessRole>([
  "EVP",
  "DepartmentHead",
  "GroupManager",
  "ProjectOwner",
  "Delegate",
]);

export type BusinessScopeNodeRow = GovernanceHierarchyNode & {
  breadcrumb: string;
  childCount: number;
  directSiteCount: number;
  directAssignmentCount: number;
};

export type BusinessScopeAssignmentRow = GovernanceHierarchyAssignment & {
  id: string;
  breadcrumb: string;
};

export type BusinessScopeSnapshot = {
  nodes: BusinessScopeNodeRow[];
  assignments: BusinessScopeAssignmentRow[];
  auditEvents: HierarchyConfigurationAuditEvent[];
  counts: {
    activeNodes: number;
    activeAssignments: number;
    mappedSites: number;
    evpRoots: number;
  };
};

export type BusinessNodeChange = {
  id?: string;
  expectedVersion: number;
  type: HierarchyNodeType;
  name: string;
  parentId?: string;
  active: boolean;
};

export type ScopeAssignmentChange = {
  id?: string;
  expectedVersion: number;
  principalType: GovernancePrincipalType;
  principalObjectId?: string;
  principalDisplayName?: string;
  userUpn?: string;
  nodeId: string;
  businessRole: BusinessRole;
  includeDescendants: boolean;
  active: boolean;
};

export type BusinessConfigurationPreview = {
  entityType: "HierarchyNode" | "ScopeAssignment";
  action: HierarchyConfigurationAuditEvent["action"];
  title: string;
  summary: string;
  expectedVersion: number;
  nextVersion: number;
  impact: {
    descendantNodes: number;
    directSites: number;
    directAssignments: number;
    visibleSites?: number;
  };
};

export function buildBusinessScopeSnapshot(input: {
  nodes: GovernanceHierarchyNode[];
  assignments: GovernanceHierarchyAssignment[];
  mappings: GovernanceHierarchySiteMapping[];
  auditEvents?: HierarchyConfigurationAuditEvent[];
}): BusinessScopeSnapshot {
  const childCount = new Map<string, number>();
  const directSiteCount = new Map<string, number>();
  const directAssignmentCount = new Map<string, number>();
  for (const node of input.nodes) {
    if (node.parentId) childCount.set(node.parentId, (childCount.get(node.parentId) ?? 0) + 1);
  }
  for (const mapping of input.mappings) {
    if (mapping.active) directSiteCount.set(mapping.nodeId, (directSiteCount.get(mapping.nodeId) ?? 0) + 1);
  }
  for (const assignment of input.assignments) {
    if (assignment.active) {
      directAssignmentCount.set(
        assignment.nodeId,
        (directAssignmentCount.get(assignment.nodeId) ?? 0) + 1,
      );
    }
  }
  const nodes = input.nodes.map<BusinessScopeNodeRow>((node) => ({
    ...node,
    version: node.version ?? 1,
    breadcrumb: hierarchyBreadcrumb(node.id, input.nodes),
    childCount: childCount.get(node.id) ?? 0,
    directSiteCount: directSiteCount.get(node.id) ?? 0,
    directAssignmentCount: directAssignmentCount.get(node.id) ?? 0,
  })).sort((left, right) => left.breadcrumb.localeCompare(right.breadcrumb));
  const assignments = input.assignments.map<BusinessScopeAssignmentRow>((assignment, index) => {
    const id = assignment.id ?? `legacy-${index}-${assignment.nodeId}`;
    return {
      ...assignment,
      id,
      version: assignment.version ?? 1,
      breadcrumb: hierarchyBreadcrumb(assignment.nodeId, input.nodes),
    };
  }).sort((left, right) => left.breadcrumb.localeCompare(right.breadcrumb)
    || principalLabel(left).localeCompare(principalLabel(right)));
  return {
    nodes,
    assignments,
    auditEvents: input.auditEvents ?? [],
    counts: {
      activeNodes: nodes.filter((node) => node.active).length,
      activeAssignments: assignments.filter((assignment) => assignment.active).length,
      mappedSites: new Set(input.mappings.filter((mapping) => mapping.active).map((mapping) => mapping.siteId)).size,
      evpRoots: nodes.filter((node) => node.active && node.type === "EVP").length,
    },
  };
}

export function previewBusinessNodeChange(input: {
  change: BusinessNodeChange;
  nodes: GovernanceHierarchyNode[];
  assignments: GovernanceHierarchyAssignment[];
  sites: GovernedSharePointSite[];
  mappings: GovernanceHierarchySiteMapping[];
}): BusinessConfigurationPreview {
  const change = normalizeNodeChange(input.change);
  const previous = change.id ? input.nodes.find((node) => node.id === change.id) : undefined;
  assertExpectedVersion(previous?.version ?? (previous ? 1 : 0), change.expectedVersion, "Hierarchy node");
  if (!previous && change.expectedVersion !== 0) throw new Error("New hierarchy node must use expectedVersion 0");
  if (previous && !change.id) throw new Error("Hierarchy node ID is required");
  const candidate: GovernanceHierarchyNode = {
    id: previous?.id ?? "preview-business-node",
    type: change.type,
    name: change.name,
    parentId: change.parentId,
    active: change.active,
    version: (previous?.version ?? 0) + 1,
  };
  const nextNodes = previous
    ? input.nodes.map((node) => node.id === previous.id ? candidate : node)
    : [...input.nodes, candidate];
  const activeChildren = input.nodes.filter((node) => node.active && node.parentId === candidate.id);
  const directAssignments = input.assignments.filter((assignment) => assignment.active && assignment.nodeId === candidate.id);
  const directMappings = input.mappings.filter((mapping) => mapping.active && mapping.nodeId === candidate.id);
  if (previous?.active && !candidate.active) {
    const blockers = [
      activeChildren.length ? `${activeChildren.length} active child nodes` : "",
      directAssignments.length ? `${directAssignments.length} active assignments` : "",
      directMappings.length ? `${directMappings.length} active Site mappings` : "",
    ].filter(Boolean);
    if (blockers.length) throw new Error(`Deactivate blocked by ${blockers.join(", ")}`);
  }
  validateHierarchyConfiguration(nextNodes, input.assignments, input.sites, input.mappings);
  const descendants = descendantIds(candidate.id, nextNodes);
  const visibleSites = new Set(input.mappings
    .filter((mapping) => mapping.active && descendants.has(mapping.nodeId))
    .map((mapping) => mapping.siteId));
  const action = nodeAction(previous, candidate);
  return {
    entityType: "HierarchyNode",
    action,
    title: `${actionLabel(action)} ${candidate.name}`,
    summary: `${candidate.type} · ${hierarchyBreadcrumb(candidate.id, nextNodes)}`,
    expectedVersion: change.expectedVersion,
    nextVersion: (previous?.version ?? 0) + 1,
    impact: {
      descendantNodes: Math.max(descendants.size - 1, 0),
      directSites: directMappings.length,
      directAssignments: directAssignments.length,
      visibleSites: visibleSites.size,
    },
  };
}

export async function applyBusinessNodeChange(input: {
  change: BusinessNodeChange;
  actor: string;
  now?: Date;
  nodes: GovernanceHierarchyNode[];
  assignments: GovernanceHierarchyAssignment[];
  sites: GovernedSharePointSite[];
  mappings: GovernanceHierarchySiteMapping[];
  nodeStore: HierarchyNodeStore;
  auditStore: HierarchyConfigurationAuditStore;
}): Promise<GovernanceHierarchyNode> {
  const preview = previewBusinessNodeChange(input);
  const actor = normalizeActor(input.actor);
  const change = normalizeNodeChange(input.change);
  const id = change.id ?? crypto.randomUUID();
  const previous = change.id ? await input.nodeStore.get(change.id) : null;
  assertExpectedVersion(previous?.version ?? (previous ? 1 : 0), change.expectedVersion, "Hierarchy node");
  const occurredAt = (input.now ?? new Date()).toISOString();
  const node: GovernanceHierarchyNode = {
    id,
    type: change.type,
    name: change.name,
    parentId: change.parentId,
    active: change.active,
    version: preview.nextVersion,
    updatedAt: occurredAt,
    updatedBy: actor,
  };
  await input.nodeStore.save(node, change.expectedVersion);
  await input.auditStore.save({
    id: crypto.randomUUID(),
    entityType: "HierarchyNode",
    entityId: id,
    action: preview.action,
    actor,
    occurredAt,
    version: preview.nextVersion,
    summary: preview.summary,
  });
  return node;
}

export function previewScopeAssignmentChange(input: {
  change: ScopeAssignmentChange;
  nodes: GovernanceHierarchyNode[];
  assignments: GovernanceHierarchyAssignment[];
  sites: GovernedSharePointSite[];
  mappings: GovernanceHierarchySiteMapping[];
}): BusinessConfigurationPreview {
  const change = normalizeAssignmentChange(input.change);
  const previous = change.id ? input.assignments.find((assignment) => assignment.id === change.id) : undefined;
  assertExpectedVersion(previous?.version ?? (previous ? 1 : 0), change.expectedVersion, "Scope assignment");
  if (!previous && change.expectedVersion !== 0) throw new Error("New scope assignment must use expectedVersion 0");
  const candidate: GovernanceHierarchyAssignment = {
    ...change,
    id: previous?.id ?? "preview-scope-assignment",
    version: (previous?.version ?? 0) + 1,
  };
  const duplicates = input.assignments.filter((assignment) => assignment.active
    && assignment.id !== previous?.id
    && assignment.nodeId === candidate.nodeId
    && assignment.businessRole === candidate.businessRole
    && (assignment.principalType ?? "User") === candidate.principalType
    && principalKey(assignment) === principalKey(candidate));
  if (candidate.active && duplicates.length) throw new Error("Duplicate active scope assignment");
  const nextAssignments = previous
    ? input.assignments.map((assignment) => assignment.id === previous.id ? candidate : assignment)
    : [...input.assignments, candidate];
  validateHierarchyConfiguration(input.nodes, nextAssignments, input.sites, input.mappings);
  const visibleNodeIds = candidate.includeDescendants
    ? descendantIds(candidate.nodeId, input.nodes)
    : new Set([candidate.nodeId]);
  const visibleSites = new Set(input.mappings
    .filter((mapping) => mapping.active && visibleNodeIds.has(mapping.nodeId))
    .map((mapping) => mapping.siteId));
  const action = assignmentAction(previous, candidate);
  return {
    entityType: "ScopeAssignment",
    action,
    title: `${actionLabel(action)} ${principalLabel(candidate)}`,
    summary: `${candidate.businessRole} · ${hierarchyBreadcrumb(candidate.nodeId, input.nodes)} · ${candidate.includeDescendants ? "includes descendants" : "direct node only"}`,
    expectedVersion: change.expectedVersion,
    nextVersion: (previous?.version ?? 0) + 1,
    impact: {
      descendantNodes: Math.max(visibleNodeIds.size - 1, 0),
      directSites: input.mappings.filter((mapping) => mapping.active && mapping.nodeId === candidate.nodeId).length,
      directAssignments: 1,
      visibleSites: visibleSites.size,
    },
  };
}

export async function applyScopeAssignmentChange(input: {
  change: ScopeAssignmentChange;
  actor: string;
  now?: Date;
  nodes: GovernanceHierarchyNode[];
  assignments: GovernanceHierarchyAssignment[];
  sites: GovernedSharePointSite[];
  mappings: GovernanceHierarchySiteMapping[];
  assignmentStore: ScopeAssignmentStore;
  auditStore: HierarchyConfigurationAuditStore;
}): Promise<GovernanceHierarchyAssignment> {
  const preview = previewScopeAssignmentChange(input);
  const actor = normalizeActor(input.actor);
  const change = normalizeAssignmentChange(input.change);
  const id = change.id ?? crypto.randomUUID();
  const previous = change.id ? await input.assignmentStore.get(change.id) : null;
  assertExpectedVersion(previous?.version ?? (previous ? 1 : 0), change.expectedVersion, "Scope assignment");
  const occurredAt = (input.now ?? new Date()).toISOString();
  const assignment: GovernanceHierarchyAssignment = {
    ...change,
    id,
    version: preview.nextVersion,
    updatedAt: occurredAt,
    updatedBy: actor,
  };
  await input.assignmentStore.save(assignment, change.expectedVersion);
  await input.auditStore.save({
    id: crypto.randomUUID(),
    entityType: "ScopeAssignment",
    entityId: id,
    action: preview.action,
    actor,
    occurredAt,
    version: preview.nextVersion,
    summary: preview.summary,
  });
  return assignment;
}

function normalizeNodeChange(change: BusinessNodeChange): BusinessNodeChange {
  const name = change.name?.trim();
  const parentId = change.parentId?.trim() || undefined;
  const id = change.id?.trim() || undefined;
  if (!NODE_TYPES.has(change.type)) throw new Error("Hierarchy node type is invalid");
  if (!name || name.length > 120) throw new Error("Hierarchy node name must contain 1-120 characters");
  if (id && id.length > 256) throw new Error("Hierarchy node ID is too long");
  if (parentId && parentId.length > 256) throw new Error("Hierarchy parent ID is too long");
  if (!Number.isInteger(change.expectedVersion) || change.expectedVersion < 0) {
    throw new Error("Hierarchy node expectedVersion is invalid");
  }
  if (typeof change.active !== "boolean") throw new Error("Hierarchy node active state is invalid");
  return { ...change, id, parentId, name };
}

function normalizeAssignmentChange(change: ScopeAssignmentChange): ScopeAssignmentChange {
  const id = change.id?.trim() || undefined;
  const principalObjectId = change.principalObjectId?.trim().toLocaleLowerCase() || undefined;
  const userUpn = change.userUpn?.trim().toLocaleLowerCase() || undefined;
  const principalDisplayName = change.principalDisplayName?.trim() || undefined;
  const nodeId = change.nodeId?.trim();
  if (change.principalType !== "User" && change.principalType !== "Group") {
    throw new Error("Principal type is invalid");
  }
  if (principalObjectId && !UUID_PATTERN.test(principalObjectId)) {
    throw new Error("Principal object ID must be a UUID");
  }
  if (change.principalType === "Group" && !principalObjectId) {
    throw new Error("Group assignment requires a principal object ID");
  }
  if (change.principalType === "User" && !principalObjectId && !UPN_PATTERN.test(userUpn ?? "")) {
    throw new Error("User assignment requires an object ID or valid UPN");
  }
  if (userUpn && !UPN_PATTERN.test(userUpn)) throw new Error("User UPN is invalid");
  if (!nodeId || nodeId.length > 256) throw new Error("Assignment node ID is invalid");
  if (!BUSINESS_ROLES.has(change.businessRole)) throw new Error("Business role is invalid");
  if (!Number.isInteger(change.expectedVersion) || change.expectedVersion < 0) {
    throw new Error("Scope assignment expectedVersion is invalid");
  }
  if (typeof change.includeDescendants !== "boolean" || typeof change.active !== "boolean") {
    throw new Error("Scope assignment flags are invalid");
  }
  return {
    ...change,
    id,
    principalObjectId,
    principalDisplayName,
    userUpn,
    nodeId,
  };
}

function descendantIds(nodeId: string, nodes: GovernanceHierarchyNode[]) {
  const result = new Set<string>();
  const walk = (id: string) => {
    if (result.has(id)) return;
    result.add(id);
    nodes.filter((node) => node.active && node.parentId === id).forEach((node) => walk(node.id));
  };
  walk(nodeId);
  return result;
}

function nodeAction(
  previous: GovernanceHierarchyNode | undefined,
  candidate: GovernanceHierarchyNode,
): HierarchyConfigurationAuditEvent["action"] {
  if (!previous) return "created";
  if (!previous.active && candidate.active) return "reactivated";
  if (previous.active && !candidate.active) return "deactivated";
  if (previous.parentId !== candidate.parentId) return "moved";
  return "updated";
}

function assignmentAction(
  previous: GovernanceHierarchyAssignment | undefined,
  candidate: GovernanceHierarchyAssignment,
): HierarchyConfigurationAuditEvent["action"] {
  if (!previous) return "created";
  if (!previous.active && candidate.active) return "reactivated";
  if (previous.active && !candidate.active) return "deactivated";
  return "updated";
}

function principalKey(assignment: GovernanceHierarchyAssignment) {
  return assignment.principalObjectId?.toLocaleLowerCase()
    ?? assignment.userUpn?.toLocaleLowerCase()
    ?? "";
}

export function principalLabel(assignment: GovernanceHierarchyAssignment) {
  return assignment.principalDisplayName
    ?? assignment.userUpn
    ?? assignment.principalObjectId
    ?? "Unknown principal";
}

function normalizeActor(actor: string) {
  const normalized = actor.trim().toLocaleLowerCase();
  if (!UPN_PATTERN.test(normalized)) throw new Error("Actor must be a valid UPN");
  return normalized;
}

function assertExpectedVersion(actual: number, expected: number, entity: string) {
  if (actual !== expected) throw new Error(`${entity} version conflict`);
}

function actionLabel(action: HierarchyConfigurationAuditEvent["action"]) {
  return action[0].toLocaleUpperCase() + action.slice(1);
}
