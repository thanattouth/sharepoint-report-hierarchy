import assert from "node:assert/strict";
import test from "node:test";
import { searchEntraSecurityGroups } from "../src/auth/entra-groups";

test("Entra Group Picker searches Graph server-side and returns only security groups", async () => {
  let requestedUrl = "";
  let authorization = "";
  let consistency = "";
  const groups = await searchEntraSecurityGroups("EVP-A", "delegated-token", async (input, init) => {
    requestedUrl = input.toString();
    const headers = new Headers(init?.headers);
    authorization = headers.get("authorization") ?? "";
    consistency = headers.get("consistencylevel") ?? "";
    return Response.json({ value: [
      { id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", displayName: "EVP-A", mail: null, securityEnabled: true },
      { id: "11111111-2222-4333-8444-555555555555", displayName: "M365 Team", securityEnabled: false },
    ] });
  });
  const url = new URL(requestedUrl);
  assert.equal(url.origin, "https://graph.microsoft.com");
  assert.equal(url.pathname, "/v1.0/groups");
  assert.equal(url.searchParams.get("$count"), "true");
  assert.equal(authorization, "Bearer delegated-token");
  assert.equal(consistency, "eventual");
  assert.deepEqual(groups, [{ id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", displayName: "EVP-A", mail: undefined }]);
});

test("Entra Group Picker bounds search input and rejects redirects", async () => {
  await assert.rejects(searchEntraSecurityGroups("x", "token"), /2 to 80/);
  await assert.rejects(
    searchEntraSecurityGroups("EVP", "token", async () => new Response(null, { status: 302 })),
    /redirects are not allowed/,
  );
});
