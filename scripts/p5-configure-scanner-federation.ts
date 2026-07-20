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
const scannerClientId = required("P5_HOSTED_SCANNER_CLIENT_ID");
const outputs = azJson([
  "deployment", "group", "show",
  "--subscription", subscriptionId,
  "--resource-group", resourceGroup,
  "--name", "p5-scheduled-scanner-v1",
  "--query", "properties.outputs",
]);
const scannerPrincipalId = outputValue(outputs, "scannerIdentityPrincipalId");
const app = azJson(["ad", "app", "show", "--id", scannerClientId, "--query", "{id:id,appId:appId}"]);
if (!app || typeof app !== "object" || typeof (app as { id?: unknown }).id !== "string") {
  throw new Error("Hosted scanner app registration is unavailable");
}
const appObjectId = (app as { id: string }).id;
const name = "scanner-workload-managed-identity";
const credentials = azJson(["ad", "app", "federated-credential", "list", "--id", appObjectId]);
if (Array.isArray(credentials) && credentials.some((credential) =>
  credential && typeof credential === "object" && (credential as { name?: unknown }).name === name
)) {
  process.stdout.write(`${JSON.stringify({ status: "already-configured", name })}\n`);
  process.exit(0);
}
azJson([
  "ad", "app", "federated-credential", "create",
  "--id", appObjectId,
  "--parameters", JSON.stringify({
    name,
    description: "Azure Function scheduled scanner workload managed identity",
    issuer: `https://login.microsoftonline.com/${required("AZURE_STORAGE_TENANT_ID")}/v2.0`,
    subject: scannerPrincipalId,
    audiences: ["api://AzureADTokenExchange"],
  }),
]);
process.stdout.write(`${JSON.stringify({ status: "configured", name })}\n`);

