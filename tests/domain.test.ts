import assert from "node:assert/strict";
import test from "node:test";
import {
  HierarchyConfigurationError,
  resolveHierarchyScope,
  validateHierarchyConfiguration,
} from "../src/domain/hierarchy";
import type { GovernanceHierarchyNode } from "../src/domain/types";
import {
  REPORTABLE_LABEL_IDS,
  hierarchyAssignments,
  hierarchyNodes,
  hierarchySiteMappings,
  inventoryItems,
  scanRuns,
  sharePointSites,
} from "../src/fixtures/data";
import {
  buildReport,
  ReportAuthorizationError,
  type ReportRequest,
} from "../src/report/report-service";
import { buildSiteSensitivitySummary } from "../src/domain/site-summary";
import { FixtureScanner } from "../src/scanner/fixture-scanner";
import { scheduledScanTargets } from "../src/scanner/contracts";

const source = {
  nodes: hierarchyNodes,
  assignments: hierarchyAssignments,
  sites: sharePointSites,
  siteMappings: hierarchySiteMappings,
  inventory: inventoryItems,
  runs: scanRuns,
  reportableLabelIds: REPORTABLE_LABEL_IDS,
};

function request(userUpn: string, filters: ReportRequest["filters"] = {}): ReportRequest {
  return { userUpn, capability: "ReportViewer", scenario: "current", filters };
}

function resolve(userUpn: string) {
  return resolveHierarchyScope(
    userUpn,
    hierarchyNodes,
    hierarchyAssignments,
    sharePointSites,
    hierarchySiteMappings,
  );
}

test("EVP sees every active descendant site", () => {
  const scope = resolve("nipaporn@contoso.com");
  assert.deepEqual(
    scope.allowedSiteIds.sort(),
    ["site-aurora", "site-commercial-hub", "site-consumer", "site-ledger", "site-nova", "site-supply"],
  );
  assert.ok(!scope.allowedSiteIds.includes("site-archived"));
});

test("Department, group and project scopes remain inside their branches", () => {
  assert.deepEqual(
    resolve("anan@contoso.com").allowedSiteIds.sort(),
    ["site-aurora", "site-commercial-hub", "site-consumer", "site-nova"],
  );
  assert.deepEqual(
    resolve("mali@contoso.com").allowedSiteIds.sort(),
    ["site-aurora", "site-nova"],
  );
  assert.deepEqual(
    resolve("prach@contoso.com").allowedSiteIds,
    ["site-aurora"],
  );
});

test("multiple assignments form a deduplicated union", () => {
  const scope = resolve("delegate@contoso.com");
  assert.deepEqual(scope.allowedSiteIds.sort(), ["site-aurora", "site-ledger", "site-nova"]);
  const report = buildReport(source, request("delegate@contoso.com"));
  assert.equal(report.scopeSensitiveCount, 7);
});

test("no assignment and inactive assignment expose no inventory", () => {
  assert.equal(buildReport(source, request("somchai@contoso.com")).state, "no-assignment");
  assert.equal(buildReport(source, request("inactive@contoso.com")).state, "no-assignment");
});

test("business assignment without mapped sites is distinct from no assignment", () => {
  assert.equal(
    buildReport({ ...source, siteMappings: [] }, request("nipaporn@contoso.com")).state,
    "no-sites",
  );
});

test("invalid hierarchy rejects missing parents and cycles", () => {
  const missingParent: GovernanceHierarchyNode[] = [
    { id: "child", parentId: "missing", type: "Project", name: "Child", active: true },
  ];
  assert.throws(
    () => validateHierarchyConfiguration(missingParent, [], [], []),
    HierarchyConfigurationError,
  );

  const cycle: GovernanceHierarchyNode[] = [
    { id: "a", parentId: "b", type: "Department", name: "A", active: true },
    { id: "b", parentId: "a", type: "Group", name: "B", active: true },
  ];
  assert.throws(() => validateHierarchyConfiguration(cycle, [], [], []), /cycle detected/);
});

