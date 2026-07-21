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
    maxBuffer: 8 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.trim() || `az ${args[0]} failed`);
  return JSON.parse(result.stdout) as T;
}

function azVoid(args: string[]): void {
  const result = spawnSync("az", [...args, "--only-show-errors", "-o", "none"], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.trim() || `az ${args[0]} failed`);
}

function exactWebApplication(displayName: string) {
  const escaped = displayName.replaceAll("'", "''");
  const applications = azJson<Array<{ appId: string; id: string; signInAudience?: string }>>([
    "ad", "app", "list", "--filter", `displayName eq '${escaped}'`,
    "--query", "[].{appId:appId,id:id,signInAudience:signInAudience}",
  ]);
  if (applications.length !== 1) throw new Error(`Expected exactly one Entra application: ${displayName}`);
  if (applications[0].signInAudience !== "AzureADMyOrg") throw new Error("Report Web application is not single-tenant");
  return applications[0];
}

const manifest = loadCustomerDeliveryManifest(argument("--manifest"));
const hosting = manifest.webHosting;
if (!hosting) throw new Error("Delivery manifest does not contain webHosting configuration");
const operation = process.argv.includes("--deploy") ? "create" : process.argv.includes("--what-if") ? "what-if" : undefined;
if (!operation) throw new Error("Expected --what-if or --deploy");

const account = azJson<{ tenantId: string; id: string }>(["account", "show", "--query", "{tenantId:tenantId,id:id}"]);
if (account.tenantId.toLowerCase() !== manifest.tenantId.toLowerCase() || account.id.toLowerCase() !== manifest.subscriptionId.toLowerCase()) {
  throw new Error("Azure CLI tenant/subscription does not match the delivery manifest");
}
const operator = azJson<{ id: string }>(["ad", "signed-in-user", "show", "--query", "{id:id}"]);
const webApplication = exactWebApplication(manifest.entra.webAppDisplayName);
const webServicePrincipals = azJson<Array<{ id: string; appRoleAssignmentRequired: boolean }>>([
  "ad", "sp", "list", "--filter", `appId eq '${webApplication.appId}'`,
  "--query", "[].{id:id,appRoleAssignmentRequired:appRoleAssignmentRequired}",
]);
if (webServicePrincipals.length !== 1) throw new Error("Expected exactly one Report Web enterprise application");

if (hosting.groupPickerEnabled) {
  const grants = azJson<{ value: Array<{ consentType: string; scope: string }> }>([
    "rest", "--method", "get",
    "--url", `https://graph.microsoft.com/v1.0/oauth2PermissionGrants?$filter=clientId eq '${webServicePrincipals[0].id}'`,
  ]);
  if (!grants.value.some((grant) => grant.consentType === "AllPrincipals" && grant.scope.split(/\s+/).includes("GroupMember.Read.All"))) {
    throw new Error("Group picker requires tenant-wide delegated GroupMember.Read.All admin consent");
  }
}

const temporaryDirectory = mkdtempSync(join(tmpdir(), "sp-delivery-web-"));
const parameterFile = join(temporaryDirectory, "parameters.json");
writeFileSync(parameterFile, JSON.stringify({
  $schema: "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
  contentVersion: "1.0.0.0",
  parameters: {
    location: { value: manifest.location },
    appServiceName: { value: hosting.appServiceName },
    appServicePlanName: { value: hosting.appServicePlanName },
    skuName: { value: hosting.skuName },
    keyVaultName: { value: hosting.keyVaultName },
    operatorPrincipalId: { value: operator.id },
    entraTenantId: { value: manifest.tenantId },
    entraClientId: { value: webApplication.appId },
    webOrigin: { value: `https://${hosting.appServiceName}.azurewebsites.net` },
    groupPickerEnabled: { value: hosting.groupPickerEnabled },
    reportApiFunctionAppName: { value: hosting.reportApiFunctionAppName },
    configurationAdminFunctionAppName: { value: hosting.configurationAdminFunctionAppName },
    tags: { value: manifest.tags },
  },
}), { mode: 0o600 });

try {
  const result = spawnSync("az", [
    "deployment", "group", operation,
    "--subscription", manifest.subscriptionId,
    "--resource-group", manifest.resourceGroupName,
    "--name", "p8-report-web-app-v1",
    "--template-file", resolve("infra/web-app/main.bicep"),
    "--parameters", `@${parameterFile}`,
    "--only-show-errors",
    ...(operation === "what-if" ? ["--result-format", "ResourceIdOnly"] : []),
    "--output", operation === "create" ? "none" : "json",
  ], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`p8-report-web-app-v1 ${operation} failed`);

  if (operation === "create") {
    azVoid([
      "ad", "app", "update", "--id", webApplication.appId,
      "--enable-id-token-issuance", "false",
      "--enable-access-token-issuance", "false",
      "--web-redirect-uris", ...manifest.entra.webRedirectUris,
    ]);
    azVoid([
      "ad", "sp", "update", "--id", webServicePrincipals[0].id,
      "--set", "appRoleAssignmentRequired=true",
    ]);
  }

  process.stdout.write(`${JSON.stringify({
    event: "customer-delivery-web-hosting",
    operation,
    appServiceName: hosting.appServiceName,
    keyVaultName: hosting.keyVaultName,
    enterpriseApplicationAssignmentRequired: operation === "create" ? true : undefined,
    clientSecretCreated: false,
  })}\n`);
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
