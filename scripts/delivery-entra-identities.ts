import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { loadCustomerDeliveryManifest } from "../src/delivery/manifest";
import {
  MICROSOFT_GRAPH_APP_ID,
  resolveGraphResourceAccess,
  SCANNER_APPLICATION_GRAPH_PERMISSIONS,
  WEB_APP_ROLES,
  WEB_DELEGATED_GRAPH_PERMISSIONS,
} from "../src/delivery/entra-applications";

type EntraApplication = {
  appId: string;
  id: string;
  displayName: string;
  signInAudience?: string;
};

type EntraApplicationConfiguration = EntraApplication & {
  appRoles: Array<{ value?: string | null }>;
  groupMembershipClaims?: string | null;
  passwordCredentials: unknown[];
  requiredResourceAccess: Array<{
    resourceAppId: string;
    resourceAccess: Array<{ id: string; type: "Role" | "Scope" }>;
  }>;
  web?: {
    redirectUris?: string[];
    implicitGrantSettings?: { enableIdTokenIssuance?: boolean; enableAccessTokenIssuance?: boolean };
  };
};

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`Expected ${name} <value>`);
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

function azVoid(args: string[]): void {
  const result = spawnSync("az", [...args, "--only-show-errors", "-o", "none"], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.trim() || `az ${args[0]} failed`);
}

function exactApplication(displayName: string): EntraApplication | undefined {
  const escaped = displayName.replaceAll("'", "''");
  const applications = azJson<EntraApplication[]>([
    "ad", "app", "list",
    "--filter", `displayName eq '${escaped}'`,
    "--query", "[].{appId:appId,id:id,displayName:displayName,signInAudience:signInAudience}",
  ]);
  if (applications.length > 1) throw new Error(`Multiple Entra applications use display name: ${displayName}`);
  return applications[0];
}

function applicationConfiguration(appId: string): EntraApplicationConfiguration {
  return azJson<EntraApplicationConfiguration>(["ad", "app", "show", "--id", appId]);
}

function sameStrings(actual: string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && [...actual].sort().every((value, index) => value === [...expected].sort()[index]);
}

function sameResourceAccess(
  actual: EntraApplicationConfiguration["requiredResourceAccess"],
  expected: Array<{ id: string; type: "Role" | "Scope" }>,
): boolean {
  if (actual.length !== 1 || actual[0].resourceAppId !== MICROSOFT_GRAPH_APP_ID) return false;
  const values = actual[0].resourceAccess.map(({ id, type }) => `${type}:${id}`);
  return sameStrings(values, expected.map(({ id, type }) => `${type}:${id}`));
}

function verifyWebApplication(
  application: EntraApplicationConfiguration,
  redirectUris: string[],
  graphAccess: Array<{ id: string; type: "Role" | "Scope" }>,
): void {
  if (application.signInAudience !== "AzureADMyOrg") throw new Error("Web application is not single-tenant");
  if (application.groupMembershipClaims !== "ApplicationGroup") throw new Error("Web application group claims are not fail-closed");
  if (!sameStrings(application.appRoles.flatMap(({ value }) => value ? [value] : []), WEB_APP_ROLES.map(({ value }) => value))) {
    throw new Error("Web application roles drifted from the delivery contract");
  }
  if (!sameStrings(application.web?.redirectUris ?? [], redirectUris)) throw new Error("Web application redirect URIs drifted from the delivery manifest");
  if (application.web?.implicitGrantSettings?.enableIdTokenIssuance || application.web?.implicitGrantSettings?.enableAccessTokenIssuance) {
    throw new Error("Web application must not enable implicit token issuance");
  }
  if (!sameResourceAccess(application.requiredResourceAccess, graphAccess)) throw new Error("Web application Graph permissions drifted from the delivery contract");
}

function verifyScannerApplication(
  application: EntraApplicationConfiguration,
  graphAccess: Array<{ id: string; type: "Role" | "Scope" }>,
): void {
  if (application.signInAudience !== "AzureADMyOrg") throw new Error("Scanner application is not single-tenant");
  if (application.passwordCredentials.length) throw new Error("Scanner application must not contain client secrets");
  if (!sameResourceAccess(application.requiredResourceAccess, graphAccess)) throw new Error("Scanner application Graph permissions drifted from the delivery contract");
}

function ensureServicePrincipal(appId: string): { id: string; appId: string } {
  const existing = azJson<Array<{ id: string; appId: string }>>([
    "ad", "sp", "list",
    "--filter", `appId eq '${appId}'`,
    "--query", "[].{id:id,appId:appId}",
  ]);
  if (existing.length > 1) throw new Error(`Multiple service principals use application ID: ${appId}`);
  return existing[0] ?? azJson<{ id: string; appId: string }>([
    "ad", "sp", "create", "--id", appId,
    "--query", "{id:id,appId:appId}",
  ]);
}

const manifest = loadCustomerDeliveryManifest(argument("--manifest"));
const apply = process.argv.includes("--apply");
if (!apply && !process.argv.includes("--plan")) throw new Error("Expected --plan or --apply");

const account = azJson<{ tenantId: string; id: string }>([
  "account", "show", "--query", "{tenantId:tenantId,id:id}",
]);
if (account.tenantId.toLowerCase() !== manifest.tenantId.toLowerCase() || account.id.toLowerCase() !== manifest.subscriptionId.toLowerCase()) {
  throw new Error("Azure CLI tenant/subscription does not match the delivery manifest");
}

