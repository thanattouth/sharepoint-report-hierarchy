import assert from "node:assert/strict";
import test from "node:test";
import {
  HierarchyConfigurationError,
  resolveHierarchyScope,
  validateHierarchyConfiguration,
} from "../src/domain/hierarchy";
import type { GovernanceHierarchyNode } from "../src/domain/types";
import {
  SECRET_LABEL_IDS,
  hierarchyAssignments,
  hierarchyNodes,
  inventoryItems,
  scanRuns,
} from "../src/fixtures/data";
import {
  buildReport,
  ReportAuthorizationError,
  type ReportRequest,
} from "../src/report/report-service";
import { FixtureScanner } from "../src/scanner/fixture-scanner";

const source = {
  nodes: hierarchyNodes,
  assignments: hierarchyAssignments,
  inventory: inventoryItems,
  runs: scanRuns,
  secretLabelIds: SECRET_LABEL_IDS,
};

function request(userUpn: string, filters: ReportRequest["filters"] = {}): ReportRequest {
  return { userUpn, capability: "ReportViewer", scenario: "current", filters };
}

test("EVP sees every active descendant site", () => {
  const scope = resolveHierarchyScope("nipaporn@contoso.com", hierarchyNodes, hierarchyAssignments);
  assert.deepEqual(
    scope.allowedSiteIds.sort(),
    ["site-aurora", "site-consumer", "site-ledger", "site-nova", "site-supply"],
  );
  assert.ok(!scope.allowedSiteIds.includes("site-archived"));
});

test("Department, group and project scopes remain inside their branches", () => {
  assert.deepEqual(
    resolveHierarchyScope("anan@contoso.com", hierarchyNodes, hierarchyAssignments).allowedSiteIds.sort(),
    ["site-aurora", "site-consumer", "site-nova"],
  );
  assert.deepEqual(
    resolveHierarchyScope("mali@contoso.com", hierarchyNodes, hierarchyAssignments).allowedSiteIds.sort(),
    ["site-aurora", "site-nova"],
  );
  assert.deepEqual(
    resolveHierarchyScope("prach@contoso.com", hierarchyNodes, hierarchyAssignments).allowedSiteIds,
    ["site-aurora"],
  );
});

test("multiple assignments form a deduplicated union", () => {
  const scope = resolveHierarchyScope("delegate@contoso.com", hierarchyNodes, hierarchyAssignments);
  assert.deepEqual(scope.allowedSiteIds.sort(), ["site-aurora", "site-ledger", "site-nova"]);
  const report = buildReport(source, request("delegate@contoso.com"));
  assert.equal(report.scopeSecretCount, 7);
});

test("no assignment and inactive assignment expose no inventory", () => {
  assert.equal(buildReport(source, request("somchai@contoso.com")).state, "no-assignment");
  assert.equal(buildReport(source, request("inactive@contoso.com")).state, "no-assignment");
});

test("invalid hierarchy rejects missing parents and cycles", () => {
  const missingParent: GovernanceHierarchyNode[] = [
    { id: "child", parentId: "missing", type: "Project", name: "Child", active: true },
  ];
  assert.throws(
    () => validateHierarchyConfiguration(missingParent, []),
    HierarchyConfigurationError,
  );

  const cycle: GovernanceHierarchyNode[] = [
    { id: "a", parentId: "b", type: "Department", name: "A", active: true },
    { id: "b", parentId: "a", type: "Group", name: "B", active: true },
  ];
  assert.throws(() => validateHierarchyConfiguration(cycle, []), /cycle detected/);
});

test("requesting a sibling branch is denied at the report boundary", () => {
  assert.throws(
    () => buildReport(source, request("anan@contoso.com", { nodeId: "project-ledger" })),
    ReportAuthorizationError,
  );
  assert.throws(
    () => buildReport(source, request("mali@contoso.com", { siteId: "site-consumer" })),
    ReportAuthorizationError,
  );
});

test("counts reconcile with distinct filtered file rows", () => {
  const withDuplicate = { ...source, inventory: [...inventoryItems, inventoryItems[0]] };
  const report = buildReport(withDuplicate, {
    ...request("nipaporn@contoso.com", { pageSize: 50 }),
    capability: "ReportAdmin",
  });
  assert.equal(report.scopeSecretCount, 10);
  assert.equal(report.filteredSecretCount, report.rows.length);
  assert.equal(report.siteRollups.reduce((sum, site) => sum + site.count, 0), 10);

  const filtered = buildReport(source, request("nipaporn@contoso.com", { siteId: "site-aurora", pageSize: 50 }));
  assert.equal(filtered.filteredSecretCount, 2);
  assert.equal(filtered.rows.length, 2);
  assert.ok(filtered.rows.every((row) => row.siteId === "site-aurora"));
});

test("hierarchy rollups expose scalable navigation metadata", () => {
  const report = buildReport(source, request("nipaporn@contoso.com"));
  const root = report.hierarchyRollups.find((node) => node.nodeId === "evp-corporate");
  const commercial = report.hierarchyRollups.find((node) => node.nodeId === "dept-commercial");

  assert.deepEqual(
    { parentId: root?.parentId, siteCount: root?.siteCount, childCount: root?.childCount },
    { parentId: undefined, siteCount: 5, childCount: 2 },
  );
  assert.deepEqual(
    {
      parentId: commercial?.parentId,
      siteCount: commercial?.siteCount,
      childCount: commercial?.childCount,
    },
    { parentId: "evp-corporate", siteCount: 3, childCount: 2 },
  );
});

test("zero-secret scope is distinct from no scan", () => {
  assert.equal(buildReport(source, request("siriporn@contoso.com")).state, "zero-secret");
  assert.equal(
    buildReport(source, { ...request("siriporn@contoso.com"), scenario: "no-scan" }).state,
    "no-scan",
  );
});

test("fixture scanner queues immediately without scanning files", async () => {
  const queued = await new FixtureScanner().queue({
    trigger: "manual",
    requestedBy: "nipaporn@contoso.com",
    targets: [{ siteId: "site-aurora" }],
  });
  assert.equal(queued.status, "queued");
  assert.equal(queued.scannedCount, 0);
  assert.deepEqual(queued.targetSiteIds, ["site-aurora"]);
});
