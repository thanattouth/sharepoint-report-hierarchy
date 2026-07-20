import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchSiteMappingInbox,
  fetchSiteMappingPreview,
  applySiteMappingChangesFromApi,
  loadConfigurationAdminBridgeConfig,
  parseSiteMappingInboxQuery,
} from "../src/configuration/admin-bridge";

const config = {
  baseUrl: "https://configuration.example.com/api",
  functionKey: "server-secret",
  timeoutMs: 1000,
};
const actor = "admin@contoso.com";

test("Configuration Admin bridge validates server-only connection settings", () => {
  assert.deepEqual(loadConfigurationAdminBridgeConfig({
    CONFIG_ADMIN_API_BASE_URL: `${config.baseUrl}/`,
    CONFIG_ADMIN_API_FUNCTION_KEY: config.functionKey,
    CONFIG_ADMIN_API_TIMEOUT_MS: "1000",
  }), config);
  assert.throws(() => loadConfigurationAdminBridgeConfig({
    CONFIG_ADMIN_API_BASE_URL: "http://configuration.example.com/api",
    CONFIG_ADMIN_API_FUNCTION_KEY: config.functionKey,
  }), /HTTPS/);
});

test("Configuration Admin bridge keeps key and verified actor in server headers", async () => {
  let requestedUrl = "";
  let requestedHeaders = new Headers();
  let redirectMode: RequestRedirect | undefined;
  const inbox = await fetchSiteMappingInbox(config, actor, {
    status: "unmapped",
    query: "DGCS",
    page: 2,
    pageSize: 25,
  }, async (input, init) => {
    requestedUrl = input.toString();
    requestedHeaders = new Headers(init?.headers);
    redirectMode = init?.redirect;
    return Response.json({
      rows: [{
        siteId: "site-1",
        siteName: "DGCS",
        siteUrl: "https://contoso.sharepoint.com/sites/dgcs",
        status: "unmapped",
        version: 0,
      }],
      nodes: [{ id: "project-1", type: "Project", name: "DGCS", breadcrumb: "EVP / Department / Group / DGCS" }],
      total: 26,
      page: 2,
      pageSize: 25,
      pageCount: 2,
    });
  });
  assert.equal(inbox.capabilities.apply, true);
  assert.match(requestedUrl, /status=unmapped/);
  assert.match(requestedUrl, /q=DGCS/);
  assert.doesNotMatch(requestedUrl, /server-secret|admin%40contoso/);
  assert.equal(requestedHeaders.get("x-functions-key"), config.functionKey);
  assert.equal(requestedHeaders.get("x-configuration-actor"), actor);
  assert.equal(redirectMode, "manual");
});

test("Configuration Admin bridge validates query bounds and rejects redirects", async () => {
  assert.deepEqual(
    parseSiteMappingInboxQuery("https://app.example.com/api?status=mapped&page=3&pageSize=10"),
    { status: "mapped", query: "", page: 3, pageSize: 10 },
  );
  assert.throws(() => parseSiteMappingInboxQuery("https://app.example.com/api?status=unknown"), /invalid/);
  await assert.rejects(
    fetchSiteMappingInbox(config, actor, { status: "all", query: "", page: 1, pageSize: 25 }, async () => (
      new Response(null, { status: 302, headers: { Location: "https://attacker.example.com" } })
    )),
    /redirects are not allowed/,
  );
});

test("Configuration Admin preview and apply use the private bridge with confirmation", async () => {
  const preview = await fetchSiteMappingPreview(config, actor, {
    targetNodeId: "project-1",
    changes: [{ siteId: "site-1", expectedVersion: 0 }],
  }, async (_input, init) => {
    assert.equal(init?.method, "POST");
    assert.equal(new Headers(init?.headers).get("x-functions-key"), config.functionKey);
    return Response.json({
      targetNodeId: "project-1",
      targetBreadcrumb: "EVP / Department / Group / Project",
      selectedSiteCount: 1,
      newAssignments: 1,
      moves: 0,
      unchanged: 0,
      affectedPrincipals: [],
    });
  });
  assert.equal(preview.newAssignments, 1);

  const result = await applySiteMappingChangesFromApi(config, actor, {
    targetNodeId: "project-1",
    changes: [{ siteId: "site-1", expectedVersion: 0 }],
  }, async (_input, init) => {
    assert.equal(init?.method, "POST");
    assert.deepEqual(JSON.parse(String(init?.body)), {
      targetNodeId: "project-1",
      changes: [{ siteId: "site-1", expectedVersion: 0 }],
      confirm: true,
    });
    assert.equal(new Headers(init?.headers).get("x-configuration-actor"), actor);
    return Response.json({ status: "applied", siteCount: 1 });
  });
  assert.deepEqual(result, { status: "applied", siteCount: 1 });
});
