import { spawnSync } from "node:child_process";
import type { CustomerDeliveryManifest } from "./manifest";
import type { AzureDeploymentOutputs } from "./deployment-outputs";

export function azJson<T>(args: string[]): T {
  const result = spawnSync("az", [...args, "--only-show-errors", "--output", "json"], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `az ${args[0]} failed`);
  }
  return JSON.parse(result.stdout || "null") as T;
}

export function assertDeliveryAzureAccount(
  manifest: CustomerDeliveryManifest,
): void {
  const account = azJson<{ tenantId: string; id: string }>([
    "account",
    "show",
    "--query",
    "{tenantId:tenantId,id:id}",
  ]);
  if (
    account.tenantId.toLowerCase() !== manifest.tenantId.toLowerCase()
    || account.id.toLowerCase() !== manifest.subscriptionId.toLowerCase()
  ) {
    throw new Error(
      "Azure CLI tenant/subscription does not match the delivery manifest",
    );
  }
}

export function deliveryDeploymentOutputs(
  manifest: CustomerDeliveryManifest,
  deploymentName: string,
): AzureDeploymentOutputs {
  return azJson<AzureDeploymentOutputs>([
    "deployment",
    "group",
    "show",
    "--subscription",
    manifest.subscriptionId,
    "--resource-group",
    manifest.resourceGroupName,
    "--name",
    deploymentName,
    "--query",
    "properties.outputs",
  ]);
}

export function exactEntraApplication(displayName: string): {
  id: string;
  appId: string;
} {
  const escaped = displayName.replaceAll("'", "''");
  const applications = azJson<Array<{ id: string; appId: string }>>([
    "ad",
    "app",
    "list",
    "--filter",
    `displayName eq '${escaped}'`,
    "--query",
    "[].{id:id,appId:appId}",
  ]);
  if (applications.length !== 1) {
    throw new Error(`Expected exactly one Entra application: ${displayName}`);
  }
  return applications[0];
}
