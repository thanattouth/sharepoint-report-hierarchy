import assert from "node:assert/strict";
import test from "node:test";
import { fetchReportFromApi } from "../src/report/api-client";
import type { ReportData, ReportRequest } from "../src/report/report-service";

const request: ReportRequest = {
  userUpn: "nipaporn@contoso.com",
  capability: "ReportViewer",
  scenario: "current",
  filters: { siteId: "site-1", page: 2, pageSize: 25 },
};

const body = {
  state: "ready",
  userUpn: request.userUpn,
  capability: "ReportViewer",
  scopeSensitiveCount: 12,
  allowedSiteIds: ["site-1"],
  rows: [],
  siteRollups: [],
  hierarchyRollups: [],
  options: { nodes: [], sites: [], libraries: [], labels: [] },
} as unknown as ReportData;

test("Sites API client keeps the function key in a server-side header", async () => {
  let requestedUrl = "";
  let requestedKey: string | null = null;
  const report = await fetchReportFromApi(
    {
      mode: "azure-api",
      baseUrl: "https://report.example.com/api",
      functionKey: "server-secret",
      timeoutMs: 1000,
    },
    request,
    async (input, init) => {
      requestedUrl = input.toString();
      requestedKey = new Headers(init?.headers).get("x-functions-key");
      return Response.json(body);
    },
  );
  assert.equal(report.scopeSensitiveCount, 12);
  assert.match(requestedUrl, /user=nipaporn%40contoso.com/);
  assert.match(requestedUrl, /site=site-1/);
  assert.doesNotMatch(requestedUrl, /server-secret/);
  assert.equal(requestedKey, "server-secret");
});
