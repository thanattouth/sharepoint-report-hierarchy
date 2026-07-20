export type AzureTableStoreConfig = {
  accountName: string;
  endpoint: string;
  inventoryTableName: string;
  scanRunTableName: string;
  deltaStateTableName: string;
  siteSummaryTableName: string;
  siteTableName: string;
  siteMappingTableName: string;
  hierarchyNodeTableName: string;
  scopeAssignmentTableName: string;
  siteMappingAuditTableName: string;
  auth:
    | {
        mode: "azure-cli";
        tenantId: string;
      }
    | {
        mode: "managed-identity";
        tenantId: string;
        clientId?: string;
      };
};

const ACCOUNT_NAME = /^[a-z0-9]{3,24}$/;
const TABLE_NAME = /^[A-Za-z][A-Za-z0-9]{2,62}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function uuid(value: string, name: string) {
  if (!UUID_PATTERN.test(value)) throw new Error(`${name} must be a UUID`);
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
  const tenantId = uuid(
    required(env, "AZURE_STORAGE_TENANT_ID"),
    "AZURE_STORAGE_TENANT_ID",
  );
  const authMode = required(env, "AZURE_TABLE_AUTH_MODE");
  if (authMode !== "azure-cli" && authMode !== "managed-identity") {
    throw new Error("AZURE_TABLE_AUTH_MODE must be azure-cli or managed-identity");
  }
  const managedIdentityClientId = env.AZURE_STORAGE_MANAGED_IDENTITY_CLIENT_ID?.trim();
  if (managedIdentityClientId && authMode !== "managed-identity") {
    throw new Error(
      "AZURE_STORAGE_MANAGED_IDENTITY_CLIENT_ID requires managed-identity auth mode",
    );
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
    siteSummaryTableName: tableName(
      env.AZURE_TABLE_SITE_SUMMARY_NAME?.trim() || "SiteLabelSummary",
      "AZURE_TABLE_SITE_SUMMARY_NAME",
    ),
    siteTableName: tableName(
      env.AZURE_TABLE_SITE_NAME?.trim() || "ScannerSites",
      "AZURE_TABLE_SITE_NAME",
    ),
    siteMappingTableName: tableName(
      env.AZURE_TABLE_SITE_MAPPING_NAME?.trim() || "HierarchySitePlacements",
      "AZURE_TABLE_SITE_MAPPING_NAME",
    ),
    hierarchyNodeTableName: tableName(
      env.AZURE_TABLE_HIERARCHY_NODE_NAME?.trim() || "HierarchyNodes",
      "AZURE_TABLE_HIERARCHY_NODE_NAME",
    ),
    scopeAssignmentTableName: tableName(
      env.AZURE_TABLE_SCOPE_ASSIGNMENT_NAME?.trim() || "ScopeAssignments",
      "AZURE_TABLE_SCOPE_ASSIGNMENT_NAME",
    ),
    siteMappingAuditTableName: tableName(
      env.AZURE_TABLE_SITE_MAPPING_AUDIT_NAME?.trim() || "HierarchySiteMappingAudit",
      "AZURE_TABLE_SITE_MAPPING_AUDIT_NAME",
    ),
    auth: authMode === "azure-cli"
      ? { mode: authMode, tenantId }
      : {
          mode: authMode,
          tenantId,
          clientId: managedIdentityClientId
            ? uuid(
                managedIdentityClientId,
                "AZURE_STORAGE_MANAGED_IDENTITY_CLIENT_ID",
              )
            : undefined,
        },
  };
}
