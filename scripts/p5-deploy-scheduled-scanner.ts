import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

function required(...names: string[]) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  throw new Error(`${names.join(" or ")} is required`);
}

const operation = process.argv[2];
if (operation !== "--what-if" && operation !== "--deploy") {
  throw new Error("Expected --what-if or --deploy");
}

const roleFlag = required("P5_ASSIGN_MANAGED_IDENTITY_ROLES");
if (roleFlag !== "true" && roleFlag !== "false") {
  throw new Error("P5_ASSIGN_MANAGED_IDENTITY_ROLES must be true or false");
}

const scheduleFlag = required("P5_SCHEDULES_DISABLED");
if (scheduleFlag !== "true" && scheduleFlag !== "false") {
  throw new Error("P5_SCHEDULES_DISABLED must be true or false");
}

const parameterValues = {
  location: required("P5_AZURE_LOCATION", "P6_AZURE_LOCATION"),
  reportCacheStorageAccountName: required("AZURE_STORAGE_ACCOUNT_NAME"),
  scannerTenantId: required("SCANNER_TENANT_ID"),
  scannerClientId: required("P5_HOSTED_SCANNER_CLIENT_ID"),
  scannerScopeMode: process.env.SCANNER_SCOPE_MODE?.trim() || "single-site",
  allowedSiteId: required("SCANNER_ALLOWED_SITE_ID"),
  allowedLibraryNames: required("SCANNER_ALLOWED_LIBRARY_NAMES", "P4_PILOT_LIBRARY_NAMES"),
  reportableLabelIds: required("SCANNER_REPORTABLE_LABEL_IDS"),
  labelDisplayNamesJson: required("SCANNER_LABEL_DISPLAY_NAMES_JSON"),
  nightlySchedule: required("P5_NIGHTLY_SCHEDULE"),
  reconciliationSchedule: required("P5_RECONCILIATION_SCHEDULE"),
  schedulesDisabled: scheduleFlag === "true",
  assignManagedIdentityRoles: roleFlag === "true",
};

const temporaryDirectory = mkdtempSync(join(tmpdir(), "sp-scheduled-scanner-"));
const parameterFile = join(temporaryDirectory, "parameters.json");
writeFileSync(parameterFile, JSON.stringify({
  $schema: "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
  contentVersion: "1.0.0.0",
  parameters: Object.fromEntries(
    Object.entries(parameterValues).map(([name, value]) => [name, { value }]),
  ),
}), { mode: 0o600 });

try {
  const result = spawnSync("az", [
    "deployment",
    "group",
    operation === "--what-if" ? "what-if" : "create",
    "--subscription",
    required("P5_AZURE_SUBSCRIPTION_ID", "P6_AZURE_SUBSCRIPTION_ID"),
    "--resource-group",
    required("P5_AZURE_RESOURCE_GROUP", "P6_AZURE_RESOURCE_GROUP"),
    "--name",
    "p5-scheduled-scanner-v1",
    "--template-file",
    resolve("infra/scheduled-scanner/main.bicep"),
    "--parameters",
    `@${parameterFile}`,
    "--only-show-errors",
    "--output",
    "json",
  ], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
