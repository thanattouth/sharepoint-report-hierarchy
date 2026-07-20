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

export function parseBusinessNodeChange(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("Hierarchy node change is invalid");
  const change = value as Record<string, unknown>;
  return {
    id: optionalString(change.id),
    expectedVersion: integer(change.expectedVersion, "expectedVersion"),
    type: requiredString(change.type, "type") as "EVP" | "Department" | "Group" | "Project",
    name: requiredString(change.name, "name"),
    parentId: optionalString(change.parentId),
    active: boolean(change.active, "active"),
  };
}

export function parseScopeAssignmentChange(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("Scope assignment change is invalid");
  const change = value as Record<string, unknown>;
  return {
    id: optionalString(change.id),
    expectedVersion: integer(change.expectedVersion, "expectedVersion"),
    principalType: requiredString(change.principalType, "principalType") as "User" | "Group",
    principalObjectId: optionalString(change.principalObjectId),
    principalDisplayName: optionalString(change.principalDisplayName),
    userUpn: optionalString(change.userUpn),
    nodeId: requiredString(change.nodeId, "nodeId"),
    businessRole: requiredString(change.businessRole, "businessRole") as
      | "EVP" | "DepartmentHead" | "GroupManager" | "ProjectOwner" | "Delegate",
    includeDescendants: boolean(change.includeDescendants, "includeDescendants"),
    active: boolean(change.active, "active"),
  };
}

function requiredString(value: unknown, name: string) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 256) {
    throw new Error(`${name} is invalid`);
  }
  return value.trim();
}

function optionalString(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.trim().length > 256) throw new Error("Optional string is invalid");
  return value.trim() || undefined;
}

function integer(value: unknown, name: string) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${name} is invalid`);
  }
  return value;
}

function boolean(value: unknown, name: string) {
  if (typeof value !== "boolean") throw new Error(`${name} is invalid`);
  return value;
}
