import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function azJson(args: string[]) {
  const result = spawnSync("az", [...args, "--only-show-errors", "--output", "json"], { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.trim() || "Azure CLI command failed");
  return JSON.parse(result.stdout) as unknown;
}

function outputValue(outputs: unknown, name: string) {
  if (!outputs || typeof outputs !== "object") throw new Error("Deployment outputs are unavailable");
  const output = (outputs as Record<string, unknown>)[name];
  const value = output && typeof output === "object" && "value" in output
    ? (output as { value?: unknown }).value
    : undefined;
  if (typeof value !== "string" || !value) throw new Error(`Deployment output ${name} is unavailable`);
  return value;
}

function requireExactRole(input: { subscriptionId: string; principalId: string; role: string; scope: string }) {
  const assignments = azJson([
    "role", "assignment", "list",
    "--subscription", input.subscriptionId,
    "--assignee-object-id", input.principalId,
    "--scope", input.scope,
    "--query", "[].{role:roleDefinitionName,scope:scope}",
  ]);
  if (!Array.isArray(assignments) || !assignments.some((assignment) =>
    assignment && typeof assignment === "object"
      && (assignment as { role?: unknown }).role === input.role
      && String((assignment as { scope?: unknown }).scope).toLowerCase() === input.scope.toLowerCase())) {
    throw new Error(`${input.role} is missing at exact scope ${input.scope}`);
  }
}

const subscriptionId = required("P7_AZURE_SUBSCRIPTION_ID");
const resourceGroup = required("P7_AZURE_RESOURCE_GROUP");
const outputs = azJson([
  "deployment", "group", "show",
  "--subscription", subscriptionId,
  "--resource-group", resourceGroup,
  "--name", "p7-configuration-admin-api-v1",
  "--query", "properties.outputs",
]);
const functionAppName = outputValue(outputs, "functionAppName");
const hostPrincipalId = outputValue(outputs, "hostIdentityPrincipalId");
const writerPrincipalId = outputValue(outputs, "configurationWriterIdentityPrincipalId");
const applicationInsightsName = outputValue(outputs, "applicationInsightsName");
const hostStorageAccountName = outputValue(outputs, "hostStorageAccountName");
const resourceGroupScope = `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}`;
const hostStorageScope = `${resourceGroupScope}/providers/Microsoft.Storage/storageAccounts/${hostStorageAccountName}`;
const applicationInsightsScope = `${resourceGroupScope}/providers/Microsoft.Insights/components/${applicationInsightsName}`;

requireExactRole({ subscriptionId, principalId: hostPrincipalId, role: "Storage Blob Data Owner", scope: hostStorageScope });
requireExactRole({ subscriptionId, principalId: hostPrincipalId, role: "Storage Table Data Contributor", scope: hostStorageScope });
requireExactRole({ subscriptionId, principalId: hostPrincipalId, role: "Monitoring Metrics Publisher", scope: applicationInsightsScope });
for (const output of [
  "hierarchyNodesScope",
  "scopeAssignmentsScope",
  "hierarchySitePlacementsScope",
  "hierarchySiteMappingAuditScope",
]) {
  requireExactRole({
    subscriptionId,
    principalId: writerPrincipalId,
    role: "Storage Table Data Contributor",
    scope: outputValue(outputs, output),
  });
}
requireExactRole({
  subscriptionId,
  principalId: writerPrincipalId,
  role: "Storage Table Data Reader",
  scope: outputValue(outputs, "scannerSitesScope"),
});

const archive = resolve("outputs/configuration-admin-api.zip");
if (!existsSync(archive)) throw new Error("Run npm run p7:admin:package before publishing");
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
