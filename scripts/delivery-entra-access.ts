import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { loadCustomerDeliveryManifest } from "../src/delivery/manifest";

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`Expected ${name} <value>`);
  return value;
}

function azJson<T>(args: string[]): T {
  const result = spawnSync("az", [...args, "--only-show-errors", "--output", "json"], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.trim() || `az ${args[0]} failed`);
  return JSON.parse(result.stdout || "null") as T;
}

function az(args: string[]): void {
  const result = spawnSync("az", [...args, "--only-show-errors", "--output", "none"], { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.trim() || `az ${args[0]} failed`);
}

function escapedOData(value: string): string {
  return value.replaceAll("'", "''");
}

function nickname(deploymentName: string, index: number, displayName: string): string {
  const base = deploymentName.toLowerCase().replaceAll(/[^a-z0-9]/g, "").slice(0, 30) || "delivery";
  const digest = createHash("sha256").update(displayName).digest("hex").slice(0, 8);
  return `spsens-${base}-${index}-${digest}`.slice(0, 64);
}

type Group = { id: string; displayName: string; securityEnabled?: boolean };
type AppRole = { id: string; value: string; isEnabled?: boolean };

const manifest = loadCustomerDeliveryManifest(argument("--manifest"));
const scope = manifest.workloads?.businessScope;
if (!scope) throw new Error("Delivery manifest does not contain businessScope configuration");
const apply = process.argv.includes("--apply");
if (!apply && !process.argv.includes("--plan")) throw new Error("Expected --plan or --apply");

const account = azJson<{ tenantId: string; id: string }>(["account", "show", "--query", "{tenantId:tenantId,id:id}"]);
if (account.tenantId.toLowerCase() !== manifest.tenantId.toLowerCase()
  || account.id.toLowerCase() !== manifest.subscriptionId.toLowerCase()) {
  throw new Error("Azure CLI tenant/subscription does not match the delivery manifest");
}
const applications = azJson<Array<{ appId: string }>>([
  "ad", "app", "list",
  "--filter", `displayName eq '${escapedOData(manifest.entra.webAppDisplayName)}'`,
  "--query", "[].{appId:appId}",
]);
if (applications.length !== 1) throw new Error(`Expected exactly one web application: ${manifest.entra.webAppDisplayName}`);
const webServicePrincipal = azJson<{ id: string; appRoles: AppRole[] }>([
  "ad", "sp", "show", "--id", applications[0].appId,
  "--query", "{id:id,appRoles:appRoles}",
]);
const roles = new Map(webServicePrincipal.appRoles.filter(({ isEnabled }) => isEnabled !== false).map((role) => [role.value, role.id]));
if (!roles.has("ReportAdmin") || !roles.has("ReportViewer")) throw new Error("Web enterprise application roles are incomplete");

const desiredGroups = [
  { displayName: scope.reportAdminGroupDisplayName, appRole: "ReportAdmin" },
  ...scope.scopeGroups.map(({ displayName }) => ({ displayName, appRole: "ReportViewer" })),
];
const members = scope.memberUpns.map((upn) => azJson<{ id: string; userPrincipalName: string }>([
  "ad", "user", "show", "--id", upn,
  "--query", "{id:id,userPrincipalName:userPrincipalName}",
]));
const changes: string[] = [];
const verifiedGroups: Group[] = [];

for (const [index, desired] of desiredGroups.entries()) {
  let groups = azJson<Group[]>([
    "ad", "group", "list",
    "--filter", `displayName eq '${escapedOData(desired.displayName)}'`,
    "--query", "[].{id:id,displayName:displayName,securityEnabled:securityEnabled}",
  ]);
  if (groups.length > 1) throw new Error(`Multiple Entra groups have display name: ${desired.displayName}`);
  if (!groups.length) {
    changes.push(`create-group:${desired.displayName}`);
    if (apply) {
      const created = azJson<Group>([
        "ad", "group", "create",
        "--display-name", desired.displayName,
        "--mail-nickname", nickname(manifest.deploymentName, index, desired.displayName),
        "--query", "{id:id,displayName:displayName,securityEnabled:securityEnabled}",
      ]);
      groups = [created];
    }
  }
  if (!groups.length) {
    for (const member of members) changes.push(`add-member:${member.userPrincipalName}:${desired.displayName}`);
    changes.push(`assign-app-role:${desired.appRole}:${desired.displayName}`);
    continue;
  }
  const group = groups[0];
  if (group.securityEnabled === false) throw new Error(`${desired.displayName} is not a security group`);

  for (const member of members) {
    const membership = azJson<{ value: boolean }>([
      "ad", "group", "member", "check",
      "--group", group.id,
      "--member-id", member.id,
    ]);
    if (!membership.value) {
      changes.push(`add-member:${member.userPrincipalName}:${desired.displayName}`);
      if (apply) az(["ad", "group", "member", "add", "--group", group.id, "--member-id", member.id]);
    }
  }

  const assignments = azJson<{ value: Array<{ appRoleId: string; resourceId: string }> }>([
    "rest", "--method", "GET",
    "--url", `https://graph.microsoft.com/v1.0/groups/${group.id}/appRoleAssignments?$select=appRoleId,resourceId`,
  ]).value;
  const appRoleId = roles.get(desired.appRole)!;
  if (!assignments.some((assignment) => assignment.resourceId.toLowerCase() === webServicePrincipal.id.toLowerCase()
    && assignment.appRoleId.toLowerCase() === appRoleId.toLowerCase())) {
    changes.push(`assign-app-role:${desired.appRole}:${desired.displayName}`);
    if (apply) {
      azJson([
        "rest", "--method", "POST",
        "--url", `https://graph.microsoft.com/v1.0/groups/${group.id}/appRoleAssignments`,
        "--headers", "content-type=application/json",
        "--body", JSON.stringify({ principalId: group.id, resourceId: webServicePrincipal.id, appRoleId }),
      ]);
    }
  }
  verifiedGroups.push(group);
}

process.stdout.write(`${JSON.stringify({
  event: "customer-delivery-entra-access",
  mode: apply ? "apply" : "plan",
  changes,
  groups: verifiedGroups.map(({ id, displayName }) => ({ id, displayName })),
  memberUpns: members.map(({ userPrincipalName }) => userPrincipalName),
})}\n`);
