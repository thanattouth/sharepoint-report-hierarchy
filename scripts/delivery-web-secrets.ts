import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { loadCustomerDeliveryManifest } from "../src/delivery/manifest";
import {
  DELIVERY_DEPLOYMENTS,
  workloadFunctionAppNames,
} from "../src/delivery/deployment-outputs";
import { deliveryDeploymentOutputs } from "../src/delivery/azure-cli";

const SECRET_NAMES = [
  "entra-client-secret",
  "entra-session-secret",
  "report-api-function-key",
  "config-admin-api-function-key",
] as const;

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
  const applications = azJson<Array<{ appId: string; id: string }>>([
    "ad", "app", "list", "--filter", `displayName eq '${escaped}'`, "--query", "[].{appId:appId,id:id}",
  ]);
  if (applications.length !== 1) throw new Error(`Expected exactly one Entra application: ${displayName}`);
  return applications[0];
}

function ensureBridgeFunctionKey(subscriptionId: string, resourceGroup: string, functionAppName: string) {
  const keys = azJson<{ functionKeys?: Record<string, string> }>([
    "functionapp", "keys", "list", "--subscription", subscriptionId,
    "--resource-group", resourceGroup, "--name", functionAppName,
  ]);
  const existing = keys.functionKeys?.["web-bridge"];
  if (existing) return existing;
  const value = randomBytes(32).toString("base64url");
  azVoid([
    "functionapp", "keys", "set", "--subscription", subscriptionId,
    "--resource-group", resourceGroup, "--name", functionAppName,
    "--key-name", "web-bridge", "--key-type", "functionKeys", "--key-value", value,
  ]);
  return value;
}

async function setSecretWithRetry(input: {
  vaultName: string;
  name: string;
  value: string;
  contentType: string;
  temporaryDirectory: string;
}) {
  const file = join(input.temporaryDirectory, input.name);
  writeFileSync(file, input.value, { mode: 0o600 });
  let lastError: unknown;
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    try {
      azVoid([
        "keyvault", "secret", "set", "--vault-name", input.vaultName,
        "--name", input.name, "--file", file, "--encoding", "utf-8",
        "--content-type", input.contentType,
        "--tags", "managedBy=customer-delivery", "rotation=manual",
      ]);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 8) await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  }
  throw lastError;
}

const manifest = loadCustomerDeliveryManifest(argument("--manifest"));
const hosting = manifest.webHosting;
if (!hosting) throw new Error("Delivery manifest does not contain webHosting configuration");
const rotate = process.argv.includes("--rotate");
if (!rotate && !process.argv.includes("--provision")) throw new Error("Expected --provision or --rotate");

const account = azJson<{ tenantId: string; id: string }>(["account", "show", "--query", "{tenantId:tenantId,id:id}"]);
if (account.tenantId.toLowerCase() !== manifest.tenantId.toLowerCase() || account.id.toLowerCase() !== manifest.subscriptionId.toLowerCase()) {
  throw new Error("Azure CLI tenant/subscription does not match the delivery manifest");
}
const webApplication = exactWebApplication(manifest.entra.webAppDisplayName);
const workloadNames = workloadFunctionAppNames({
  reportApi: deliveryDeploymentOutputs(manifest, DELIVERY_DEPLOYMENTS.reportApi),
  configurationAdminApi: deliveryDeploymentOutputs(
    manifest,
    DELIVERY_DEPLOYMENTS.configurationAdminApi,
  ),
});
const existingSecrets = new Set(azJson<Array<{ name: string }>>([
  "keyvault", "secret", "list", "--vault-name", hosting.keyVaultName, "--query", "[].{name:name}",
]).map(({ name }) => name));
const managedSecrets = SECRET_NAMES.filter((name) => existingSecrets.has(name));
if (!rotate && managedSecrets.length === SECRET_NAMES.length) {
  process.stdout.write(`${JSON.stringify({ status: "already-provisioned", keyVaultName: hosting.keyVaultName, secretCount: SECRET_NAMES.length })}\n`);
  process.exit(0);
}
if (!rotate && managedSecrets.length > 0) {
  throw new Error("Key Vault contains a partial web secret set; inspect it and rerun with --rotate");
}

const reportFunctionKey = ensureBridgeFunctionKey(
  manifest.subscriptionId,
  manifest.resourceGroupName,
  workloadNames.reportApi,
);
const configurationFunctionKey = ensureBridgeFunctionKey(
  manifest.subscriptionId,
  manifest.resourceGroupName,
  workloadNames.configurationAdminApi,
);
const sessionSecret = randomBytes(32).toString("base64url");
const credentialDisplayName = `appservice-${hosting.appServiceName}-${new Date().toISOString().slice(0, 10)}`;
const credential = azJson<{ password: string }>([
  "ad", "app", "credential", "reset", "--id", webApplication.appId,
  "--append", "--display-name", credentialDisplayName, "--years", "1",
  "--query", "{password:password}",
]);
if (!credential.password) throw new Error("Entra did not return the new client secret");
const passwordCredentials = azJson<Array<{ keyId: string; displayName: string }>>([
  "ad", "app", "show", "--id", webApplication.appId,
  "--query", `passwordCredentials[?displayName=='${credentialDisplayName}'].{keyId:keyId,displayName:displayName}`,
]);
if (passwordCredentials.length !== 1) throw new Error("Unable to identify the new Entra client credential");

const temporaryDirectory = mkdtempSync(join(tmpdir(), "sp-delivery-web-secrets-"));
try {
  await setSecretWithRetry({
    vaultName: hosting.keyVaultName,
    name: "entra-client-secret",
    value: credential.password,
    contentType: "Entra confidential client credential",
    temporaryDirectory,
  });
  await setSecretWithRetry({
    vaultName: hosting.keyVaultName,
    name: "entra-session-secret",
    value: sessionSecret,
    contentType: "AES-256-GCM application session key",
    temporaryDirectory,
  });
  await setSecretWithRetry({
    vaultName: hosting.keyVaultName,
    name: "report-api-function-key",
    value: reportFunctionKey,
    contentType: "Report API web bridge function key",
    temporaryDirectory,
  });
  await setSecretWithRetry({
    vaultName: hosting.keyVaultName,
    name: "config-admin-api-function-key",
    value: configurationFunctionKey,
    contentType: "Configuration Admin API web bridge function key",
    temporaryDirectory,
  });
} catch (error) {
  try {
    azVoid(["ad", "app", "credential", "delete", "--id", webApplication.appId, "--key-id", passwordCredentials[0].keyId]);
  } catch {
    // Preserve the original failure. The runbook includes an explicit credential audit.
  }
  throw error;
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

azVoid([
  "rest", "--method", "post",
  "--url", `https://management.azure.com/subscriptions/${manifest.subscriptionId}/resourceGroups/${manifest.resourceGroupName}/providers/Microsoft.Web/sites/${hosting.appServiceName}/config/configreferences/appsettings/refresh?api-version=2022-03-01`,
]);
azVoid([
  "webapp", "restart", "--subscription", manifest.subscriptionId,
  "--resource-group", manifest.resourceGroupName, "--name", hosting.appServiceName,
]);
process.stdout.write(`${JSON.stringify({
  status: rotate ? "rotated" : "provisioned",
  keyVaultName: hosting.keyVaultName,
  secretCount: SECRET_NAMES.length,
  clientCredentialDisplayName: credentialDisplayName,
  clientCredentialValueExposed: false,
})}\n`);
