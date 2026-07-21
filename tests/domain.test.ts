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

test("each EVP sees only mapped Sites below its own root", () => {
  const otherNodes: GovernanceHierarchyNode[] = [
    { id: "evp-other", type: "EVP", name: "Other EVP", active: true },
    { id: "dept-other", parentId: "evp-other", type: "Department", name: "Other Department", active: true },
    { id: "group-other", parentId: "dept-other", type: "Group", name: "Other Group", active: true },
    { id: "project-other", parentId: "group-other", type: "Project", name: "Other Project", active: true },
  ];
  const otherSite = {
    id: "site-other",
    name: "Other EVP Site",
    hostname: "contoso.sharepoint.com",
    path: "/sites/other",
    active: true,
    scanEnabled: true,
  };
  const unmappedSite = {
    ...otherSite,
    id: "site-unmapped",
    name: "Unmapped Site",
    path: "/sites/unmapped",
  };
  const nodes = [...hierarchyNodes, ...otherNodes];
  const sites = [...sharePointSites, otherSite, unmappedSite];
  const assignments = [
    ...hierarchyAssignments,
    {
      userUpn: "other-evp@contoso.com",
      nodeId: "evp-other",
      businessRole: "EVP" as const,
      includeDescendants: true,
      active: true,
    },
  ];
  const mappings = [
    ...hierarchySiteMappings,
    { nodeId: "project-other", siteId: otherSite.id, active: true },
  ];

  const firstEvpScope = resolveHierarchyScope(
    "nipaporn@contoso.com",
    nodes,
    assignments,
    sites,
    mappings,
  );
  const otherEvpScope = resolveHierarchyScope(
    "other-evp@contoso.com",
    nodes,
    assignments,
    sites,
    mappings,
  );

  assert.ok(!firstEvpScope.allowedSiteIds.includes(otherSite.id));
  assert.ok(!firstEvpScope.allowedSiteIds.includes(unmappedSite.id));
  assert.deepEqual(otherEvpScope.allowedSiteIds, [otherSite.id]);
  assert.ok(!otherEvpScope.visibleNodeIds.includes("evp-corporate"));
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

test("Entra group assignment grants the same descendant scope without Site ownership", () => {
  const groupAssignment = {
    id: "assignment-group-commercial",
    principalType: "Group" as const,
    principalObjectId: "group-commercial-readers",
    principalDisplayName: "Commercial readers",
    nodeId: "dept-commercial",
    businessRole: "Delegate" as const,
    includeDescendants: true,
    active: true,
  };
  const scope = resolveHierarchyScope(
    {
      userUpn: "group-member@contoso.com",
      groupObjectIds: ["group-commercial-readers"],
    },
    hierarchyNodes,
    [groupAssignment],
    sharePointSites,
    hierarchySiteMappings,
  );
  assert.ok(scope.allowedSiteIds.includes("site-aurora"));
  assert.ok(!scope.allowedSiteIds.includes("site-ledger"));
  assert.ok(!scope.allowedSiteIds.includes("site-orbit"));
});

test("no assignment and inactive assignment expose no inventory", () => {
  assert.equal(buildReport(source, request("somchai@contoso.com")).state, "no-assignment");
  assert.equal(buildReport(source, request("inactive@contoso.com")).state, "no-assignment");
});

test("business assignment without mapped sites is distinct from no assignment", () => {
  assert.equal(buildReport({ ...source, siteMappings: [] }, request("anan@contoso.com")).state, "no-sites");
  assert.equal(buildReport({ ...source, siteMappings: [] }, request("nipaporn@contoso.com")).state, "no-sites");
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
  assert.throws(
    () => validateHierarchyConfiguration([
      { id: "evp", type: "EVP", name: "EVP", active: true },
      { id: "project", parentId: "evp", type: "Project", name: "Project", active: true },
    ], [], [], []),
    /Project node must have a Group parent/,
  );
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
  assert.equal(report.filteredSensitiveCount, 0);
  assert.equal(report.filteredSensitiveCount, report.rows.length);
  assert.equal(report.detailsRequireSiteSelection, true);
  assert.equal(report.siteRollups.reduce((sum, site) => sum + site.count, 0), 10);

  const filtered = buildReport(source, request("nipaporn@contoso.com", { siteId: "site-aurora", pageSize: 50 }));
  assert.equal(filtered.filteredSensitiveCount, 2);
  assert.equal(filtered.rows.length, 2);
  assert.ok(filtered.rows.every((row) => row.siteId === "site-aurora"));
});

test("reportable label filter separates Confidential from Secret", () => {
  const confidential = buildReport(
    source,
    request("nipaporn@contoso.com", {
      siteId: "site-aurora",
      labelId: "label-confidential-th",
      pageSize: 50,
    }),
  );
  assert.equal(confidential.scopeSensitiveCount, 10);
  assert.equal(confidential.filteredSensitiveCount, 1);
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
