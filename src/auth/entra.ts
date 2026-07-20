import * as oidc from "openid-client";
import { loadEntraAuthConfig, resolveAllowedRequestOrigin, type EntraAuthConfig } from "./entra-config";
import {
  ENTRA_FLOW_COOKIE,
  ENTRA_SESSION_COOKIE,
  openProtectedCookie,
  readCookie,
  sealProtectedCookie,
  serializeCookie,
} from "./session";

export const REPORT_ADMIN_ROLE = "ReportAdmin";
export const REPORT_VIEWER_ROLE = "ReportViewer";

export type EntraSession = {
  expiresAt: number;
  tenantId: string;
  principalObjectId: string;
  userPrincipalName: string;
  displayName: string;
  roles: string[];
  groupObjectIds: string[];
};

export type EntraAuthorizationFlow = {
  expiresAt: number;
  verifier: string;
  state: string;
  nonce: string;
  returnTo: string;
};

export class EntraAuthorizationError extends Error {
  constructor(public readonly status: 401 | 403, public readonly code: string) {
    super(code);
    this.name = "EntraAuthorizationError";
  }
}

let cachedConfiguration: { key: string; value: Promise<oidc.Configuration> } | undefined;

function getOidcConfiguration(config: EntraAuthConfig) {
  const key = `${config.tenantId}:${config.clientId}`;
  if (!cachedConfiguration || cachedConfiguration.key !== key) {
    cachedConfiguration = {
      key,
      value: oidc.discovery(
        new URL(`https://login.microsoftonline.com/${config.tenantId}/v2.0`),
        config.clientId,
        undefined,
        oidc.ClientSecretPost(config.clientSecret),
      ),
    };
  }
  return cachedConfiguration.value;
}

function strings(value: unknown) {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? [...new Set(value)]
    : [];
}

function singleString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function sessionFromVerifiedClaims(
  claims: Record<string, unknown>,
  config: EntraAuthConfig,
  now = Date.now(),
): EntraSession {
  const tenantId = singleString(claims.tid).toLocaleLowerCase();
  const principalObjectId = singleString(claims.oid).toLocaleLowerCase();
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  const userPrincipalName = singleString(
    claims.preferred_username ?? claims.upn ?? claims.email,
  ).toLocaleLowerCase();
  if (tenantId !== config.tenantId) throw new EntraAuthorizationError(403, "wrong-tenant");
  if (!audience.includes(config.clientId)) throw new EntraAuthorizationError(403, "wrong-audience");
  if (!principalObjectId) throw new EntraAuthorizationError(403, "missing-object-id");
  if (!userPrincipalName || !userPrincipalName.includes("@")) {
    throw new EntraAuthorizationError(403, "missing-user-principal-name");
  }
  return {
    expiresAt: now + config.sessionSeconds * 1000,
    tenantId,
    principalObjectId,
    userPrincipalName,
    displayName: singleString(claims.name) || userPrincipalName,
    roles: strings(claims.roles),
    groupObjectIds: strings(claims.groups).map((item) => item.toLocaleLowerCase()),
  };
}

export function hasReportAdminRole(session: EntraSession) {
  return session.roles.includes(REPORT_ADMIN_ROLE);
}

export function safeReturnTo(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  if (value.startsWith("/api/auth/entra/")) return "/";
  return value.slice(0, 1024);
}

export async function createEntraAuthorizationRequest(
  request: Request,
  env: Record<string, string | undefined> = process.env,
) {
  const config = loadEntraAuthConfig(env);
  const origin = resolveAllowedRequestOrigin(request, config);
  const verifier = oidc.randomPKCECodeVerifier();
  const state = oidc.randomState();
  const nonce = oidc.randomNonce();
  const flow: EntraAuthorizationFlow = {
    expiresAt: Date.now() + 10 * 60 * 1000,
    verifier,
    state,
    nonce,
    returnTo: safeReturnTo(new URL(request.url).searchParams.get("returnTo")),
  };
  const authorizationUrl = oidc.buildAuthorizationUrl(await getOidcConfiguration(config), {
    redirect_uri: `${origin}/api/auth/entra/callback`,
    response_type: "code",
    scope: "openid profile email",
    code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
    code_challenge_method: "S256",
    state,
    nonce,
  });
  const cookie = await sealProtectedCookie(flow, config, "flow");
  return {
    authorizationUrl,
    cookie: serializeCookie(ENTRA_FLOW_COOKIE, cookie, {
      maxAge: 10 * 60,
      secure: origin.startsWith("https://"),
    }),
  };
}

export async function completeEntraAuthorizationRequest(
  request: Request,
  env: Record<string, string | undefined> = process.env,
) {
  const config = loadEntraAuthConfig(env);
  const origin = resolveAllowedRequestOrigin(request, config);
  const flowValue = readCookie(request.headers.get("cookie"), ENTRA_FLOW_COOKIE);
  if (!flowValue) throw new EntraAuthorizationError(401, "missing-authentication-flow");
  let flow: EntraAuthorizationFlow;
  try {
    flow = await openProtectedCookie(flowValue, config, "flow");
  } catch {
    throw new EntraAuthorizationError(401, "invalid-authentication-flow");
  }
  const tokens = await oidc.authorizationCodeGrant(
    await getOidcConfiguration(config),
    new URL(request.url),
    {
      pkceCodeVerifier: flow.verifier,
      expectedState: flow.state,
      expectedNonce: flow.nonce,
      idTokenExpected: true,
    },
  );
  const claims = tokens.claims();
  if (!claims) throw new EntraAuthorizationError(401, "missing-id-token");
  const session = sessionFromVerifiedClaims(claims as Record<string, unknown>, config);
  const protectedSession = await sealProtectedCookie(session, config, "session");
  return {
    returnUrl: new URL(flow.returnTo, origin),
    session,
    cookie: serializeCookie(ENTRA_SESSION_COOKIE, protectedSession, {
      maxAge: config.sessionSeconds,
      secure: origin.startsWith("https://"),
    }),
  };
}

export async function readEntraSession(
  cookieHeader: string | null,
  env: Record<string, string | undefined> = process.env,
) {
  const value = readCookie(cookieHeader, ENTRA_SESSION_COOKIE);
  if (!value) return null;
  const config = loadEntraAuthConfig(env);
  try {
    return await openProtectedCookie<EntraSession>(value, config, "session");
  } catch {
    return null;
  }
}

export async function requireReportAdmin(
  cookieHeader: string | null,
  env: Record<string, string | undefined> = process.env,
) {
  const session = await readEntraSession(cookieHeader, env);
  if (!session) throw new EntraAuthorizationError(401, "entra-sign-in-required");
  if (!hasReportAdminRole(session)) {
    throw new EntraAuthorizationError(403, "report-admin-role-required");
  }
  return session;
}

export async function readOptionalEntraSession(cookieHeader: string | null) {
  try {
    return await readEntraSession(cookieHeader);
  } catch {
    return null;
  }
}
