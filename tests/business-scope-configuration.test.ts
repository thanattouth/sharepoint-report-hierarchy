import assert from "node:assert/strict";
import test from "node:test";
import {
  applyBusinessNodeChange,
  applyScopeAssignmentChange,
  buildBusinessScopeSnapshot,
  previewBusinessNodeChange,
  previewScopeAssignmentChange,
} from "../src/configuration/business-scope";
import type {
  GovernanceHierarchyAssignment,
  GovernanceHierarchyNode,
  HierarchyConfigurationAuditEvent,
} from "../src/domain/types";
import { hierarchyAssignments, hierarchyNodes, hierarchySiteMappings, sharePointSites } from "../src/fixtures/data";
import type {
  HierarchyConfigurationAuditStore,
  HierarchyNodeStore,
  ScopeAssignmentStore,
} from "../src/stores/contracts";

class MemoryNodeStore implements HierarchyNodeStore {
  constructor(readonly values = new Map<string, GovernanceHierarchyNode>()) {}
  async listAll() { return [...this.values.values()]; }
  async get(nodeId: string) { return this.values.get(nodeId) ?? null; }
  async save(node: GovernanceHierarchyNode, expectedVersion?: number) {
    assert.equal(this.values.get(node.id)?.version ?? 0, expectedVersion);
    this.values.set(node.id, node);
  }
}

class MemoryAssignmentStore implements ScopeAssignmentStore {
  constructor(readonly values = new Map<string, GovernanceHierarchyAssignment>()) {}
  async listAll() { return [...this.values.values()]; }
  async get(assignmentId: string) { return this.values.get(assignmentId) ?? null; }
  async save(assignment: GovernanceHierarchyAssignment, expectedVersion?: number) {
    assert.ok(assignment.id);
    assert.equal(this.values.get(assignment.id!)?.version ?? 0, expectedVersion);
    this.values.set(assignment.id!, assignment);
  }
}

class MemoryConfigurationAuditStore implements HierarchyConfigurationAuditStore {
  readonly events: HierarchyConfigurationAuditEvent[] = [];
  async listRecent() { return this.events; }
  async save(event: HierarchyConfigurationAuditEvent) { this.events.push(event); }
}

test("business scope snapshot exposes structure, assignments, mapping counts, and versions", () => {
  const snapshot = buildBusinessScopeSnapshot({
    nodes: hierarchyNodes,
    assignments: hierarchyAssignments,
    mappings: hierarchySiteMappings,
  });
  assert.equal(snapshot.counts.evpRoots, 2);
  assert.equal(snapshot.counts.mappedSites, new Set(
    hierarchySiteMappings.filter((mapping) => mapping.active).map((mapping) => mapping.siteId),
  ).size);
  assert.ok(snapshot.nodes.every((node) => node.version === 1 && node.breadcrumb));
  assert.ok(snapshot.assignments.every((assignment) => assignment.version === 1 && assignment.id));
});

test("node preview enforces the fixed parent chain and blocks unsafe deactivation", () => {
  assert.throws(() => previewBusinessNodeChange({
    change: { expectedVersion: 0, type: "Project", name: "Invalid root", active: true },
    nodes: hierarchyNodes,
    assignments: hierarchyAssignments,
    sites: sharePointSites,
    mappings: hierarchySiteMappings,
  }), /Project node must have a Group parent/);

  const aurora = hierarchyNodes.find((node) => node.id === "project-aurora")!;
  assert.throws(() => previewBusinessNodeChange({
    change: { ...aurora, expectedVersion: 1, active: false },
    nodes: hierarchyNodes,
    assignments: hierarchyAssignments,
    sites: sharePointSites,
    mappings: hierarchySiteMappings,
  }), /Deactivate blocked by.*Site mappings/);
});

test("node apply uses optimistic versions and appends an actor audit event", async () => {
  const original = { ...hierarchyNodes[0], version: 1 };
  const store = new MemoryNodeStore(new Map([[original.id, original]]));
  const audit = new MemoryConfigurationAuditStore();
  const saved = await applyBusinessNodeChange({
    change: { ...original, name: `${original.name} Updated`, expectedVersion: 1 },
    actor: "ADMIN@contoso.com",
    now: new Date("2026-07-20T08:00:00.000Z"),
    nodes: hierarchyNodes.map((node) => node.id === original.id ? original : node),
    assignments: hierarchyAssignments,
    sites: sharePointSites,
    mappings: hierarchySiteMappings,
    nodeStore: store,
    auditStore: audit,
  });
  assert.equal(saved.version, 2);
  assert.equal(saved.updatedBy, "admin@contoso.com");
  assert.equal(audit.events[0].entityType, "HierarchyNode");
  assert.equal(audit.events[0].action, "updated");
});

test("assignment preview validates immutable group identity and calculates descendant Site scope", () => {
  const base = {
    expectedVersion: 0,
    principalType: "Group" as const,
    principalDisplayName: "Corporate Leadership",
    nodeId: "evp-corporate",
    businessRole: "EVP" as const,
    includeDescendants: true,
    active: true,
  };
  assert.throws(() => previewScopeAssignmentChange({
    change: base,
    nodes: hierarchyNodes,
    assignments: hierarchyAssignments,
    sites: sharePointSites,
    mappings: hierarchySiteMappings,
  }), /principal object ID/);
  const preview = previewScopeAssignmentChange({
    change: { ...base, principalObjectId: "11111111-1111-4111-8111-111111111111" },
    nodes: hierarchyNodes,
    assignments: hierarchyAssignments,
    sites: sharePointSites,
    mappings: hierarchySiteMappings,
  });
  assert.equal(preview.action, "created");
  assert.ok((preview.impact.visibleSites ?? 0) > 1);
});

test("assignment apply persists an easy-to-remove active record with version and audit", async () => {
  const store = new MemoryAssignmentStore();
  const audit = new MemoryConfigurationAuditStore();
  const saved = await applyScopeAssignmentChange({
    change: {
      expectedVersion: 0,
      principalType: "User",
      userUpn: "evp-a@contoso.com",
      principalDisplayName: "EVP A",
      nodeId: "evp-corporate",
      businessRole: "EVP",
      includeDescendants: true,
      active: true,
    },
    actor: "admin@contoso.com",
    now: new Date("2026-07-20T08:10:00.000Z"),
    nodes: hierarchyNodes,
    assignments: hierarchyAssignments,
    sites: sharePointSites,
    mappings: hierarchySiteMappings,
    assignmentStore: store,
    auditStore: audit,
  });
  assert.ok(saved.id);
  assert.equal(saved.version, 1);
  assert.equal(saved.userUpn, "evp-a@contoso.com");
  assert.equal(audit.events[0].entityType, "ScopeAssignment");
  assert.equal(audit.events[0].action, "created");
});
