export type ConfigurationAdminApiConfig = {
  cacheTenantId: string;
  allowedActors: Set<string>;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i;

function required(env: Record<string, string | undefined>, name: string) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function loadConfigurationAdminApiConfig(
  env: Record<string, string | undefined>,
): ConfigurationAdminApiConfig {
  const cacheTenantId = required(env, "REPORT_CACHE_TENANT_ID");
  if (!UUID_PATTERN.test(cacheTenantId)) throw new Error("REPORT_CACHE_TENANT_ID must be a UUID");
  const allowedActors = new Set(
    required(env, "CONFIG_ADMIN_ALLOWED_ACTORS")
      .split(",")
      .map((actor) => actor.trim().toLowerCase())
      .filter(Boolean),
  );
  if (allowedActors.size === 0) throw new Error("CONFIG_ADMIN_ALLOWED_ACTORS is empty");
  return { cacheTenantId, allowedActors };
}

export function authorizeConfigurationActor(
  actorHeader: string | null,
  config: ConfigurationAdminApiConfig,
) {
  const actor = actorHeader?.trim().toLowerCase();
  if (!actor || !config.allowedActors.has(actor)) throw new Error("Configuration actor is denied");
  return actor;
}

export function parseMappingChanges(value: unknown) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
    throw new Error("changes must contain 1-100 Sites");
  }
  return value.map((change) => {
    if (!change || typeof change !== "object") throw new Error("Invalid Site mapping change");
    const { siteId, expectedVersion } = change as Record<string, unknown>;
    if (typeof siteId !== "string" || !siteId.trim()
      || typeof expectedVersion !== "number" || !Number.isInteger(expectedVersion)
      || expectedVersion < 0) {
      throw new Error("Invalid Site mapping change");
    }
    return { siteId: siteId.trim(), expectedVersion };
  });
}
