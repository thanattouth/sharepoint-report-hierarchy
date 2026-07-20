import assert from "node:assert/strict";
import test from "node:test";
import {
  loadReportApiConfig,
  parseReportApiRequest,
  ReportApiRequestError,
  selectAllowedPilotPersonas,
} from "../src/report/api-config";

test("report API requires an explicit pilot UPN allowlist", () => {
  assert.throws(() => loadReportApiConfig({}), /REPORT_PILOT_ALLOWED_UPNS/);
  assert.throws(
    () => loadReportApiConfig({ REPORT_PILOT_ALLOWED_UPNS: "not-a-upn" }),
    /valid comma-separated UPNs/,
  );
});

test("report API fixes capability and scenario while validating filters", () => {
  const config = loadReportApiConfig({
    REPORT_PILOT_ALLOWED_UPNS: "nipaporn@contoso.com,prach@contoso.com",
  });
  const headers = new Headers({
    "x-report-user-upn": "Nipaporn@contoso.com",
    "x-report-user-object-id": "11111111-2222-4333-8444-555555555555",
    "x-report-group-object-ids": "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE",
    "x-report-capability": "ReportViewer",
  });
  const request = parseReportApiRequest(
    "https://localhost/api/report?site=site-1&page=2&pageSize=20",
    config,
    headers,
  );
  assert.equal(request.userUpn, "nipaporn@contoso.com");
  assert.equal(request.capability, "ReportViewer");
  assert.equal(request.scenario, "current");
  assert.equal(request.filters.siteId, "site-1");
  assert.equal(request.filters.page, 2);
  assert.equal(request.filters.pageSize, 20);
  assert.throws(
    () => parseReportApiRequest(
      "https://localhost/api/report?user=outside%40contoso.com",
      config,
      new Headers({ ...Object.fromEntries(headers), "x-report-user-upn": "outside@contoso.com" }),
    ),
    ReportApiRequestError,
  );
  assert.throws(
    () => parseReportApiRequest(
      "https://localhost/api/report?user=nipaporn%40contoso.com&status=made-up",
      config,
      headers,
    ),
    /status is invalid/,
  );
});

test("Azure API persona selector exposes only the configured pilot allowlist", () => {
  const config = loadReportApiConfig({
    REPORT_PILOT_ALLOWED_UPNS: "evp@example.com,project@example.com",
  });
  assert.deepEqual(
    selectAllowedPilotPersonas([
      { upn: "other@example.com", name: "Other" },
      { upn: "project@example.com", name: "Project" },
      { upn: "evp@example.com", name: "EVP" },
    ], config),
    [
      { upn: "evp@example.com", name: "EVP" },
      { upn: "project@example.com", name: "Project" },
    ],
  );
  assert.throws(
    () => selectAllowedPilotPersonas([], config),
    /has no configured demo persona/,
  );
});