test("SharePoint sites are flat records mapped separately to business nodes", () => {
  assert.ok(hierarchyNodes.every((node) => !("site" in node)));
  assert.ok(sharePointSites.some((site) => site.id === "site-commercial-hub"));
  assert.ok(
    hierarchySiteMappings.some(
      (mapping) =>
        mapping.nodeId === "dept-commercial" && mapping.siteId === "site-commercial-hub",
    ),
  );
  assert.throws(
    () =>
      validateHierarchyConfiguration(hierarchyNodes, hierarchyAssignments, sharePointSites, [
        ...hierarchySiteMappings,
        { nodeId: "group-enterprise", siteId: "site-commercial-hub", active: true },
      ]),
    /multiple active hierarchy placements/,
  );
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

test("out-of-scope filters are denied before no-scan and no-assignment empty states", () => {
  assert.throws(
    () => buildReport(source, {
      ...request("prach@contoso.com"),
      scenario: "no-scan",
      filters: { siteId: "site-ledger" },
    }),
    ReportAuthorizationError,
  );
  assert.throws(
    () => buildReport(source, {
      ...request("somchai@contoso.com"),
      filters: { nodeId: "evp-corporate" },
    }),
    ReportAuthorizationError,
  );
});

test("counts reconcile with distinct filtered file rows", () => {
  const withDuplicate = { ...source, inventory: [...inventoryItems, inventoryItems[0]] };
  const report = buildReport(withDuplicate, {
    ...request("nipaporn@contoso.com", { pageSize: 50 }),
    capability: "ReportAdmin",
  });
  assert.equal(report.scopeSensitiveCount, 10);
  assert.equal(report.filteredSensitiveCount, report.rows.length);
  assert.equal(report.siteRollups.reduce((sum, site) => sum + site.count, 0), 10);

  const filtered = buildReport(source, request("nipaporn@contoso.com", { siteId: "site-aurora", pageSize: 50 }));
  assert.equal(filtered.filteredSensitiveCount, 2);
  assert.equal(filtered.rows.length, 2);
  assert.ok(filtered.rows.every((row) => row.siteId === "site-aurora"));
});

test("reportable label filter separates Confidential from Secret", () => {
  const confidential = buildReport(
    source,
    request("nipaporn@contoso.com", { labelId: "label-confidential-th", pageSize: 50 }),
  );
  assert.equal(confidential.scopeSensitiveCount, 10);
  assert.equal(confidential.filteredSensitiveCount, 4);
  assert.ok(confidential.rows.every((row) =>
    row.sensitivityLabels.some((label) => label.id === "label-confidential-th"),
  ));
  assert.deepEqual(
    confidential.options.labels.map((label) => label.name),
    ["Confidential", "Secret"],
  );
});

test("hierarchy rollups expose scalable navigation metadata", () => {
  const report = buildReport(source, request("nipaporn@contoso.com"));
  const root = report.hierarchyRollups.find((node) => node.nodeId === "evp-corporate");
  const commercial = report.hierarchyRollups.find((node) => node.nodeId === "dept-commercial");

  assert.deepEqual(
    { parentId: root?.parentId, siteCount: root?.siteCount, childCount: root?.childCount },
    { parentId: undefined, siteCount: 6, childCount: 2 },
  );
  assert.deepEqual(
    {
      parentId: commercial?.parentId,
      siteCount: commercial?.siteCount,
      childCount: commercial?.childCount,
    },
    { parentId: "evp-corporate", siteCount: 4, childCount: 2 },
  );
});

test("Site summaries keep large-scope counts without loading every file partition", () => {
  const auroraItems = inventoryItems.filter((item) => item.siteId === "site-aurora");
  const summary = buildSiteSensitivitySummary({
    tenantId: auroraItems[0].tenantId,
    siteId: "site-aurora",
    siteName: "Project Aurora",
    items: auroraItems,
    reportableLabelIds: REPORTABLE_LABEL_IDS,
    updatedAt: "2026-07-14T08:00:00Z",
  });
  const report = buildReport(
    {
      ...source,
      inventory: [],
      siteSummaries: [summary],
      inventoryCoverage: "selected-site",
    },
    request("nipaporn@contoso.com"),
  );
  assert.equal(report.scopeSensitiveCount, 2);
  assert.equal(report.siteRollups.find((site) => site.siteId === "site-aurora")?.count, 2);
  assert.equal(report.rows.length, 0);
  assert.equal(report.detailsRequireSiteSelection, true);
});

test("zero-sensitive scope is distinct from no scan", () => {
  assert.equal(buildReport(source, request("siriporn@contoso.com")).state, "zero-sensitive");
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

test("scheduled targets come from flat scan-enabled sites, not user assignments", () => {
  const targets = scheduledScanTargets(sharePointSites);
  assert.deepEqual(
    targets.map((target) => target.siteId).sort(),
    ["site-aurora", "site-commercial-hub", "site-consumer", "site-ledger", "site-nova", "site-supply"],
  );
  assert.ok(!targets.some((target) => target.siteId === "site-archived"));
  assert.equal(new Set(targets.map((target) => target.siteId)).size, targets.length);
});
