import assert from "node:assert/strict";
import test from "node:test";
import {
  ENTERPRISE_APPLICATION_TAG,
  enterpriseApplicationTags,
  resolveGraphResourceAccess,
  SCANNER_APPLICATION_GRAPH_PERMISSIONS,
  WEB_APP_ROLES,
  WEB_DELEGATED_GRAPH_PERMISSIONS,
} from "../src/delivery/entra-applications";

const graph = {
  appRoles: [
    { id: "files", value: "Files.Read.All", allowedMemberTypes: ["Application"] },
    { id: "sites", value: "Sites.Read.All", allowedMemberTypes: ["Application"] },
  ],
  oauth2PermissionScopes: [{ id: "groups", value: "GroupMember.Read.All" }],
};

test("delivery identities retain separate report roles and least required Graph permission types", () => {
  assert.deepEqual(WEB_APP_ROLES.map((role) => role.value), ["ReportAdmin", "ReportViewer"]);
  assert.deepEqual(
    resolveGraphResourceAccess(graph, WEB_DELEGATED_GRAPH_PERMISSIONS, "Scope"),
    [{ id: "groups", type: "Scope" }],
  );
  assert.deepEqual(
    resolveGraphResourceAccess(graph, SCANNER_APPLICATION_GRAPH_PERMISSIONS, "Role"),
    [{ id: "files", type: "Role" }, { id: "sites", type: "Role" }],
  );
});

test("delivery identity planning fails closed when Graph permission resolution drifts", () => {
  assert.throws(
    () => resolveGraphResourceAccess({ appRoles: [], oauth2PermissionScopes: [] }, ["Sites.Read.All"], "Role"),
    /permission is unavailable/,
  );
});

test("delivery service principals retain existing tags and appear as Enterprise applications", () => {
  assert.deepEqual(enterpriseApplicationTags(), [ENTERPRISE_APPLICATION_TAG]);
  assert.deepEqual(
    enterpriseApplicationTags(["existing", ENTERPRISE_APPLICATION_TAG, "existing"]),
    ["existing", ENTERPRISE_APPLICATION_TAG],
  );
});
