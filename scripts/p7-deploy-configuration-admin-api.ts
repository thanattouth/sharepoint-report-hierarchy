import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const operation = process.argv[2];
if (operation !== "--what-if" && operation !== "--deploy") {
  throw new Error("Expected --what-if or --deploy");
}
const roleFlag = required("P7_ASSIGN_MANAGED_IDENTITY_ROLES");
if (roleFlag !== "true" && roleFlag !== "false") {
  throw new Error("P7_ASSIGN_MANAGED_IDENTITY_ROLES must be true or false");
}
const parameterValues = {
  location: required("P7_AZURE_LOCATION"),
  reportCacheStorageAccountName: required("AZURE_STORAGE_ACCOUNT_NAME"),
  reportCacheTenantId: required("REPORT_CACHE_TENANT_ID"),
  allowedActors: required("CONFIG_ADMIN_ALLOWED_ACTORS"),
  assignManagedIdentityRoles: roleFlag === "true",
};
const temporaryDirectory = mkdtempSync(join(tmpdir(), "sp-config-admin-api-"));
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
    "deployment", "group", operation === "--what-if" ? "what-if" : "create",
    "--subscription", required("P7_AZURE_SUBSCRIPTION_ID"),
    "--resource-group", required("P7_AZURE_RESOURCE_GROUP"),
    "--name", "p7-configuration-admin-api-v1",
    "--template-file", resolve("infra/configuration-admin-api/main.bicep"),
    "--parameters", `@${parameterFile}`,
    "--only-show-errors",
    "--output", "json",
  ], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
