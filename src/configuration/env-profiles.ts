export const ENV_FILE_SCOPES = {
  ".env.storage.local": [
    "AZURE_STORAGE_ACCOUNT_NAME",
    "AZURE_STORAGE_TENANT_ID",
    "AZURE_TABLE_AUTH_MODE",
    "AZURE_STORAGE_MANAGED_IDENTITY_CLIENT_ID",
    "AZURE_TABLE_ENDPOINT",
    "AZURE_TABLE_INVENTORY_NAME",
    "AZURE_TABLE_SCAN_RUN_NAME",
    "AZURE_TABLE_DELTA_STATE_NAME",
    "AZURE_TABLE_SITE_SUMMARY_NAME",
    "AZURE_TABLE_SITE_NAME",
    "AZURE_TABLE_SITE_MAPPING_NAME",
    "AZURE_TABLE_HIERARCHY_NODE_NAME",
    "AZURE_TABLE_SCOPE_ASSIGNMENT_NAME",
    "AZURE_TABLE_SITE_MAPPING_AUDIT_NAME",
  ],
  ".env.scanner-target.local": [
    "SCANNER_TENANT_ID",
    "SCANNER_SCOPE_MODE",
    "SCANNER_ALLOWED_SITE_ID",
    "SCANNER_ALLOWED_LIBRARY_NAMES",
    "SCANNER_REPORTABLE_LABEL_IDS",
    "SCANNER_LABEL_DISPLAY_NAMES_JSON",
    "SCANNER_MAX_CONCURRENCY",
    "SCANNER_MAX_RETRIES",
  ],
  ".env.graph-pilot.local": [
    "SCANNER_AUTH_MODE",
    "SCANNER_MANAGED_IDENTITY_CLIENT_ID",
    "SCANNER_CLIENT_ID",
    "SCANNER_CLIENT_SECRET",
    "P4_PILOT_LIBRARY_NAMES",
    "P4_PILOT_MAX_FILES_PER_LIBRARY",
    "P4_PILOT_MAX_DELTA_PAGES_PER_LIBRARY",
  ],
  ".env.scheduled-scanner.local": [
    "SCANNER_AUTH_MODE",
    "SCANNER_MANAGED_IDENTITY_CLIENT_ID",
    "SCANNER_HOST_MANAGED_IDENTITY_CLIENT_ID",
    "SCANNER_HOST_STORAGE_ACCOUNT_NAME",
    "SCANNER_JOB_QUEUE_NAME",
    "SCANNER_BASELINE_WINDOW_OPEN",
    "SCANNER_NIGHTLY_SCHEDULE",
    "SCANNER_RECONCILIATION_SCHEDULE",
  ],
  ".env.p5-operator.local": [
    "P5_AZURE_SUBSCRIPTION_ID",
    "P5_AZURE_RESOURCE_GROUP",
    "P5_AZURE_LOCATION",
    "P5_HOSTED_SCANNER_CLIENT_ID",
    "P5_ASSIGN_MANAGED_IDENTITY_ROLES",
    "P5_SCHEDULES_DISABLED",
    "P5_NIGHTLY_SCHEDULE",
    "P5_RECONCILIATION_SCHEDULE",
    "P5_BASELINE_WAVE_ONE_SITE_IDS_JSON",
    "P5_BASELINE_EXCLUDE_SITE_IDS_JSON",
    "P5_BASELINE_SKIP_SITE_ID",
    "P5_BASELINE_SKIP_WAVE",
  ],
  ".env.report-api.local": [
    "REPORT_DATA_SOURCE",
    "REPORT_SITE_SOURCE",
    "REPORT_HIERARCHY_SOURCE",
    "REPORT_CACHE_TENANT_ID",
    "REPORT_REPORTABLE_LABEL_IDS",
    "REPORT_PILOT_SITE_ID",
    "REPORT_PILOT_SITE_NAME",
    "REPORT_PILOT_SITE_HOSTNAME",
    "REPORT_PILOT_SITE_PATH",
    "REPORT_PILOT_SITE_NODE_ID",
    "REPORT_PILOT_ALLOWED_UPNS",
    "REPORT_MAX_DETAIL_SITES",
    "REPORT_NEXT_SCHEDULED_SCAN",
  ],
  ".env.report-client.local": [
    "REPORT_DATA_SOURCE",
    "REPORT_API_BASE_URL",
    "REPORT_API_FUNCTION_KEY",
    "REPORT_API_TIMEOUT_MS",
  ],
  ".env.p6-operator.local": [
    "P6_AZURE_SUBSCRIPTION_ID",
    "P6_AZURE_RESOURCE_GROUP",
    "P6_AZURE_LOCATION",
    "P6_ASSIGN_MANAGED_IDENTITY_ROLES",
    "P6_REPORT_BASELINE_WAVE",
    "P6_EXPECTED_COMPLETED_WAVE_SITE_COUNT",
    "P6_EXPECTED_REPORT_SITE_COUNT",
    "P6_REQUIRED_REPORT_SITE_NAME",
    "P6_MAPPING_SITE_ID",
    "P6_MAPPING_NODE_ID",
  ],
  ".env.configuration-admin.local": [
    "REPORT_CACHE_TENANT_ID",
    "CONFIG_ADMIN_ALLOWED_ACTORS",
  ],
  ".env.configuration-client.local": [
    "CONFIG_ADMIN_API_BASE_URL",
    "CONFIG_ADMIN_API_FUNCTION_KEY",
    "CONFIG_ADMIN_API_TIMEOUT_MS",
  ],
  ".env.web-auth.local": [
    "ENTRA_AUTH_TENANT_ID",
    "ENTRA_AUTH_CLIENT_ID",
    "ENTRA_AUTH_CLIENT_SECRET",
    "ENTRA_AUTH_SESSION_SECRET",
    "ENTRA_AUTH_ALLOWED_ORIGINS",
    "ENTRA_AUTH_SESSION_HOURS",
  ],
  ".env.p7-operator.local": [
    "P7_AZURE_SUBSCRIPTION_ID",
    "P7_AZURE_RESOURCE_GROUP",
    "P7_AZURE_LOCATION",
    "P7_ASSIGN_MANAGED_IDENTITY_ROLES",
  ],
} as const;

