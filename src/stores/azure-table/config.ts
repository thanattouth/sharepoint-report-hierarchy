export type AzureTableStoreConfig = {
  accountName: string;
  endpoint: string;
  inventoryTableName: string;
  scanRunTableName: string;
  deltaStateTableName: string;
};

const ACCOUNT_NAME = /^[a-z0-9]{3,24}$/;
const TABLE_NAME = /^[A-Za-z][A-Za-z0-9]{2,62}$/;

function required(env: Record<string, string | undefined>, name: string) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function tableName(value: string, name: string) {
  if (!TABLE_NAME.test(value)) {
    throw new Error(`${name} must be 3-63 alphanumeric characters and start with a letter`);
  }
  return value;
}

export function loadAzureTableStoreConfig(
  env: Record<string, string | undefined>,
): AzureTableStoreConfig {
  const accountName = required(env, "AZURE_STORAGE_ACCOUNT_NAME");
  if (!ACCOUNT_NAME.test(accountName)) {
    throw new Error("AZURE_STORAGE_ACCOUNT_NAME must be 3-24 lowercase alphanumeric characters");
  }
  const endpoint = env.AZURE_TABLE_ENDPOINT?.trim()
    || `https://${accountName}.table.core.windows.net`;
  const parsed = new URL(endpoint);
  if (parsed.protocol !== "https:" && parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
    throw new Error("AZURE_TABLE_ENDPOINT must use HTTPS outside local development");
  }
  return {
    accountName,
    endpoint: parsed.toString().replace(/\/$/, ""),
    inventoryTableName: tableName(
      env.AZURE_TABLE_INVENTORY_NAME?.trim() || "SensitivityInventory",
      "AZURE_TABLE_INVENTORY_NAME",
    ),
    scanRunTableName: tableName(
      env.AZURE_TABLE_SCAN_RUN_NAME?.trim() || "SensitivityScanRuns",
      "AZURE_TABLE_SCAN_RUN_NAME",
    ),
    deltaStateTableName: tableName(
      env.AZURE_TABLE_DELTA_STATE_NAME?.trim() || "SensitivityDeltaState",
      "AZURE_TABLE_DELTA_STATE_NAME",
    ),
  };
}
