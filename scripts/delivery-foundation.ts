import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { loadCustomerDeliveryManifest } from "../src/delivery/manifest";

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`Expected ${name} <value>`);
  return value;
}

const operation = process.argv.includes("--deploy") ? "create" : process.argv.includes("--what-if") ? "what-if" : undefined;
if (!operation) throw new Error("Expected --what-if or --deploy");
const manifest = loadCustomerDeliveryManifest(argument("--manifest"));
const assignTableDataRole = manifest.rbac.mode === "deploy";

const temporaryDirectory = mkdtempSync(join(tmpdir(), "sp-customer-delivery-"));
const parameterFile = join(temporaryDirectory, "parameters.json");
writeFileSync(parameterFile, JSON.stringify({
  $schema: "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
  contentVersion: "1.0.0.0",
  parameters: {
    deploymentName: { value: manifest.deploymentName },
    location: { value: manifest.location },
    resourceGroupName: { value: manifest.resourceGroupName },
    storageAccountName: { value: manifest.storageAccountName },
    assignTableDataRole: { value: assignTableDataRole },
    tableDataPrincipalId: { value: manifest.rbac.tableDataPrincipalId ?? "00000000-0000-0000-0000-000000000000" },
    tableDataPrincipalType: { value: manifest.rbac.tableDataPrincipalType ?? "ServicePrincipal" },
    tags: { value: manifest.tags },
  },
}), { mode: 0o600 });

try {
  const result = spawnSync("az", [
    "deployment",
    "sub",
    operation,
    "--subscription",
    manifest.subscriptionId,
    "--location",
    manifest.location,
    "--name",
    `${manifest.deploymentName}-foundation-v1`,
    "--template-file",
    resolve("infra/customer-delivery-foundation/main.bicep"),
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
