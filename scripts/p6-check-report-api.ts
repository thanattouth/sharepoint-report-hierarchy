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

const subscriptionId = required("P6_AZURE_SUBSCRIPTION_ID");
const resourceGroup = required("P6_AZURE_RESOURCE_GROUP");
const expectedSiteCount = Number(required("P6_EXPECTED_REPORT_SITE_COUNT"));
if (!Number.isInteger(expectedSiteCount) || expectedSiteCount < 1 || expectedSiteCount > 100) {
  throw new Error("P6_EXPECTED_REPORT_SITE_COUNT is invalid");
}
const userUpn = required("REPORT_PILOT_ALLOWED_UPNS").split(",")[0]?.trim();
if (!userUpn) throw new Error("REPORT_PILOT_ALLOWED_UPNS has no pilot UPN");
const outputs = azJson([
  "deployment", "group", "show",
  "--subscription", subscriptionId,
  "--resource-group", resourceGroup,
  "--name", "p6-report-cache-api-v1",
  "--query", "properties.outputs",
]);
const functionAppName = outputValue(outputs, "functionAppName");
const hostname = outputValue(outputs, "functionAppHostname");
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

const response = await fetch(
  `https://${hostname}/api/report?user=${encodeURIComponent(userUpn)}&page=1&pageSize=6`,
  { headers: { "x-functions-key": functionKey }, redirect: "manual" },
);
if (response.status !== 200) throw new Error(`Report API returned HTTP ${response.status}`);
const result = await response.json() as Record<string, unknown>;
if (result.siteCount !== expectedSiteCount
  || !Array.isArray(result.allowedSiteIds)
  || result.allowedSiteIds.length !== expectedSiteCount
  || !Array.isArray(result.siteRollups)
  || result.siteRollups.length !== expectedSiteCount
  || !["ready", "zero-sensitive"].includes(String(result.state))) {
  throw new Error("Report API multi-Site response is invalid");
}
process.stdout.write(`${JSON.stringify({
  status: "verified",
  siteCount: result.siteCount,
  siteRollupCount: result.siteRollups.length,
  reportState: result.state,
  sensitiveCount: result.scopeSensitiveCount,
  libraryCount: result.libraryCount,
})}\n`);
