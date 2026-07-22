import assert from "node:assert/strict";
import test from "node:test";
import {
  deploymentOutputBoolean,
  deploymentOutputString,
  scannerFederatedCredential,
  workloadFunctionAppNames,
} from "../src/delivery/deployment-outputs";

test("customer delivery derives workload names from immutable deployment outputs", () => {
  assert.deepEqual(workloadFunctionAppNames({
    reportApi: { functionAppName: { value: "func-report-derived" } },
    configurationAdminApi: { functionAppName: { value: "func-config-derived" } },
  }), {
    reportApi: "func-report-derived",
    configurationAdminApi: "func-config-derived",
  });
  assert.equal(deploymentOutputBoolean({ ready: { value: true } }, "ready"), true);
  assert.throws(() => deploymentOutputString({}, "functionAppName"), /unavailable/);
});

test("scanner federation is tenant-pinned and bound to the workload identity", () => {
  assert.deepEqual(scannerFederatedCredential({
    tenantId: "11111111-1111-4111-8111-111111111111",
    scannerIdentityPrincipalId: "22222222-2222-4222-8222-222222222222",
  }), {
    name: "scanner-workload-managed-identity",
    description: "Azure Function scheduled scanner workload managed identity",
    issuer: "https://login.microsoftonline.com/11111111-1111-4111-8111-111111111111/v2.0",
    subject: "22222222-2222-4222-8222-222222222222",
    audiences: ["api://AzureADTokenExchange"],
  });
});
