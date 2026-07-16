import {
  ClientAssertionCredential,
  ClientSecretCredential,
  DefaultAzureCredential,
  ManagedIdentityCredential,
  type TokenCredential,
} from "@azure/identity";
import type { GraphAccessTokenProvider } from "./graph-client";
import type { GraphPilotAuthConfig } from "./config";

const GRAPH_SCOPE = "https://graph.microsoft.com/.default";

export class AzureIdentityGraphTokenProvider implements GraphAccessTokenProvider {
  constructor(private readonly credential: TokenCredential) {}

  async getAccessToken() {
    const token = await this.credential.getToken(GRAPH_SCOPE);
    if (!token?.token) throw new Error("Azure Identity did not return a Microsoft Graph token");
    return token.token;
  }
}

export function createAzureCredential(config: GraphPilotAuthConfig): TokenCredential {
  if (config.mode === "client-secret") {
    return new ClientSecretCredential(config.tenantId, config.clientId, config.clientSecret);
  }
  if (config.mode === "federated-identity") {
    const managedIdentity = new ManagedIdentityCredential(config.managedIdentityClientId);
    return new ClientAssertionCredential(
      config.tenantId,
      config.clientId,
      async () => {
        const assertion = await managedIdentity.getToken("api://AzureADTokenExchange/.default");
        if (!assertion?.token) {
          throw new Error("Managed identity did not return a workload identity assertion");
        }
        return assertion.token;
      },
    );
  }
  return new DefaultAzureCredential({
        tenantId: config.tenantId,
        managedIdentityClientId: config.managedIdentityClientId,
      });
}

export function createGraphTokenProvider(config: GraphPilotAuthConfig) {
  return new AzureIdentityGraphTokenProvider(createAzureCredential(config));
}
