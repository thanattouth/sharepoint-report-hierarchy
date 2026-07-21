import assert from "node:assert/strict";
import test from "node:test";
import { fetchReportFromApi } from "../src/report/api-client";
import type { ReportData, ReportRequest } from "../src/report/report-service";

const request: ReportRequest = {
  userUpn: "nipaporn@contoso.com",
  principalContext: {
    tenantId: "99999999-9999-4999-8999-999999999999",
    userUpn: "nipaporn@contoso.com",
    userObjectId: "11111111-2222-4333-8444-555555555555",
    groupObjectIds: ["aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"],
  },
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
  let requestedIdentity: string | null = null;
  let requestedTenant: string | null = null;
  let redirectMode: RequestRedirect | undefined;
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
      requestedIdentity = new Headers(init?.headers).get("x-report-user-object-id");
      requestedTenant = new Headers(init?.headers).get("x-report-tenant-id");
      redirectMode = init?.redirect;
      return Response.json(body);
    },
  );
  assert.equal(report.scopeSensitiveCount, 12);
  assert.doesNotMatch(requestedUrl, /user=/);
  assert.match(requestedUrl, /site=site-1/);
  assert.doesNotMatch(requestedUrl, /server-secret/);
  assert.equal(requestedKey, "server-secret");
  assert.equal(requestedIdentity, "11111111-2222-4333-8444-555555555555");
  assert.equal(requestedTenant, "99999999-9999-4999-8999-999999999999");
  assert.equal(redirectMode, "manual");
});

test("Sites API client rejects redirects without forwarding the function key", async () => {
  await assert.rejects(
    fetchReportFromApi(
      {
        mode: "azure-api",
        baseUrl: "https://report.example.com/api",
        functionKey: "server-secret",
        timeoutMs: 1000,
      },
      request,
      async () => new Response(null, {
        status: 302,
        headers: { Location: "https://another.example.com/report" },
      }),
    ),
    /redirects are not allowed/,
  );
});
