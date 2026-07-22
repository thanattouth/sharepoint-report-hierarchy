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
import { loadCustomerDeliveryManifest } from "../src/delivery/manifest";

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`Expected ${name} <value>`);
  return value;
}

const manifest = loadCustomerDeliveryManifest(argument("--manifest"));
const apply = process.argv.includes("--apply");
if (!apply && !process.argv.includes("--plan")) {
  throw new Error("Expected --plan or --apply");
}
assertDeliveryAzureAccount(manifest);

const scannerApplication = exactEntraApplication(
  manifest.entra.scannerAppDisplayName,
);
const scannerOutputs = deliveryDeploymentOutputs(
  manifest,
  DELIVERY_DEPLOYMENTS.scanner,
);
const expected = scannerFederatedCredential({
  tenantId: manifest.tenantId,
  scannerIdentityPrincipalId: deploymentOutputString(
    scannerOutputs,
    "scannerIdentityPrincipalId",
  ),
});
type FederatedCredential = {
  name?: string;
  issuer?: string;
  subject?: string;
  audiences?: string[];
};
const credentials = azJson<FederatedCredential[]>([
  "ad",
  "app",
  "federated-credential",
  "list",
  "--id",
  scannerApplication.id,
]);
const existing = credentials.find(({ name }) => name === expected.name);
if (existing) {
  const exact = existing.issuer === expected.issuer
    && existing.subject === expected.subject
    && existing.audiences?.length === 1
    && existing.audiences[0] === expected.audiences[0];
  if (!exact) {
    throw new Error(
      `Federated credential ${expected.name} exists with a different issuer, subject, or audience`,
    );
  }
  process.stdout.write(`${JSON.stringify({
    event: "customer-delivery-scanner-federation",
    mode: apply ? "apply" : "plan",
    status: "already-configured",
    credentialName: expected.name,
    tenantPinned: true,
  })}\n`);
  process.exit(0);
}

if (apply) {
  azJson([
    "ad",
    "app",
    "federated-credential",
    "create",
    "--id",
    scannerApplication.id,
    "--parameters",
    JSON.stringify(expected),
  ]);
}
process.stdout.write(`${JSON.stringify({
  event: "customer-delivery-scanner-federation",
  mode: apply ? "apply" : "plan",
  status: apply ? "configured" : "create",
  credentialName: expected.name,
  tenantPinned: true,
})}\n`);
