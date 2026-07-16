import { spawnSync } from "node:child_process";
import { createAzureTableCredential } from "../src/stores/azure-table/auth";
import { loadAzureTableStoreConfig } from "../src/stores/azure-table/config";
import { createAzureTableStores } from "../src/stores/azure-table/stores";

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
const hostname = outputValue(outputs, "functionAppHostname");
const settings = azJson([
  "functionapp", "config", "appsettings", "list",
  "--subscription", subscriptionId,
  "--resource-group", resourceGroup,
  "--name", functionAppName,
  "--query", "[?contains(name, 'Disabled')].{name:name,value:value}",
]);
if (!Array.isArray(settings) || settings.some((setting) =>
  !setting || typeof setting !== "object" || (setting as { value?: unknown }).value !== "True"
)) {
  throw new Error("Refusing bounded Run now while a timer schedule is enabled");
}
const keys = azJson([
  "functionapp", "keys", "list",
  "--subscription", subscriptionId,
  "--resource-group", resourceGroup,
  "--name", functionAppName,
]);
if (!keys || typeof keys !== "object") throw new Error("Function keys are unavailable");
const functionKeys = (keys as { functionKeys?: unknown }).functionKeys;
if (!functionKeys || typeof functionKeys !== "object") throw new Error("Function keys are unavailable");
const functionKey = Object.values(functionKeys as Record<string, unknown>)
  .find((value): value is string => typeof value === "string" && Boolean(value));
if (!functionKey) throw new Error("Function key is unavailable");

const response = await fetch(`https://${hostname}/api/scanner/run-now`, {
  method: "POST",
  headers: { "x-functions-key": functionKey },
  redirect: "manual",
});
if (response.status !== 202) throw new Error(`Run now returned HTTP ${response.status}`);
const body = await response.json() as { runId?: unknown };
if (typeof body.runId !== "string" || !body.runId) throw new Error("Run now response is invalid");

const tableConfig = loadAzureTableStoreConfig(process.env);
const credential = createAzureTableCredential(tableConfig.auth);
const { scanRunStore } = createAzureTableStores({
  config: tableConfig,
  credential,
  tenantId: required("SCANNER_TENANT_ID"),
});
let completed = false;
for (let attempt = 0; attempt < 120; attempt += 1) {
  const run = await scanRunStore.get(body.runId);
  if (run && ["succeeded", "partial", "failed", "cancelled"].includes(run.status)) {
    process.stdout.write(`${JSON.stringify({
      runId: run.id,
      status: run.status,
      scannedCount: run.scannedCount,
      sensitiveCount: run.sensitiveCount,
      unsupportedCount: run.unsupportedCount,
      failedCount: run.failedCount,
    })}\n`);
    if (run.status === "failed" || run.status === "cancelled") process.exitCode = 1;
    completed = true;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 5_000));
}
if (!completed) throw new Error("Timed out waiting for the queued scanner run");
