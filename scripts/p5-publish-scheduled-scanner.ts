import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

function required(...names: string[]) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  throw new Error(`${names.join(" or ")} is required`);
}

function azJson(args: string[]) {
  const result = spawnSync("az", [...args, "--only-show-errors", "--output", "json"], {
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.trim() || "Azure CLI command failed");
  return JSON.parse(result.stdout) as unknown;
}

function outputValue(outputs: unknown, name: string) {
  if (!outputs || typeof outputs !== "object") throw new Error("Deployment outputs are unavailable");
  const output = (outputs as Record<string, unknown>)[name];
  if (!output || typeof output !== "object" || !("value" in output)) {
    throw new Error(`Deployment output ${name} is unavailable`);
  }
  const value = (output as { value?: unknown }).value;
  if (typeof value !== "string" || !value) throw new Error(`Deployment output ${name} is invalid`);
  return value;
}

function requireExactRole(input: {
  subscriptionId: string;
  principalId: string;
  role: string;
  scope: string;
}) {
  const roles = azJson([
    "role", "assignment", "list",
    "--subscription", input.subscriptionId,
    "--assignee-object-id", input.principalId,
    "--scope", input.scope,
    "--query", "[].roleDefinitionName",
  ]);
  if (!Array.isArray(roles) || !roles.includes(input.role)) {
    throw new Error(`${input.role} is missing at ${input.scope}`);
  }
}

const subscriptionId = required("P5_AZURE_SUBSCRIPTION_ID", "P6_AZURE_SUBSCRIPTION_ID");
const resourceGroup = required("P5_AZURE_RESOURCE_GROUP", "P6_AZURE_RESOURCE_GROUP");
const outputs = azJson([
  "deployment", "group", "show",
  "--subscription", subscriptionId,
  "--resource-group", resourceGroup,
  "--name", "p5-scheduled-scanner-v1",
  "--query", "properties.outputs",
]);
const functionAppName = outputValue(outputs, "functionAppName");
const hostStorageAccountName = outputValue(outputs, "hostStorageAccountName");
const hostPrincipalId = outputValue(outputs, "hostIdentityPrincipalId");
const scannerPrincipalId = outputValue(outputs, "scannerIdentityPrincipalId");
const applicationInsightsName = outputValue(outputs, "applicationInsightsName");
const resourceGroupScope = `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}`;
const hostStorageScope = `${resourceGroupScope}/providers/Microsoft.Storage/storageAccounts/${hostStorageAccountName}`;
const reportCacheScope = `${resourceGroupScope}/providers/Microsoft.Storage/storageAccounts/${required("AZURE_STORAGE_ACCOUNT_NAME")}`;
const applicationInsightsScope = `${resourceGroupScope}/providers/Microsoft.Insights/components/${applicationInsightsName}`;

for (const role of ["Storage Blob Data Owner", "Storage Queue Data Contributor", "Storage Table Data Contributor"]) {
  requireExactRole({ subscriptionId, principalId: hostPrincipalId, role, scope: hostStorageScope });
}
requireExactRole({
  subscriptionId,
  principalId: scannerPrincipalId,
  role: "Storage Table Data Contributor",
  scope: reportCacheScope,
});
requireExactRole({
  subscriptionId,
  principalId: hostPrincipalId,
  role: "Monitoring Metrics Publisher",
  scope: applicationInsightsScope,
});

const archive = resolve("outputs/scheduled-scanner.zip");
if (!existsSync(archive)) throw new Error("Run npm run p5:scanner:package before publishing");
const deployment = spawnSync("az", [
  "functionapp", "deployment", "source", "config-zip",
  "--subscription", subscriptionId,
  "--resource-group", resourceGroup,
  "--name", functionAppName,
  "--src", archive,
  "--timeout", "600",
  "--only-show-errors",
  "--output", "none",
], { stdio: "inherit" });
if (deployment.error) throw deployment.error;
if (deployment.status !== 0) process.exitCode = deployment.status ?? 1;
else process.stdout.write(`${JSON.stringify({ status: "published", functionAppName })}\n`);

