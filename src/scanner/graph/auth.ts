import {
  ClientSecretCredential,
  DefaultAzureCredential,
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

export function createGraphTokenProvider(config: GraphPilotAuthConfig) {
  const credential = config.mode === "client-secret"
    ? new ClientSecretCredential(config.tenantId, config.clientId, config.clientSecret)
    : new DefaultAzureCredential({
        tenantId: config.tenantId,
        managedIdentityClientId: config.managedIdentityClientId,
      });
  return new AzureIdentityGraphTokenProvider(credential);
}