export type EnvFileName = keyof typeof ENV_FILE_SCOPES;

export const ENV_PROFILES = {
  "p4-pilot": [".env.scanner-target.local", ".env.graph-pilot.local"],
  "p5-cache": [".env.storage.local", ".env.scanner-target.local", ".env.graph-pilot.local"],
  "p5-scanner": [
    ".env.storage.local",
    ".env.scanner-target.local",
    ".env.graph-pilot.local",
    ".env.scheduled-scanner.local",
    ".env.p5-operator.local",
    ".env.report-api.local",
  ],
  "p6-report": [".env.storage.local", ".env.report-api.local", ".env.p6-operator.local"],
  "p6-mapping": [
    ".env.storage.local",
    ".env.scanner-target.local",
    ".env.graph-pilot.local",
    ".env.report-api.local",
    ".env.p6-operator.local",
  ],
  "p7-configuration": [
    ".env.storage.local",
    ".env.configuration-admin.local",
    ".env.p7-operator.local",
  ],
  "p7-sites": [".env.configuration-client.local"],
  "p8-sites": [".env.configuration-client.local", ".env.web-auth.local"],
} as const satisfies Record<string, readonly EnvFileName[]>;

export type EnvProfileName = keyof typeof ENV_PROFILES;

export const LEGACY_ENV_FILE = ".env.p4.local";

export const KNOWN_ENV_KEYS: Set<string> = new Set(
  Object.values(ENV_FILE_SCOPES).flatMap((keys) => [...keys]),
);

export function isEnvProfileName(value: string): value is EnvProfileName {
  return value in ENV_PROFILES;
}

export function allowedKeysForProfile(profile: EnvProfileName): Set<string> {
  return new Set(
    ENV_PROFILES[profile].flatMap((file) => [...ENV_FILE_SCOPES[file]]),
  );
}

export function validateScopedEnvKeys(file: EnvFileName, keys: string[]): string[] {
  const allowed = new Set<string>(ENV_FILE_SCOPES[file]);
  return keys.filter((key) => KNOWN_ENV_KEYS.has(key) && !allowed.has(key));
}

const MANAGED_ENV_PREFIX = /^(AZURE_|REPORT_|SCANNER_|P4_|P5_|P6_|P7_|P8_|CONFIG_ADMIN_|ENTRA_AUTH_)/;

export function unknownManagedEnvKeys(keys: string[]): string[] {
  return keys.filter((key) => MANAGED_ENV_PREFIX.test(key) && !KNOWN_ENV_KEYS.has(key));
}
