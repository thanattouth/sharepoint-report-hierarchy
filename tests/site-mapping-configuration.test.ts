import assert from "node:assert/strict";
import test from "node:test";
import {
  applySiteMappingChanges,
  buildSiteMappingInbox,
  hierarchyBreadcrumb,
  previewSiteMappingChange,
  querySiteMappingInbox,
} from "../src/configuration/site-mapping";
import type {
  GovernanceHierarchySiteMapping,
  SiteMappingAuditEvent,
} from "../src/domain/types";
import { hierarchyAssignments, hierarchyNodes, hierarchySiteMappings, sharePointSites } from "../src/fixtures/data";
import type { SiteMappingAuditStore, SiteMappingStore } from "../src/stores/contracts";

test("Site mapping inbox puts unmapped Sites first and shows searchable breadcrumbs", () => {
  const mappings = hierarchySiteMappings.filter((mapping) => mapping.siteId !== "site-nova");
  const inbox = buildSiteMappingInbox(sharePointSites, hierarchyNodes, mappings);
  assert.equal(inbox[0].siteId, "site-nova");
  assert.equal(inbox[0].status, "unmapped");
  assert.equal(
    hierarchyBreadcrumb("project-aurora", hierarchyNodes),
    "Corporate Services / Commercial / Enterprise Growth / Project Aurora",
  );
});

test("bulk preview distinguishes new mappings, moves, and unchanged placements", () => {
  const preview = previewSiteMappingChange({
    changes: [
      { siteId: "site-nova", expectedVersion: 0 },
      { siteId: "site-aurora", expectedVersion: 0 },
      { siteId: "site-consumer", expectedVersion: 0 },
    ],
    targetNodeId: "project-aurora",
    nodes: hierarchyNodes,
    sites: sharePointSites,
    mappings: hierarchySiteMappings.filter((mapping) => mapping.siteId !== "site-nova"),
    assignments: hierarchyAssignments,
  });
  assert.equal(preview.newAssignments, 1);
  assert.equal(preview.unchanged, 1);
  assert.equal(preview.moves, 1);
});

test("Site mapping inbox filters and paginates before returning rows to the browser", () => {
  const mappings = hierarchySiteMappings.filter((mapping) => mapping.siteId !== "site-nova");
  const inbox = buildSiteMappingInbox(sharePointSites, hierarchyNodes, mappings);
  const unmapped = querySiteMappingInbox(inbox, {
    status: "unmapped",
    query: "nova",
    page: 1,
    pageSize: 1,
  });
  assert.equal(unmapped.total, 1);
  assert.equal(unmapped.rows[0].siteId, "site-nova");
  assert.equal(unmapped.pageCount, 1);

  const mapped = querySiteMappingInbox(inbox, {
    status: "mapped",
    query: "",
    page: 2,
    pageSize: 2,
  });
  assert.equal(mapped.page, 2);
  assert.equal(mapped.rows.length, 2);
  assert.ok(mapped.rows.every((row) => row.status === "mapped"));
});

class MemoryMappingStore implements SiteMappingStore {
  constructor(readonly values = new Map<string, GovernanceHierarchySiteMapping>()) {}
  async listAll() { return [...this.values.values()]; }
  async listActive() { return [...this.values.values()].filter((mapping) => mapping.active); }
  async get(siteId: string) { return this.values.get(siteId) ?? null; }
  async save(mapping: GovernanceHierarchySiteMapping, expectedVersion?: number) {
    assert.equal(this.values.get(mapping.siteId)?.version ?? 0, expectedVersion);
    this.values.set(mapping.siteId, mapping);
  }
}

class MemoryAuditStore implements SiteMappingAuditStore {
  readonly events: SiteMappingAuditEvent[] = [];
  async listRecent(siteId?: string) {
    return this.events.filter((event) => !siteId || event.siteId === siteId);
  }
  async save(event: SiteMappingAuditEvent) { this.events.push(event); }
}

test("applying a mapping uses optimistic versions and emits an audit event", async () => {
  const mappings = new MemoryMappingStore();
  const audit = new MemoryAuditStore();
  const [saved] = await applySiteMappingChanges({
    changes: [{ siteId: "site-nova", expectedVersion: 0 }],
    targetNodeId: "project-nova",
    actor: "admin@contoso.com",
    now: new Date("2026-07-20T03:00:00.000Z"),
    nodes: hierarchyNodes,
    mappingStore: mappings,
    auditStore: audit,
  });
  assert.equal(saved.version, 1);
  assert.equal(saved.updatedBy, "admin@contoso.com");
  assert.equal(audit.events[0].action, "assigned");
  await assert.rejects(
    applySiteMappingChanges({
      changes: [{ siteId: "site-nova", expectedVersion: 0 }],
      targetNodeId: "project-aurora",
      actor: "admin@contoso.com",
      nodes: hierarchyNodes,
      mappingStore: mappings,
      auditStore: audit,
    }),
    /version conflict/,
  );
});