const graph = azJson<{
  appRoles: Array<{ id: string; value?: string; allowedMemberTypes?: string[] }>;
  oauth2PermissionScopes: Array<{ id: string; value?: string }>;
}>([
  "ad", "sp", "show", "--id", MICROSOFT_GRAPH_APP_ID,
  "--query", "{appRoles:appRoles,oauth2PermissionScopes:oauth2PermissionScopes}",
]);
const webGraphAccess = resolveGraphResourceAccess(graph, WEB_DELEGATED_GRAPH_PERMISSIONS, "Scope");
const scannerGraphAccess = resolveGraphResourceAccess(graph, SCANNER_APPLICATION_GRAPH_PERMISSIONS, "Role");
const existingWeb = exactApplication(manifest.entra.webAppDisplayName);
const existingScanner = exactApplication(manifest.entra.scannerAppDisplayName);

if (!apply) {
  if (existingWeb) verifyWebApplication(applicationConfiguration(existingWeb.appId), manifest.entra.webRedirectUris, webGraphAccess);
  if (existingScanner) verifyScannerApplication(applicationConfiguration(existingScanner.appId), scannerGraphAccess);
  process.stdout.write(`${JSON.stringify({
    event: "customer-delivery-entra-plan",
    tenantId: manifest.tenantId,
    applications: {
      web: { displayName: manifest.entra.webAppDisplayName, action: existingWeb ? "reuse" : "create" },
      scanner: { displayName: manifest.entra.scannerAppDisplayName, action: existingScanner ? "reuse" : "create" },
    },
    requestedButNotConsented: {
      webDelegated: WEB_DELEGATED_GRAPH_PERMISSIONS,
      scannerApplication: SCANNER_APPLICATION_GRAPH_PERMISSIONS,
    },
    createsClientSecret: false,
    grantsAdminConsent: false,
  }, null, 2)}\n`);
  process.exit(0);
}

const temporaryDirectory = mkdtempSync(join(tmpdir(), "sp-delivery-entra-"));
try {
  const webRolesFile = join(temporaryDirectory, "web-app-roles.json");
  const webAccessFile = join(temporaryDirectory, "web-resource-access.json");
  const scannerAccessFile = join(temporaryDirectory, "scanner-resource-access.json");
  writeFileSync(webRolesFile, JSON.stringify(WEB_APP_ROLES), { mode: 0o600 });
  writeFileSync(webAccessFile, JSON.stringify([{ resourceAppId: MICROSOFT_GRAPH_APP_ID, resourceAccess: webGraphAccess }]), { mode: 0o600 });
  writeFileSync(scannerAccessFile, JSON.stringify([{ resourceAppId: MICROSOFT_GRAPH_APP_ID, resourceAccess: scannerGraphAccess }]), { mode: 0o600 });

  const web = existingWeb ?? azJson<EntraApplication>([
    "ad", "app", "create",
    "--display-name", manifest.entra.webAppDisplayName,
    "--sign-in-audience", "AzureADMyOrg",
    "--web-redirect-uris", ...manifest.entra.webRedirectUris,
    "--enable-id-token-issuance", "false",
    "--app-roles", `@${webRolesFile}`,
    "--required-resource-accesses", `@${webAccessFile}`,
    "--query", "{appId:appId,id:id,displayName:displayName,signInAudience:signInAudience}",
  ]);
  if (web.signInAudience !== "AzureADMyOrg") throw new Error("Existing web application is not single-tenant");
  azVoid([
    "ad", "app", "update", "--id", web.appId,
    "--set", "groupMembershipClaims=ApplicationGroup",
    "--enable-id-token-issuance", "false",
    "--enable-access-token-issuance", "false",
    "--web-redirect-uris", ...manifest.entra.webRedirectUris,
  ]);
  verifyWebApplication(applicationConfiguration(web.appId), manifest.entra.webRedirectUris, webGraphAccess);
  const webSp = ensureServicePrincipal(web.appId);
  azVoid(["ad", "sp", "update", "--id", webSp.id, "--set", "appRoleAssignmentRequired=true"]);

  const scanner = existingScanner ?? azJson<EntraApplication>([
    "ad", "app", "create",
    "--display-name", manifest.entra.scannerAppDisplayName,
    "--sign-in-audience", "AzureADMyOrg",
    "--required-resource-accesses", `@${scannerAccessFile}`,
    "--query", "{appId:appId,id:id,displayName:displayName,signInAudience:signInAudience}",
  ]);
  if (scanner.signInAudience !== "AzureADMyOrg") throw new Error("Existing scanner application is not single-tenant");
  verifyScannerApplication(applicationConfiguration(scanner.appId), scannerGraphAccess);
  const scannerSp = ensureServicePrincipal(scanner.appId);

  process.stdout.write(`${JSON.stringify({
    event: "customer-delivery-entra-created",
    tenantId: manifest.tenantId,
    web: { applicationId: web.appId, servicePrincipalObjectId: webSp.id },
    scanner: { applicationId: scanner.appId, servicePrincipalObjectId: scannerSp.id },
    clientSecretCreated: false,
    adminConsentGranted: false,
    nextGate: "review and explicitly approve Microsoft Graph admin consent",
  }, null, 2)}\n`);
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
