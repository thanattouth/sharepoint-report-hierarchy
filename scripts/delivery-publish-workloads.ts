import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  assertDeliveryAzureAccount,
  azJson,
  deliveryDeploymentOutputs,
  exactEntraApplication,
} from "../src/delivery/azure-cli";
import {
  DELIVERY_DEPLOYMENTS,
  deploymentOutputString,
  scannerFederatedCredential,
} from "../src/delivery/deployment-outputs";
import { KNOWN_ENV_KEYS } from "../src/configuration/env-profiles";
import { loadCustomerDeliveryManifest } from "../src/delivery/manifest";

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`Expected ${name} <value>`);
  return value;
}

function publish(script: string, environment: Record<string, string>): void {
  const childEnvironment = { ...process.env };
  for (const key of KNOWN_ENV_KEYS) delete childEnvironment[key];
  Object.assign(childEnvironment, environment);
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", script],
    { cwd: process.cwd(), env: childEnvironment, stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${script} failed`);
}

const manifest = loadCustomerDeliveryManifest(argument("--manifest"));
const apply = process.argv.includes("--apply");
if (!apply && !process.argv.includes("--plan")) {
  throw new Error("Expected --plan or --apply");
}
if (!manifest.workloads) {
  throw new Error("Delivery manifest does not contain workloads configuration");
}
assertDeliveryAzureAccount(manifest);

const scannerApplication = exactEntraApplication(
  manifest.entra.scannerAppDisplayName,
);
const scannerOutputs = deliveryDeploymentOutputs(
  manifest,
  DELIVERY_DEPLOYMENTS.scanner,
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
  throw new Error(
    "Scanner workload federation is missing or drifted; run the manifest-driven federation apply first",
  );
}

const archives = [
  "outputs/scheduled-scanner.zip",
  "outputs/report-cache-api.zip",
  "outputs/configuration-admin-api.zip",
];
const missingArchives = archives.filter((archive) => !existsSync(archive));
if (missingArchives.length) {
  throw new Error(
    `Missing workload archives: ${missingArchives.join(", ")}; run the workload package command first`,
  );
}
if (!apply) {
  process.stdout.write(`${JSON.stringify({
    event: "customer-delivery-workloads-publish-plan",
    status: "ready",
    archives,
    workloadFederation: "verified",
    manifestDriven: true,
    localEnvFilesUsed: false,
    mutationPerformed: false,
  })}\n`);
  process.exit(0);
}

const common = {
  AZURE_STORAGE_ACCOUNT_NAME: manifest.storageAccountName,
};
publish("scripts/p5-publish-scheduled-scanner.ts", {
  ...common,
  P5_AZURE_SUBSCRIPTION_ID: manifest.subscriptionId,
  P5_AZURE_RESOURCE_GROUP: manifest.resourceGroupName,
});
publish("scripts/p6-publish-report-api.ts", {
  ...common,
  P6_AZURE_SUBSCRIPTION_ID: manifest.subscriptionId,
  P6_AZURE_RESOURCE_GROUP: manifest.resourceGroupName,
});
publish("scripts/p7-publish-configuration-admin-api.ts", {
  ...common,
  P7_AZURE_SUBSCRIPTION_ID: manifest.subscriptionId,
  P7_AZURE_RESOURCE_GROUP: manifest.resourceGroupName,
});

process.stdout.write(`${JSON.stringify({
  event: "customer-delivery-workloads-published",
  deploymentNames: [
    DELIVERY_DEPLOYMENTS.scanner,
    DELIVERY_DEPLOYMENTS.reportApi,
    DELIVERY_DEPLOYMENTS.configurationAdminApi,
  ],
  manifestDriven: true,
  localEnvFilesUsed: false,
  mutationPerformed: true,
})}\n`);
