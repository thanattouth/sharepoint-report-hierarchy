import assert from "node:assert/strict";
import test from "node:test";
import {
  parseReportApiRequest,
  ReportApiAuthorizationError,
  ReportApiRequestError,
} from "../src/report/api-config";

const tenantId = "99999999-9999-4999-8999-999999999999";

test("report API accepts a verified same-tenant guest without a per-user allowlist", () => {
  const headers = new Headers({
    "x-report-tenant-id": tenantId,
    "x-report-user-upn": "Thanattouth_M365.co.th#EXT#@BAHTNET.onmicrosoft.com",
    "x-report-user-object-id": "11111111-2222-4333-8444-555555555555",
    "x-report-group-object-ids": "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE",
    "x-report-capability": "ReportViewer",
  });
  const request = parseReportApiRequest(
    "https://localhost/api/report?site=site-1&page=2&pageSize=20",
    tenantId,
    headers,
  );
  assert.equal(request.userUpn, "thanattouth_m365.co.th#ext#@bahtnet.onmicrosoft.com");
  assert.equal(request.principalContext?.tenantId, tenantId);
  assert.equal(request.capability, "ReportViewer");
  assert.equal(request.scenario, "current");
  assert.equal(request.filters.siteId, "site-1");
  assert.equal(request.filters.page, 2);
  assert.equal(request.filters.pageSize, 20);
});

test("report API fails closed on tenant or verified identity mismatch", () => {
  const validHeaders = {
    "x-report-tenant-id": tenantId,
    "x-report-user-upn": "viewer@contoso.com",
    "x-report-user-object-id": "11111111-2222-4333-8444-555555555555",
    "x-report-group-object-ids": "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE",
    "x-report-capability": "ReportViewer",
  };
  assert.throws(
    () => parseReportApiRequest(
      "https://localhost/api/report",
      tenantId,
      new Headers({
        ...validHeaders,
        "x-report-tenant-id": "88888888-8888-4888-8888-888888888888",
      }),
    ),
    ReportApiAuthorizationError,
  );
  assert.throws(
    () => parseReportApiRequest(
      "https://localhost/api/report",
      tenantId,
      new Headers({ ...validHeaders, "x-report-capability": "" }),
    ),
    ReportApiAuthorizationError,
  );
});

test("report API keeps malformed filters separate from authorization failures", () => {
  const headers = new Headers({
    "x-report-tenant-id": tenantId,
    "x-report-user-upn": "viewer@contoso.com",
    "x-report-user-object-id": "11111111-2222-4333-8444-555555555555",
    "x-report-capability": "ReportViewer",
  });
  assert.throws(
    () => parseReportApiRequest(
      "https://localhost/api/report?status=made-up",
      tenantId,
      headers,
    ),
    ReportApiRequestError,
  );
});
