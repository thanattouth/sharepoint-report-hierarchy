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

function azJson<T>(args: string[]): T {
  const result = spawnSync("az", [...args, "--only-show-errors", "-o", "json"], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.trim() || `az ${args[0]} failed`);
  return JSON.parse(result.stdout) as T;
}

function exactApplicationId(displayName: string): string {
  const escaped = displayName.replaceAll("'", "''");
  const applications = azJson<Array<{ appId: string; signInAudience?: string }>>([
    "ad", "app", "list",
    "--filter", `displayName eq '${escaped}'`,
    "--query", "[].{appId:appId,signInAudience:signInAudience}",
  ]);
  if (applications.length !== 1) throw new Error(`Expected exactly one Entra application: ${displayName}`);
  if (applications[0].signInAudience !== "AzureADMyOrg") throw new Error(`${displayName} is not single-tenant`);
  return applications[0].appId;
}

function deploy(input: {
  operation: "what-if" | "create";
  subscriptionId: string;
  resourceGroupName: string;
  name: string;
  template: string;
  parameters: Record<string, unknown>;
  temporaryDirectory: string;
}): void {
  const parameterFile = join(input.temporaryDirectory, `${input.name}.parameters.json`);
  writeFileSync(parameterFile, JSON.stringify({
    $schema: "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
    contentVersion: "1.0.0.0",
    parameters: Object.fromEntries(Object.entries(input.parameters).map(([name, value]) => [name, { value }])),
  }), { mode: 0o600 });
  const result = spawnSync("az", [
    "deployment", "group", input.operation,
    "--subscription", input.subscriptionId,
    "--resource-group", input.resourceGroupName,
    "--name", input.name,
    "--template-file", resolve(input.template),
    "--parameters", `@${parameterFile}`,
    "--only-show-errors",
    ...(input.operation === "what-if" ? ["--result-format", "ResourceIdOnly"] : []),
    "--output", input.operation === "create" ? "none" : "json",
  ], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${input.name} ${input.operation} failed`);
}

const manifest = loadCustomerDeliveryManifest(argument("--manifest"));
const workloads = manifest.workloads;
if (!workloads) throw new Error("Delivery manifest does not contain workloads configuration");
const operation = process.argv.includes("--deploy") ? "create" : process.argv.includes("--what-if") ? "what-if" : undefined;
if (!operation) throw new Error("Expected --what-if or --deploy");

const account = azJson<{ tenantId: string; id: string }>(["account", "show", "--query", "{tenantId:tenantId,id:id}"]);
if (account.tenantId.toLowerCase() !== manifest.tenantId.toLowerCase() || account.id.toLowerCase() !== manifest.subscriptionId.toLowerCase()) {
  throw new Error("Azure CLI tenant/subscription does not match the delivery manifest");
}
const operator = azJson<{ id: string }>([
  "ad", "signed-in-user", "show", "--query", "{id:id}",
]);
const operatorRoles = azJson<Array<{ roleDefinitionName: string }>>([
  "role", "assignment", "list",
  "--subscription", manifest.subscriptionId,
  "--assignee-object-id", operator.id,
  "--all", "--include-inherited",
  "--query", "[].{roleDefinitionName:roleDefinitionName}",
]);
if (!operatorRoles.some(({ roleDefinitionName }) => [
  "Owner",
  "Role Based Access Control Administrator",
  "User Access Administrator",
].includes(roleDefinitionName))) {
  throw new Error(
    "Workload deployment requires permission to create exact-scope managed-identity role assignments",
  );
}
const scannerClientId = exactApplicationId(manifest.entra.scannerAppDisplayName);
const labelIds = workloads.scanner.reportableLabels.map(({ id }) => id).join(",");
const labelDisplayNames = JSON.stringify(Object.fromEntries(
  workloads.scanner.reportableLabels.map(({ id, displayName }) => [id, displayName]),
));
const temporaryDirectory = mkdtempSync(join(tmpdir(), "sp-delivery-workloads-"));

try {
  deploy({
    operation,
    subscriptionId: manifest.subscriptionId,
    resourceGroupName: manifest.resourceGroupName,
    name: "p5-scheduled-scanner-v1",
    template: "infra/scheduled-scanner/main.bicep",
    temporaryDirectory,
    parameters: {
      location: manifest.location,
      reportCacheStorageAccountName: manifest.storageAccountName,
      scannerTenantId: manifest.tenantId,
      scannerClientId,
      allowedSiteId: workloads.bootstrapSite.id,
      scannerScopeMode: workloads.scanner.scopeMode,
      allowedLibraryNames: workloads.scanner.allowedLibraryNames.join(","),
      reportableLabelIds: labelIds,
      labelDisplayNamesJson: labelDisplayNames,
      maxConcurrency: workloads.scanner.maxConcurrency,
      maxRetries: workloads.scanner.maxRetries,
      nightlySchedule: workloads.scanner.nightlySchedule,
      reconciliationSchedule: workloads.scanner.reconciliationSchedule,
      schedulesDisabled: workloads.scanner.schedulesDisabled,
      assignManagedIdentityRoles: true,
    },
  });
  deploy({
    operation,
    subscriptionId: manifest.subscriptionId,
    resourceGroupName: manifest.resourceGroupName,
    name: "p6-report-cache-api-v1",
    template: "infra/report-cache-api/main.bicep",
    temporaryDirectory,
    parameters: {
      location: manifest.location,
      reportCacheStorageAccountName: manifest.storageAccountName,
      reportCacheTenantId: manifest.tenantId,
      reportableLabelIds: labelIds,
      pilotSiteId: workloads.bootstrapSite.id,
      pilotSiteName: workloads.bootstrapSite.name,
      pilotSiteHostname: workloads.bootstrapSite.hostname,
      pilotSitePath: workloads.bootstrapSite.path,
      pilotSiteNodeId: workloads.bootstrapSite.businessNodeId,
      maxDetailSites: workloads.report.maxDetailSites,
      assignManagedIdentityRoles: true,
    },
  });
  deploy({
    operation,
    subscriptionId: manifest.subscriptionId,
    resourceGroupName: manifest.resourceGroupName,
    name: "p7-configuration-admin-api-v1",
    template: "infra/configuration-admin-api/main.bicep",
    temporaryDirectory,
    parameters: {
      location: manifest.location,
      reportCacheStorageAccountName: manifest.storageAccountName,
      reportCacheTenantId: manifest.tenantId,
      allowedActors: workloads.configurationAdmin.allowedActors.join(","),
      assignManagedIdentityRoles: true,
    },
  });
  process.stdout.write(`${JSON.stringify({
    event: "customer-delivery-workloads",
    operation,
    deployments: ["p5-scheduled-scanner-v1", "p6-report-cache-api-v1", "p7-configuration-admin-api-v1"],
    schedulesDisabled: workloads.scanner.schedulesDisabled,
  })}\n`);
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
