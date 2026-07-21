import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { parseCustomerDeliveryManifest } from "../src/delivery/manifest";

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 2,
    deploymentName: "customer-single-tenant",
    tenantId: "11111111-1111-4111-8111-111111111111",
    subscriptionId: "22222222-2222-4222-8222-222222222222",
    location: "southeastasia",
    resourceGroupName: "rg-sp-sensitivity-customer-sea",
    storageAccountName: "stspsenscustomer01",
    entra: {
      webAppDisplayName: "sharepoint-sensitivity-report-web-customer",
      scannerAppDisplayName: "sharepoint-sensitivity-scanner-customer",
      webRedirectUris: ["http://localhost:3000/api/auth/entra/callback"],
    },
    rbac: { mode: "admin-handoff" },
    tags: { workload: "sharepoint-sensitivity-report" },
    ...overrides,
  };
}

test("accepts an isolated customer delivery manifest with admin RBAC handoff", () => {
  const parsed = parseCustomerDeliveryManifest(manifest());
  assert.equal(parsed.rbac.mode, "admin-handoff");
  assert.equal(parsed.location, "southeastasia");
});

test("requires an explicit principal when deployment owns RBAC", () => {
  assert.throws(
    () => parseCustomerDeliveryManifest(manifest({ rbac: { mode: "deploy" } })),
    /requires tableDataPrincipalId and tableDataPrincipalType/,
  );
});

test("rejects unsafe or tenant-specific manifest extensions", () => {
  assert.throws(
    () => parseCustomerDeliveryManifest(manifest({ clientSecret: "must-not-live-here" })),
    /unknown keys: clientSecret/,
  );
});

test("rejects invalid resource names before Azure mutation", () => {
  assert.throws(
    () => parseCustomerDeliveryManifest(manifest({ storageAccountName: "Not-Valid" })),
    /3-24 lowercase alphanumeric/,
  );
});

test("rejects non-HTTPS customer callback origins", () => {
  assert.throws(
    () => parseCustomerDeliveryManifest(manifest({
      entra: {
        webAppDisplayName: "report-web",
        scannerAppDisplayName: "scanner",
        webRedirectUris: ["http://customer.example/api/auth/entra/callback"],
      },
    })),
    /must use HTTPS outside localhost/,
  );
});

test("committed delivery example contains a valid schedules-disabled workload contract", () => {
  const parsed = parseCustomerDeliveryManifest(JSON.parse(readFileSync("config/customer-delivery.example.json", "utf8")));
  assert.equal(parsed.workloads?.scanner.schedulesDisabled, true);
  assert.equal(parsed.workloads?.scanner.scopeMode, "single-site");
  assert.equal(parsed.webHosting?.skuName, "B1");
});

test("requires the exact App Service callback when customer web hosting is configured", () => {
  assert.throws(
    () => parseCustomerDeliveryManifest(manifest({
      webHosting: {
        appServiceName: "app-sp-sens-customer",
        appServicePlanName: "plan-sp-sens-web-customer-sea",
        keyVaultName: "kv-sp-sens-customer",
        skuName: "B1",
        reportApiFunctionAppName: "func-sp-sens-report-customer",
        configurationAdminFunctionAppName: "func-sp-sens-config-customer",
        groupPickerEnabled: false,
      },
    })),
    /must contain https:\/\/app-sp-sens-customer\.azurewebsites\.net\/api\/auth\/entra\/callback/,
  );
});

test("initial delivery rejects enabled schedules", () => {
  const configured = JSON.parse(readFileSync("config/customer-delivery.example.json", "utf8"));
  configured.workloads.scanner.schedulesDisabled = false;
  assert.throws(() => parseCustomerDeliveryManifest(configured), /requires schedulesDisabled=true/);
});
