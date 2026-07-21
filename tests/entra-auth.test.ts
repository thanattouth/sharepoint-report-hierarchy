import assert from "node:assert/strict";
import test from "node:test";
import {
  EntraAuthorizationError,
  hasReportAdminRole,
  requireReportViewer,
  requireReportAdmin,
  safeAuthenticationPrompt,
  safeReturnTo,
  sessionFromVerifiedClaims,
  type EntraSession,
} from "../src/auth/entra";
import {
  loadEntraAuthConfig,
  resolveAllowedRequestOrigin,
  resolveAllowedRequestUrl,
} from "../src/auth/entra-config";
import {
  ENTRA_SESSION_COOKIE,
  openProtectedCookie,
  sealProtectedCookie,
  serializeCookie,
} from "../src/auth/session";

const env = {
  ENTRA_AUTH_TENANT_ID: "778a528f-5fd8-4807-be62-7be9025cd230",
  ENTRA_AUTH_CLIENT_ID: "11111111-2222-4333-8444-555555555555",
  ENTRA_AUTH_CLIENT_SECRET: "test-client-secret-long-enough",
  ENTRA_AUTH_SESSION_SECRET: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
  ENTRA_AUTH_ALLOWED_ORIGINS: "https://report.example.com,http://localhost:3000",
  ENTRA_AUTH_SESSION_HOURS: "8",
};

test("Entra auth configuration validates tenant, origins, and a 256-bit session key", () => {
  const config = loadEntraAuthConfig(env);
  assert.equal(config.sessionSecret.byteLength, 32);
  assert.equal(config.sessionSeconds, 8 * 60 * 60);
  assert.equal(config.allowedOrigins.has("https://report.example.com"), true);
  assert.equal(config.groupPickerEnabled, false);
  assert.equal(loadEntraAuthConfig({ ...env, ENTRA_AUTH_GROUP_PICKER_ENABLED: "true" }).groupPickerEnabled, true);
  assert.throws(() => loadEntraAuthConfig({ ...env, ENTRA_AUTH_ALLOWED_ORIGINS: "http://report.example.com" }), /HTTPS/);
  assert.throws(() => loadEntraAuthConfig({ ...env, ENTRA_AUTH_SESSION_SECRET: "c2hvcnQ" }), /32 bytes/);
});

test("Entra origin resolution accepts only an allowlisted reverse-proxy origin", () => {
  const config = loadEntraAuthConfig(env);
  const proxied = new Request("http://127.0.0.1:8080/api/auth/entra/login", {
    headers: {
      "x-forwarded-host": "report.example.com",
      "x-forwarded-proto": "https",
    },
  });
  assert.equal(resolveAllowedRequestOrigin(proxied, config), "https://report.example.com");
  assert.equal(
    resolveAllowedRequestUrl(
      new Request("http://127.0.0.1:8080/api/auth/entra/callback?code=opaque", {
        headers: {
          "x-forwarded-host": "report.example.com",
          "x-forwarded-proto": "https",
        },
      }),
      config,
    ).toString(),
    "https://report.example.com/api/auth/entra/callback?code=opaque",
  );
  assert.throws(
    () => resolveAllowedRequestOrigin(new Request(proxied, {
      headers: {
        "x-forwarded-host": "attacker.example.com",
        "x-forwarded-proto": "https",
      },
    }), config),
    /not allowed/,
  );
});

