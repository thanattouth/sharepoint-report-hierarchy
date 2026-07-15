import assert from "node:assert/strict";
import test from "node:test";
import { loadReportCacheConfig } from "../src/report/cache-config";

const tenantId = "11111111-1111-4111-8111-111111111111";

function azureEnv() {
  return {
    REPORT_DATA_SOURCE: "azure-table",
    REPORT_CACHE_TENANT_ID: tenantId,
    REPORT_REPORTABLE_LABEL_IDS: "22222222-2222-4222-8222-222222222222",
    REPORT_PILOT_SITE_ID: "contoso.sharepoint.com,site,web",
    REPORT_PILOT_SITE_NAME: "DGCS",
    REPORT_PILOT_SITE_HOSTNAME: "contoso.sharepoint.com",
    REPORT_PILOT_SITE_PATH: "/sites/DGCS",
    REPORT_PILOT_SITE_NODE_ID: "project-aurora",
    AZURE_STORAGE_ACCOUNT_NAME: "senspilot123",
    AZURE_STORAGE_TENANT_ID: tenantId,
    AZURE_TABLE_AUTH_MODE: "azure-cli",
  };
}

test("report cache defaults to fixtures and Azure mode fails closed", () => {
  assert.deepEqual(loadReportCacheConfig({}), { mode: "fixture" });
  assert.throws(
    () => loadReportCacheConfig({ REPORT_DATA_SOURCE: "azure-table" }),
    /REPORT_PILOT_SITE_HOSTNAME/,
  );
  assert.throws(
    () => loadReportCacheConfig({ ...azureEnv(), REPORT_MAX_DETAIL_SITES: "1000" }),
    /REPORT_MAX_DETAIL_SITES/,
  );
  const config = loadReportCacheConfig(azureEnv());
  assert.equal(config.mode, "azure-table");
  if (config.mode !== "azure-table") return;
  assert.equal(config.cacheTenantId, tenantId);
  assert.equal(config.pilotSite.id, "contoso.sharepoint.com,site,web");
  assert.equal(config.pilotSiteNodeId, "project-aurora");
  assert.deepEqual([...config.reportableLabelIds], [
    "22222222-2222-4222-8222-222222222222",
  ]);
});
