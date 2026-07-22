export const DELIVERY_DEPLOYMENTS = {
  scanner: "p5-scheduled-scanner-v1",
  reportApi: "p6-report-cache-api-v1",
  configurationAdminApi: "p7-configuration-admin-api-v1",
  web: "p8-report-web-app-v1",
} as const;

export type AzureDeploymentOutputs = Record<string, { value?: unknown }>;

export function deploymentOutputString(
  outputs: AzureDeploymentOutputs,
  name: string,
): string {
  const value = outputs[name]?.value;
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Deployment output ${name} is unavailable`);
  }
  return value.trim();
}

export function deploymentOutputBoolean(
  outputs: AzureDeploymentOutputs,
  name: string,
): boolean {
  const value = outputs[name]?.value;
  if (typeof value !== "boolean") {
    throw new Error(`Deployment output ${name} is unavailable`);
  }
  return value;
}

export function workloadFunctionAppNames(input: {
  reportApi: AzureDeploymentOutputs;
  configurationAdminApi: AzureDeploymentOutputs;
}): { reportApi: string; configurationAdminApi: string } {
  return {
    reportApi: deploymentOutputString(input.reportApi, "functionAppName"),
    configurationAdminApi: deploymentOutputString(
      input.configurationAdminApi,
      "functionAppName",
    ),
  };
}

export const SCANNER_FEDERATED_CREDENTIAL_NAME =
  "scanner-workload-managed-identity";

export function scannerFederatedCredential(input: {
  tenantId: string;
  scannerIdentityPrincipalId: string;
}) {
  return {
    name: SCANNER_FEDERATED_CREDENTIAL_NAME,
    description: "Azure Function scheduled scanner workload managed identity",
    issuer: `https://login.microsoftonline.com/${input.tenantId}/v2.0`,
    subject: input.scannerIdentityPrincipalId,
    audiences: ["api://AzureADTokenExchange"],
  };
}
