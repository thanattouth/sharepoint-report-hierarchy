import { spawnSync } from "node:child_process";
import { loadCustomerDeliveryManifest } from "../src/delivery/manifest";

const REQUIRED_SECRET_SETTINGS = [
  "ENTRA_AUTH_CLIENT_SECRET",
  "ENTRA_AUTH_SESSION_SECRET",
  "REPORT_API_FUNCTION_KEY",
  "CONFIG_ADMIN_API_FUNCTION_KEY",
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

async function fetchWithRetry(url: string, init?: RequestInit) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      const response = await fetch(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(10_000) });
      if (response.status < 500) return response;
      lastError = new Error(`${url} returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < 30) await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  throw lastError;
}

const manifest = loadCustomerDeliveryManifest(argument("--manifest"));
const hosting = manifest.webHosting;
if (!hosting) throw new Error("Delivery manifest does not contain webHosting configuration");
const account = azJson<{ tenantId: string; id: string }>(["account", "show", "--query", "{tenantId:tenantId,id:id}"]);
if (account.tenantId.toLowerCase() !== manifest.tenantId.toLowerCase() || account.id.toLowerCase() !== manifest.subscriptionId.toLowerCase()) {
  throw new Error("Azure CLI tenant/subscription does not match the delivery manifest");
}

const escaped = manifest.entra.webAppDisplayName.replaceAll("'", "''");
const applications = azJson<Array<{ appId: string; passwordCredentials: Array<{ endDateTime: string }> }>>([
  "ad", "app", "list", "--filter", `displayName eq '${escaped}'`,
  "--query", "[].{appId:appId,passwordCredentials:passwordCredentials[].{endDateTime:endDateTime}}",
]);
if (applications.length !== 1) throw new Error("Expected exactly one Report Web application");
if (!applications[0].passwordCredentials.some(({ endDateTime }) => Date.parse(endDateTime) > Date.now())) {
  throw new Error("Report Web application has no active client credential");
}
const servicePrincipals = azJson<Array<{ id: string; appRoleAssignmentRequired: boolean; loginUrl?: string | null }>>([
  "ad", "sp", "list", "--filter", `appId eq '${applications[0].appId}'`,
  "--query", "[].{id:id,appRoleAssignmentRequired:appRoleAssignmentRequired,loginUrl:loginUrl}",
]);
if (servicePrincipals.length !== 1 || !servicePrincipals[0].appRoleAssignmentRequired) {
  throw new Error("Report Web enterprise application must require explicit user/group assignment");
}
const application = azJson<{ web?: { homePageUrl?: string | null; redirectUris?: string[] } }>([
  "ad", "app", "show", "--id", applications[0].appId,
]);
const actualRedirects = [...(application.web?.redirectUris ?? [])].sort();
const expectedRedirects = [...manifest.entra.webRedirectUris].sort();
if (actualRedirects.length !== expectedRedirects.length || !actualRedirects.every((value, index) => value === expectedRedirects[index])) {
  throw new Error("Report Web redirect URIs drifted from the delivery manifest");
}

const webApp = azJson<{ id: string; state: string; defaultHostName: string; httpsOnly: boolean }>([
  "webapp", "show", "--subscription", manifest.subscriptionId,
  "--resource-group", manifest.resourceGroupName, "--name", hosting.appServiceName,
  "--query", "{id:id,state:state,defaultHostName:defaultHostName,httpsOnly:httpsOnly}",
]);
if (webApp.state !== "Running" || !webApp.httpsOnly) throw new Error("Report Web App is not running with HTTPS-only enforcement");
const references = azJson<{ value?: Array<{ name?: string; properties?: { status?: string } }> }>([
  "rest", "--method", "get",
  "--url", `https://management.azure.com${webApp.id}/config/configreferences/appsettings?api-version=2024-11-01`,
]);
const referenceStatus = new Map((references.value ?? []).map((reference) => [reference.name?.split("/").at(-1), reference.properties?.status]));
for (const name of REQUIRED_SECRET_SETTINGS) {
  if (referenceStatus.get(name) !== "Resolved") {
    throw new Error(`Key Vault reference ${name} is not resolved`);
  }
}

const origin = `https://${webApp.defaultHostName}`;
const expectedEnterpriseApplicationLaunchUrl = `${origin}/`;
if (application.web?.homePageUrl !== expectedEnterpriseApplicationLaunchUrl) {
  throw new Error("Report Web App Registration homepage URL is missing or incorrect");
}
if (servicePrincipals[0].loginUrl !== expectedEnterpriseApplicationLaunchUrl) {
  throw new Error("Report Web enterprise application launch URL is missing or incorrect");
}
const signedOut = await fetchWithRetry(`${origin}/auth/signed-out`);
if (signedOut.status !== 200 || !(await signedOut.text()).includes("SESSION CLEARED")) {
  throw new Error("Public signed-out health surface is unavailable");
}
const root = await fetchWithRetry(`${origin}/`);
const rootLocation = root.headers.get("location") ?? "";
if (![302, 303, 307, 308].includes(root.status) || !rootLocation.includes("/api/auth/entra/login")) {
  throw new Error("Anonymous report root does not redirect to Entra login");
}
const login = await fetchWithRetry(new URL(rootLocation, origin).toString());
const loginLocation = login.headers.get("location") ?? "";
const loginUrl = new URL(loginLocation);
if (login.status !== 302 || loginUrl.hostname !== "login.microsoftonline.com" || !loginUrl.pathname.toLowerCase().includes(manifest.tenantId.toLowerCase())) {
  throw new Error("Entra login route does not use the customer tenant");
}
if (loginUrl.searchParams.get("client_id") !== applications[0].appId) throw new Error("Entra login route uses the wrong client ID");
if (loginUrl.searchParams.get("redirect_uri") !== `${origin}/api/auth/entra/callback`) {
  throw new Error("Entra login route uses the wrong callback URI");
}
const flowCookie = login.headers.get("set-cookie") ?? "";
if (!flowCookie.includes("HttpOnly") || !flowCookie.includes("Secure") || !flowCookie.includes("SameSite=Lax")) {
  throw new Error("Entra authorization-flow cookie is not hardened");
}

process.stdout.write(`${JSON.stringify({
  status: "verified",
  origin,
  appServiceState: webApp.state,
  keyVaultReferencesResolved: REQUIRED_SECRET_SETTINGS.length,
  enterpriseApplicationAssignmentRequired: true,
  enterpriseApplicationLaunchUrl: expectedEnterpriseApplicationLaunchUrl,
  anonymousBoundary: "entra-redirect",
  tenantSpecificOidc: true,
})}\n`);