test("verified Entra claims bind session to tenant, audience, object ID, and app roles", () => {
  const config = loadEntraAuthConfig(env);
  const claims = {
    tid: config.tenantId,
    aud: config.clientId,
    oid: "a7571cc1-6e86-48c9-a3c7-ced085672e35",
    preferred_username: "Thanattouth@m365.co.th",
    name: "Thanattouth",
    roles: ["ReportAdmin"],
    groups: ["AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE"],
  };
  const session = sessionFromVerifiedClaims(claims, config, 1_000);
  assert.equal(session.userPrincipalName, "thanattouth@m365.co.th");
  assert.equal(hasReportAdminRole(session), true);
  assert.deepEqual(session.groupObjectIds, ["aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"]);
  assert.equal(session.groupClaimsComplete, true);
  assert.throws(
    () => sessionFromVerifiedClaims({ ...claims, tid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" }, config),
    (error) => error instanceof EntraAuthorizationError && error.code === "wrong-tenant",
  );
  assert.throws(
    () => sessionFromVerifiedClaims({ ...claims, aud: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" }, config),
    (error) => error instanceof EntraAuthorizationError && error.code === "wrong-audience",
  );
});

test("report access accepts viewer/admin roles and fails closed on group overage", async () => {
  const config = loadEntraAuthConfig(env);
  const base: EntraSession = {
    expiresAt: Date.now() + 60_000,
    tenantId: config.tenantId,
    principalObjectId: "a7571cc1-6e86-48c9-a3c7-ced085672e35",
    userPrincipalName: "viewer@m365.co.th",
    displayName: "Viewer",
    roles: ["ReportViewer"],
    groupObjectIds: [],
    groupClaimsComplete: true,
  };
  const viewer = await sealProtectedCookie(base, config, "session");
  assert.equal((await requireReportViewer(`${ENTRA_SESSION_COOKIE}=${viewer}`, env)).userPrincipalName, base.userPrincipalName);
  const overage = await sealProtectedCookie({ ...base, groupClaimsComplete: false }, config, "session");
  await assert.rejects(
    requireReportViewer(`${ENTRA_SESSION_COOKIE}=${overage}`, env),
    (error) => error instanceof EntraAuthorizationError && error.code === "group-claim-overage",
  );
});

test("Entra session cookie is confidential, tamper-evident, expiring, and role-gated", async () => {
  const config = loadEntraAuthConfig(env);
  const session: EntraSession = {
    expiresAt: Date.now() + 60_000,
    tenantId: config.tenantId,
    principalObjectId: "a7571cc1-6e86-48c9-a3c7-ced085672e35",
    userPrincipalName: "thanattouth@m365.co.th",
    displayName: "Thanattouth",
    roles: ["ReportAdmin"],
    groupObjectIds: [],
    groupClaimsComplete: true,
  };
  const sealed = await sealProtectedCookie(session, config, "session");
  assert.doesNotMatch(sealed, /thanattouth|ReportAdmin/i);
  assert.deepEqual(await openProtectedCookie<EntraSession>(sealed, config, "session"), session);
  const tamperIndex = Math.floor(sealed.length / 2);
  const tampered = `${sealed.slice(0, tamperIndex)}${sealed[tamperIndex] === "A" ? "B" : "A"}${sealed.slice(tamperIndex + 1)}`;
  await assert.rejects(
    openProtectedCookie<EntraSession>(tampered, config, "session"),
    /invalid/,
  );
  const cookie = serializeCookie(ENTRA_SESSION_COOKIE, sealed, { maxAge: 60, secure: true });
  assert.equal((await requireReportAdmin(cookie, env)).principalObjectId, session.principalObjectId);

  const viewer = await sealProtectedCookie({ ...session, roles: ["ReportViewer"] }, config, "session");
  await assert.rejects(
    requireReportAdmin(`${ENTRA_SESSION_COOKIE}=${viewer}`, env),
    (error) => error instanceof EntraAuthorizationError && error.status === 403,
  );
  await assert.rejects(
    requireReportAdmin(null, env),
    (error) => error instanceof EntraAuthorizationError && error.status === 401,
  );
});

test("return path validation prevents external and auth-loop redirects", () => {
  assert.equal(safeReturnTo("/admin/site-mappings?status=unmapped"), "/admin/site-mappings?status=unmapped");
  assert.equal(safeReturnTo("//attacker.example.com"), "/");
  assert.equal(safeReturnTo("https://attacker.example.com"), "/");
  assert.equal(safeReturnTo("/api/auth/entra/callback"), "/");
});

test("account switching permits only the bounded OIDC prompt", () => {
  assert.equal(safeAuthenticationPrompt("select_account"), "select_account");
  assert.equal(safeAuthenticationPrompt("login"), undefined);
  assert.equal(safeAuthenticationPrompt("consent"), undefined);
  assert.equal(safeAuthenticationPrompt(null), undefined);
});
