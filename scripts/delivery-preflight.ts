import { spawnSync } from "node:child_process";
import { loadCustomerDeliveryManifest } from "../src/delivery/manifest";

const REQUIRED_PROVIDERS = [
  "Microsoft.Authorization",
  "Microsoft.Insights",
  "Microsoft.ManagedIdentity",
  "Microsoft.OperationalInsights",
  "Microsoft.Storage",
  "Microsoft.Web",
] as const;

function manifestPath(): string {
  const index = process.argv.indexOf("--manifest");
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error("Expected --manifest <path>");
  return value;
}

function azJson<T>(args: string[]): T {
  const result = spawnSync("az", [...args, "--only-show-errors", "-o", "json"], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.trim() || `az ${args[0]} failed`);
  return JSON.parse(result.stdout) as T;
}

const manifest = loadCustomerDeliveryManifest(manifestPath());
const account = azJson<{ id: string; tenantId: string; state: string; user?: { name?: string } }>([
  "account",
  "show",
]);
if (account.tenantId.toLowerCase() !== manifest.tenantId.toLowerCase()) {
  throw new Error("Azure CLI tenant does not match the delivery manifest");
}
if (account.id.toLowerCase() !== manifest.subscriptionId.toLowerCase()) {
  throw new Error("Azure CLI subscription does not match the delivery manifest");
}
if (account.state !== "Enabled") throw new Error("Target Azure subscription is not enabled");

const principal = azJson<{ id: string; userPrincipalName?: string }>(["ad", "signed-in-user", "show"]);
const roleAssignments = azJson<Array<{ roleDefinitionName: string; scope: string }>>([
  "role",
  "assignment",
  "list",
  "--assignee",
  principal.id,
  "--all",
  "--include-inherited",
]);
const providerRows = azJson<Array<{ namespace: string; registrationState: string }>>([
  "provider",
  "list",
  "--query",
  "[].{namespace:namespace,registrationState:registrationState}",
]);
const requiredProviderNames = new Set(REQUIRED_PROVIDERS.map((namespace) => namespace.toLowerCase()));
const providerStates = Object.fromEntries(
  providerRows
    .filter((row) => requiredProviderNames.has(row.namespace.toLowerCase()))
    .map((row) => [row.namespace.toLowerCase(), row.registrationState]),
);
const unregisteredProviders = REQUIRED_PROVIDERS.filter(
  (namespace) => providerStates[namespace.toLowerCase()] !== "Registered",
);
const resourceGroupExists = azJson<boolean>(["group", "exists", "--name", manifest.resourceGroupName]);
const storageAccounts = resourceGroupExists
  ? azJson<Array<{ name: string }>>([
      "storage",
      "account",
      "list",
      "--resource-group",
      manifest.resourceGroupName,
      "--query",
      "[].{name:name}",
    ])
  : [];
const targetStorageExists = storageAccounts.some(
  ({ name }) => name.toLowerCase() === manifest.storageAccountName.toLowerCase(),
);
const storageName = azJson<{ nameAvailable: boolean; reason?: string }>([
  "storage",
  "account",
  "check-name",
  "--name",
  manifest.storageAccountName,
]);
const canWriteRoleAssignments = roleAssignments.some(({ roleDefinitionName }) =>
  ["Owner", "Role Based Access Control Administrator", "User Access Administrator"].includes(roleDefinitionName),
);
const hasContributor = roleAssignments.some(({ roleDefinitionName }) =>
  ["Owner", "Contributor"].includes(roleDefinitionName),
);
const storageNameUsable = storageName.nameAvailable || targetStorageExists;

const result = {
  event: "customer-delivery-preflight",
  deploymentName: manifest.deploymentName,
  account: {
    tenantMatches: true,
    subscriptionMatches: true,
    state: account.state,
    signedInUser: account.user?.name ?? principal.userPrincipalName ?? "unknown",
  },
  access: {
    canCreateResources: hasContributor,
    canWriteRoleAssignments,
    rbacMode: manifest.rbac.mode,
    adminHandoffRequired: !canWriteRoleAssignments,
  },
  providers: {
    ready: unregisteredProviders.length === 0,
    unregistered: unregisteredProviders,
  },
  target: {
    resourceGroupExists,
    targetStorageExists,
    storageNameAvailable: storageName.nameAvailable,
    storageNameUsable,
  },
  gates: {
    foundationReady: hasContributor && unregisteredProviders.length === 0 && storageNameUsable,
    rbacReady: manifest.rbac.mode === "admin-handoff" || canWriteRoleAssignments,
  },
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.gates.foundationReady || !result.gates.rbacReady) process.exitCode = 2;
