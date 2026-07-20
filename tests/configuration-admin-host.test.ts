import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const bicep = readFileSync("infra/configuration-admin-api/main.bicep", "utf8");
const host = readFileSync("services/configuration-admin-api/src/index.ts", "utf8");

test("Configuration Admin writer uses exact configuration-table scopes", () => {
  for (const table of [
    "HierarchyNodes",
    "ScopeAssignments",
    "HierarchySitePlacements",
    "HierarchySiteMappingAudit",
  ]) {
    assert.match(bicep, new RegExp(`name: '${table}'`));
  }
  assert.match(bicep, /scope: hierarchyNodes/);
  assert.match(bicep, /scope: scopeAssignments/);
  assert.match(bicep, /scope: hierarchySitePlacements/);
  assert.match(bicep, /scope: hierarchySiteMappingAudit/);
  assert.match(bicep, /scope: scannerSites/);
  assert.doesNotMatch(bicep, /scope: reportCache\s/);
});

test("Configuration Admin routes avoid Azure's reserved admin segment", () => {
  assert.match(host, /route: "configuration\/site-mappings"/);
  assert.match(host, /route: "configuration\/site-mappings\/preview"/);
  assert.match(host, /route: "configuration\/site-mappings\/apply"/);
  assert.doesNotMatch(host, /route: "admin\//);
});
