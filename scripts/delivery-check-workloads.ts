import {
  assertDeliveryAzureAccount,
  azJson,
  deliveryDeploymentOutputs,
  exactEntraApplication,
} from "../src/delivery/azure-cli";
import {
  DELIVERY_DEPLOYMENTS,
  deploymentOutputBoolean,
  deploymentOutputString,
  scannerFederatedCredential,
} from "../src/delivery/deployment-outputs";
import { loadCustomerDeliveryManifest } from "../src/delivery/manifest";

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`Expected ${name} <value>`);
  return value;
}

function functionNames(
  manifest: ReturnType<typeof loadCustomerDeliveryManifest>,
  functionAppName: string,
): Set<string> {
  const names = azJson<string[]>([
    "functionapp",
    "function",
    "list",
    "--subscription",
    manifest.subscriptionId,
    "--resource-group",
    manifest.resourceGroupName,
    "--name",
    functionAppName,
    "--query",
    "[].name",
  ]);
  return new Set(names.map((name) => name.split("/").at(-1) ?? name));
}

function requireFunctions(
  actual: Set<string>,
  expected: readonly string[],
  boundary: string,
): void {
  const missing = expected.filter((name) => !actual.has(name));
  if (missing.length) {
    throw new Error(`${boundary} is missing functions: ${missing.join(", ")}`);
  }
}

const manifest = loadCustomerDeliveryManifest(argument("--manifest"));
if (!manifest.workloads) {
  throw new Error("Delivery manifest does not contain workloads configuration");
}
assertDeliveryAzureAccount(manifest);

const scannerOutputs = deliveryDeploymentOutputs(
  manifest,
  DELIVERY_DEPLOYMENTS.scanner,
);
const reportOutputs = deliveryDeploymentOutputs(
  manifest,
  DELIVERY_DEPLOYMENTS.reportApi,
);
const configurationOutputs = deliveryDeploymentOutputs(
  manifest,
  DELIVERY_DEPLOYMENTS.configurationAdminApi,
);
if (!deploymentOutputBoolean(scannerOutputs, "managedIdentityRolesCreated")
  || !deploymentOutputBoolean(reportOutputs, "managedIdentityRolesCreated")
  || !deploymentOutputBoolean(
    configurationOutputs,
    "roleAssignmentsManagedByDeployment",
  )) {
  throw new Error("One or more workload RBAC boundaries were not deployed");
}

const scannerFunctionApp = deploymentOutputString(
  scannerOutputs,
  "functionAppName",
);
const reportFunctionApp = deploymentOutputString(
  reportOutputs,
  "functionAppName",
);
const configurationFunctionApp = deploymentOutputString(
  configurationOutputs,
  "functionAppName",
);
for (const name of [
  scannerFunctionApp,
  reportFunctionApp,
  configurationFunctionApp,
]) {
  const app = azJson<{ state: string; httpsOnly: boolean }>([
    "resource",
    "show",
    "--subscription",
    manifest.subscriptionId,
    "--resource-group",
    manifest.resourceGroupName,
    "--resource-type",
    "Microsoft.Web/sites",
    "--name",
    name,
    "--api-version",
    "2024-04-01",
    "--query",
    "{state:properties.state,httpsOnly:properties.httpsOnly}",
  ]);
  if (app.state !== "Running" || !app.httpsOnly) {
    throw new Error(`${name} is not running with HTTPS-only enforcement`);
  }
}

requireFunctions(functionNames(manifest, scannerFunctionApp), [
  "nightlySchedule",
  "weeklyReconciliation",
  "processSiteScan",
  "runNow",
], "Scheduled Scanner");
requireFunctions(functionNames(manifest, reportFunctionApp), [
  "report",
  "health",
], "Report Cache API");
requireFunctions(functionNames(manifest, configurationFunctionApp), [
  "configuration-inbox",
  "configuration-preview",
  "configuration-apply",
  "configuration-business-scope",
  "configuration-business-node-preview",
  "configuration-business-node-apply",
  "configuration-scope-assignment-preview",
  "configuration-scope-assignment-apply",
], "Configuration Admin API");

const scannerSettings = new Map(azJson<Array<{ name: string; value?: string }>>([
  "functionapp",
  "config",
  "appsettings",
  "list",
  "--subscription",
  manifest.subscriptionId,
  "--resource-group",
  manifest.resourceGroupName,
  "--name",
  scannerFunctionApp,
  "--query",
  "[].{name:name,value:value}",
]).map(({ name, value }) => [name, value]));
if (scannerSettings.get("AzureWebJobs.nightlySchedule.Disabled")?.toLowerCase() !== "true"
  || scannerSettings.get("AzureWebJobs.weeklyReconciliation.Disabled")?.toLowerCase() !== "true") {
  throw new Error("Initial customer delivery must keep both scanner schedules disabled");
}
if (scannerSettings.get("SCANNER_SCOPE_MODE") !== manifest.workloads.scanner.scopeMode
  || scannerSettings.get("AZURE_STORAGE_ACCOUNT_NAME") !== manifest.storageAccountName) {
  throw new Error("Scheduled Scanner runtime settings drifted from the delivery manifest");
}

const scannerApplication = exactEntraApplication(
  manifest.entra.scannerAppDisplayName,
);
const expectedFederation = scannerFederatedCredential({
  tenantId: manifest.tenantId,
  scannerIdentityPrincipalId: deploymentOutputString(
    scannerOutputs,
    "scannerIdentityPrincipalId",
  ),
});
const credentials = azJson<Array<{
  name?: string;
  issuer?: string;
  subject?: string;
  audiences?: string[];
}>>([
  "ad",
  "app",
  "federated-credential",
  "list",
  "--id",
  scannerApplication.id,
]);
if (!credentials.some((credential) =>
  credential.name === expectedFederation.name
  && credential.issuer === expectedFederation.issuer
  && credential.subject === expectedFederation.subject
  && credential.audiences?.length === 1
  && credential.audiences[0] === expectedFederation.audiences[0]
)) {
  throw new Error("Scanner workload federation is missing or drifted");
}

process.stdout.write(`${JSON.stringify({
  event: "customer-delivery-workloads-verified",
  functionApps: 3,
  requiredFunctionsIndexed: 14,
  httpsOnly: true,
  workloadRbac: "verified",
  scannerFederation: "verified",
  schedulesDisabled: true,
  manifestDriven: true,
})}\n`);
