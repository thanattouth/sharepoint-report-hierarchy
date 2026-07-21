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
  "--query", "[].{name:name,value:value}",
]);
if (!Array.isArray(settings)) throw new Error("Function app settings are unavailable");
const settingMap = new Map(settings.flatMap((setting) => {
  if (!setting || typeof setting !== "object") return [];
  const record = setting as { name?: unknown; value?: unknown };
  return typeof record.name === "string" && typeof record.value === "string"
    ? [[record.name, record.value] as const]
    : [];
}));
if (settingMap.get("AzureWebJobs.nightlySchedule.Disabled") !== "True"
  || settingMap.get("AzureWebJobs.weeklyReconciliation.Disabled") !== "True") {
  throw new Error("Refusing Wave 1 while either timer schedule is enabled");
}
if (settingMap.get("SCANNER_SCOPE_MODE") !== "registry"
  || settingMap.get("SCANNER_BASELINE_WINDOW_OPEN")?.toLowerCase() !== "true") {
  throw new Error("Refusing Wave 1 while its registry scope or baseline window is closed");
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

for (let attempt = 0; attempt < 600; attempt += 1) {
  const response = await fetch(`https://${hostname}/api/scanner/run-baseline-next?wave=1`, {
    method: "POST",
    headers: { "x-functions-key": functionKey },
    redirect: "manual",
  });
  if (response.status !== 200 && response.status !== 202) {
    const detail = (await response.text()).slice(0, 200);
    throw new Error(`Wave 1 coordinator returned HTTP ${response.status}: ${detail}`);
  }
  const result = await response.json() as Record<string, unknown>;
  if (!(["queued", "in-progress", "review-required", "stopped", "complete"] as unknown[])
    .includes(result.state)
    || !Number.isInteger(result.completedSiteCount)
    || !Number.isInteger(result.totalSiteCount)
    || Number(result.totalSiteCount) < 1
    || Number(result.totalSiteCount) > 10
    || !Number.isInteger(result.skippedSiteCount)) {
    throw new Error("Wave 1 coordinator response is invalid");
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.state === "complete") process.exit(0);
  if (result.state === "review-required" || result.state === "stopped") process.exit(2);
  await new Promise((resolve) => setTimeout(resolve, 5_000));
}
throw new Error("Timed out waiting for Wave 1 baseline scans");
