import assert from "node:assert/strict";
import test from "node:test";
import {
  authorizeConfigurationActor,
  loadConfigurationAdminApiConfig,
  parseMappingChanges,
} from "../src/configuration/api-config";

const tenantId = "11111111-1111-4111-8111-111111111111";

test("configuration admin API requires an explicit server-side actor allowlist", () => {
  assert.throws(() => loadConfigurationAdminApiConfig({}), /REPORT_CACHE_TENANT_ID/);
  const config = loadConfigurationAdminApiConfig({
    REPORT_CACHE_TENANT_ID: tenantId,
    CONFIG_ADMIN_ALLOWED_ACTORS: "Admin@contoso.com, governance@contoso.com",
  });
  assert.equal(authorizeConfigurationActor("ADMIN@contoso.com", config), "admin@contoso.com");
  assert.throws(() => authorizeConfigurationActor("attacker@contoso.com", config), /denied/);
});

test("configuration admin API bounds bulk mapping input", () => {
  assert.deepEqual(parseMappingChanges([
    { siteId: "site-1", expectedVersion: 2 },
  ]), [{ siteId: "site-1", expectedVersion: 2 }]);
  assert.throws(() => parseMappingChanges([]), /1-100/);
  assert.throws(() => parseMappingChanges([{ siteId: "site-1", expectedVersion: -1 }]), /Invalid/);
  assert.throws(() => parseMappingChanges(Array.from({ length: 101 }, (_, index) => ({
    siteId: `site-${index}`,
    expectedVersion: 0,
  }))), /1-100/);
});
