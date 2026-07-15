import {
  AzureCliCredential,
  ManagedIdentityCredential,
  type TokenCredential,
} from "@azure/identity";
import type { AzureTableStoreConfig } from "./config";

export function createAzureTableCredential(
  config: AzureTableStoreConfig["auth"],
): TokenCredential {
  return config.mode === "azure-cli"
    ? new AzureCliCredential({ tenantId: config.tenantId })
    : new ManagedIdentityCredential(
        config.clientId ? { clientId: config.clientId } : undefined,
      );
}
