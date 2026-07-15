import assert from "node:assert/strict";
import { loadReportCacheConfig } from "../src/report/cache-config";
import { buildReport, ReportAuthorizationError, type ReportRequest } from "../src/report/report-service";
import { loadReportSource } from "../src/report/report-source";

const cacheConfig = loadReportCacheConfig(process.env);
if (cacheConfig.mode !== "azure-table") {
  throw new Error("Live report cache verification requires azure-table mode");
}

function request(userUpn: string, siteId?: string): ReportRequest {
  return {
    userUpn,
    capability: "ReportViewer",
    scenario: "current",
    filters: { siteId, page: 1, pageSize: 6 },
  };
}

async function report(userUpn: string) {
  const input = request(userUpn);
  return buildReport(await loadReportSource(input, cacheConfig), input);
}

const [evp, project, sibling, noAssignment] = await Promise.all([
  report("nipaporn@contoso.com"),
  report("prach@contoso.com"),
  report("kittipong@contoso.com"),
  report("somchai@contoso.com"),
]);
assert.equal(evp.scopeSensitiveCount, 12);
assert.equal(evp.siteRollups[0]?.siteName, "DGCS");
assert.equal(evp.latestRun?.status, "partial");
assert.equal(project.scopeSensitiveCount, 12);
assert.equal(project.allowedSiteIds.length, 1);
assert.equal(sibling.state, "no-sites");
assert.equal(noAssignment.state, "no-assignment");

const unauthorized = request("prach@contoso.com", "out-of-scope-site");
await assert.rejects(
  () => loadReportSource(unauthorized, cacheConfig),
  ReportAuthorizationError,
);

process.stdout.write(`${JSON.stringify({
  status: "verified",
  cacheMode: cacheConfig.mode,
  evpSensitiveCount: evp.scopeSensitiveCount,
  projectSensitiveCount: project.scopeSensitiveCount,
  latestRunStatus: evp.latestRun?.status,
  siblingState: sibling.state,
  noAssignmentState: noAssignment.state,
  crossScopeRequest: "denied",
})}\n`);
