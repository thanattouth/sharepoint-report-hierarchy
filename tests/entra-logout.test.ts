import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "../app/api/auth/entra/logout/route";
import { ENTRA_FLOW_COOKIE, ENTRA_GRAPH_COOKIE, ENTRA_SESSION_COOKIE } from "../src/auth/session";

test("logout clears every application-owned Entra cookie and stops on a public signed-out page", async () => {
  const response = await POST(new Request("https://report.example.com/api/auth/entra/logout", {
    method: "POST",
  }));
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/auth/signed-out");
  assert.equal(response.headers.get("cache-control"), "no-store");
  const cookies = response.headers.getSetCookie();
  for (const name of [ENTRA_SESSION_COOKIE, ENTRA_FLOW_COOKIE, ENTRA_GRAPH_COOKIE]) {
    const cookie = cookies.find((value) => value.startsWith(`${name}=`));
    assert.ok(cookie, `${name} must be cleared`);
    assert.match(cookie, /Max-Age=0/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Secure/);
  }
});
