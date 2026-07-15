import assert from "node:assert/strict";
import test from "node:test";
import {
  loadReportApiConfig,
  parseReportApiRequest,
  ReportApiRequestError,
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
  const request = parseReportApiRequest(
    "https://localhost/api/report?user=Nipaporn%40contoso.com&site=site-1&page=2&pageSize=20",
    config,
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
    ),
    ReportApiRequestError,
  );
  assert.throws(
    () => parseReportApiRequest(
      "https://localhost/api/report?user=nipaporn%40contoso.com&status=made-up",
      config,
    ),
    /status is invalid/,
  );
});
