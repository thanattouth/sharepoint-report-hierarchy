import { readFileSync } from "node:fs";
import type { BusinessRole, GovernanceHierarchyNode } from "../domain/types";
import { validateHierarchyConfiguration } from "../domain/hierarchy";

export const CUSTOMER_DELIVERY_SCHEMA_VERSION = 1 as const;

export type CustomerDeliveryManifest = {
  schemaVersion: typeof CUSTOMER_DELIVERY_SCHEMA_VERSION;
  deploymentName: string;
  tenantId: string;
  subscriptionId: string;
  location: string;
  resourceGroupName: string;
  storageAccountName: string;
  entra: {
    webAppDisplayName: string;
    scannerAppDisplayName: string;
    webRedirectUris: string[];
  };
  workloads?: {
    scanner: {
      scopeMode: "single-site" | "registry";
      allowedLibraryNames: string[];
      reportableLabels: Array<{ id: string; displayName: string }>;
      maxConcurrency: number;
      maxRetries: number;
      nightlySchedule: string;
      reconciliationSchedule: string;
      schedulesDisabled: boolean;
    };
    bootstrapSite: {
      id: string;
      name: string;
      hostname: string;
      path: string;
      businessNodeId: string;
    };
    report: {
      allowedUpns: string[];
      maxDetailSites: number;
    };
    configurationAdmin: {
      allowedActors: string[];
    };
    businessScope?: {
      nodes: GovernanceHierarchyNode[];
      memberUpns: string[];
      reportAdminGroupDisplayName: string;
      scopeGroups: Array<{
        displayName: string;
        nodeId: string;
        businessRole: BusinessRole;
        includeDescendants: boolean;
      }>;
    };
  };
  rbac: {
    mode: "admin-handoff" | "deploy";
    tableDataPrincipalId?: string;
    tableDataPrincipalType?: "User" | "ServicePrincipal";
  };
  tags: Record<string, string>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEPLOYMENT_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
const RESOURCE_GROUP_NAME = /^[a-zA-Z0-9._()-]{1,89}[a-zA-Z0-9_()-]$/;
const STORAGE_ACCOUNT_NAME = /^[a-z0-9]{3,24}$/;
const LOCATION = /^[a-z0-9]+$/;
const TAG_KEY = /^(?!.*[<>%&\\?/])[\s\S]{1,512}$/;

function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${path} must be a non-empty string`);
  return value.trim();
}

function exactKeys(value: Record<string, unknown>, expected: string[], path: string): void {
  const unknown = Object.keys(value).filter((key) => !expected.includes(key));
  if (unknown.length) throw new Error(`${path} contains unknown keys: ${unknown.join(", ")}`);
}

export function parseCustomerDeliveryManifest(input: unknown): CustomerDeliveryManifest {
  const root = object(input, "manifest");
  exactKeys(root, [
    "schemaVersion",
    "deploymentName",
    "tenantId",
    "subscriptionId",
    "location",
    "resourceGroupName",
    "storageAccountName",
    "entra",
    "workloads",
    "rbac",
    "tags",
  ], "manifest");

  if (root.schemaVersion !== CUSTOMER_DELIVERY_SCHEMA_VERSION) {
    throw new Error(`manifest.schemaVersion must be ${CUSTOMER_DELIVERY_SCHEMA_VERSION}`);
  }

  const deploymentName = string(root.deploymentName, "manifest.deploymentName");
  if (!DEPLOYMENT_NAME.test(deploymentName)) throw new Error("manifest.deploymentName is invalid");

  const tenantId = string(root.tenantId, "manifest.tenantId");
  if (!UUID.test(tenantId)) throw new Error("manifest.tenantId must be a UUID");
  const subscriptionId = string(root.subscriptionId, "manifest.subscriptionId");
  if (!UUID.test(subscriptionId)) throw new Error("manifest.subscriptionId must be a UUID");

  const location = string(root.location, "manifest.location").toLowerCase();
  if (!LOCATION.test(location)) throw new Error("manifest.location must be an Azure location name");
  const resourceGroupName = string(root.resourceGroupName, "manifest.resourceGroupName");
  if (!RESOURCE_GROUP_NAME.test(resourceGroupName)) throw new Error("manifest.resourceGroupName is invalid");
  const storageAccountName = string(root.storageAccountName, "manifest.storageAccountName");
  if (!STORAGE_ACCOUNT_NAME.test(storageAccountName)) {
    throw new Error("manifest.storageAccountName must be 3-24 lowercase alphanumeric characters");
  }

  const entraInput = object(root.entra, "manifest.entra");
  exactKeys(entraInput, ["webAppDisplayName", "scannerAppDisplayName", "webRedirectUris"], "manifest.entra");
  const webAppDisplayName = string(entraInput.webAppDisplayName, "manifest.entra.webAppDisplayName");
  const scannerAppDisplayName = string(entraInput.scannerAppDisplayName, "manifest.entra.scannerAppDisplayName");
  if (webAppDisplayName === scannerAppDisplayName) {
    throw new Error("manifest.entra application display names must be distinct");
  }
  if (!Array.isArray(entraInput.webRedirectUris) || !entraInput.webRedirectUris.length) {
    throw new Error("manifest.entra.webRedirectUris must be a non-empty array");
  }
  const webRedirectUris = entraInput.webRedirectUris.map((value, index) => {
    const uri = string(value, `manifest.entra.webRedirectUris[${index}]`);
    let parsed: URL;
    try {
      parsed = new URL(uri);
    } catch {
      throw new Error(`manifest.entra.webRedirectUris[${index}] must be an absolute URL`);
    }
    const local = parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname);
    if (parsed.protocol !== "https:" && !local) {
      throw new Error(`manifest.entra.webRedirectUris[${index}] must use HTTPS outside localhost`);
    }
    if (parsed.pathname !== "/api/auth/entra/callback" || parsed.search || parsed.hash) {
      throw new Error(`manifest.entra.webRedirectUris[${index}] must be an exact Entra callback URL`);
    }
    return parsed.toString();
  });
  if (new Set(webRedirectUris).size !== webRedirectUris.length) {
    throw new Error("manifest.entra.webRedirectUris must not contain duplicates");
  }

  let workloads: CustomerDeliveryManifest["workloads"];
  if (root.workloads !== undefined) {
    const workloadsInput = object(root.workloads, "manifest.workloads");
    exactKeys(workloadsInput, ["scanner", "bootstrapSite", "report", "configurationAdmin", "businessScope"], "manifest.workloads");
    const scannerInput = object(workloadsInput.scanner, "manifest.workloads.scanner");
    exactKeys(scannerInput, [
      "scopeMode", "allowedLibraryNames", "reportableLabels", "maxConcurrency", "maxRetries",
      "nightlySchedule", "reconciliationSchedule", "schedulesDisabled",
    ], "manifest.workloads.scanner");
    const scopeMode = string(scannerInput.scopeMode, "manifest.workloads.scanner.scopeMode");
    if (scopeMode !== "single-site" && scopeMode !== "registry") throw new Error("manifest.workloads.scanner.scopeMode is invalid");
    const allowedLibraryNames = stringArray(scannerInput.allowedLibraryNames, "manifest.workloads.scanner.allowedLibraryNames");
    if (!Array.isArray(scannerInput.reportableLabels) || !scannerInput.reportableLabels.length) {
      throw new Error("manifest.workloads.scanner.reportableLabels must be a non-empty array");
    }
    const reportableLabels = scannerInput.reportableLabels.map((value, index) => {
      const label = object(value, `manifest.workloads.scanner.reportableLabels[${index}]`);
      exactKeys(label, ["id", "displayName"], `manifest.workloads.scanner.reportableLabels[${index}]`);
      const id = string(label.id, `manifest.workloads.scanner.reportableLabels[${index}].id`);
      if (!UUID.test(id)) throw new Error(`manifest.workloads.scanner.reportableLabels[${index}].id must be a UUID`);
      return { id, displayName: string(label.displayName, `manifest.workloads.scanner.reportableLabels[${index}].displayName`) };
    });
    if (new Set(reportableLabels.map(({ id }) => id.toLowerCase())).size !== reportableLabels.length) {
      throw new Error("manifest.workloads.scanner.reportableLabels contains duplicate IDs");
    }
    const maxConcurrency = boundedInteger(scannerInput.maxConcurrency, "manifest.workloads.scanner.maxConcurrency", 1, 20);
    const maxRetries = boundedInteger(scannerInput.maxRetries, "manifest.workloads.scanner.maxRetries", 0, 10);
    const nightlySchedule = string(scannerInput.nightlySchedule, "manifest.workloads.scanner.nightlySchedule");
    const reconciliationSchedule = string(scannerInput.reconciliationSchedule, "manifest.workloads.scanner.reconciliationSchedule");
    if (typeof scannerInput.schedulesDisabled !== "boolean") throw new Error("manifest.workloads.scanner.schedulesDisabled must be boolean");
    if (!scannerInput.schedulesDisabled) throw new Error("initial customer delivery requires schedulesDisabled=true");

    const siteInput = object(workloadsInput.bootstrapSite, "manifest.workloads.bootstrapSite");
    exactKeys(siteInput, ["id", "name", "hostname", "path", "businessNodeId"], "manifest.workloads.bootstrapSite");
    const siteId = string(siteInput.id, "manifest.workloads.bootstrapSite.id");
    const siteParts = siteId.split(",");
    if (siteParts.length !== 3 || !UUID.test(siteParts[1]) || !UUID.test(siteParts[2])) {
      throw new Error("manifest.workloads.bootstrapSite.id must be a canonical Graph Site ID");
    }
    const hostname = string(siteInput.hostname, "manifest.workloads.bootstrapSite.hostname").toLowerCase();
    if (siteParts[0].toLowerCase() !== hostname || !/^[a-z0-9.-]+\.sharepoint\.com$/.test(hostname)) {
      throw new Error("manifest.workloads.bootstrapSite.hostname must match the Graph Site ID");
    }
    const sitePath = string(siteInput.path, "manifest.workloads.bootstrapSite.path");
    if (!sitePath.startsWith("/sites/") || sitePath.includes("..")) throw new Error("manifest.workloads.bootstrapSite.path is invalid");

    const reportInput = object(workloadsInput.report, "manifest.workloads.report");
    exactKeys(reportInput, ["allowedUpns", "maxDetailSites"], "manifest.workloads.report");
    const allowedUpns = stringArray(reportInput.allowedUpns, "manifest.workloads.report.allowedUpns").map(validateUpn);
    const maxDetailSites = boundedInteger(reportInput.maxDetailSites, "manifest.workloads.report.maxDetailSites", 1, 100);
    const adminInput = object(workloadsInput.configurationAdmin, "manifest.workloads.configurationAdmin");
    exactKeys(adminInput, ["allowedActors"], "manifest.workloads.configurationAdmin");
    const allowedActors = stringArray(adminInput.allowedActors, "manifest.workloads.configurationAdmin.allowedActors").map(validateUpn);

    let businessScope: NonNullable<CustomerDeliveryManifest["workloads"]>["businessScope"];
    if (workloadsInput.businessScope !== undefined) {
      const scopeInput = object(workloadsInput.businessScope, "manifest.workloads.businessScope");
      exactKeys(scopeInput, ["nodes", "memberUpns", "reportAdminGroupDisplayName", "scopeGroups"], "manifest.workloads.businessScope");
      if (!Array.isArray(scopeInput.nodes) || !scopeInput.nodes.length) {
        throw new Error("manifest.workloads.businessScope.nodes must be a non-empty array");
      }
      const nodes = scopeInput.nodes.map((value, index): GovernanceHierarchyNode => {
        const node = object(value, `manifest.workloads.businessScope.nodes[${index}]`);
        exactKeys(node, ["id", "parentId", "type", "name", "active"], `manifest.workloads.businessScope.nodes[${index}]`);
        const type = string(node.type, `manifest.workloads.businessScope.nodes[${index}].type`);
        if (!(["EVP", "Department", "Group", "Project"] as const).includes(type as GovernanceHierarchyNode["type"])) {
          throw new Error(`manifest.workloads.businessScope.nodes[${index}].type is invalid`);
        }
        if (typeof node.active !== "boolean") throw new Error(`manifest.workloads.businessScope.nodes[${index}].active must be boolean`);
        return {
          id: string(node.id, `manifest.workloads.businessScope.nodes[${index}].id`),
          ...(node.parentId === undefined ? {} : { parentId: string(node.parentId, `manifest.workloads.businessScope.nodes[${index}].parentId`) }),
          type: type as GovernanceHierarchyNode["type"],
          name: string(node.name, `manifest.workloads.businessScope.nodes[${index}].name`),
          active: node.active,
        };
      });
      const memberUpns = stringArray(scopeInput.memberUpns, "manifest.workloads.businessScope.memberUpns").map(validateUpn);
      if (!Array.isArray(scopeInput.scopeGroups) || !scopeInput.scopeGroups.length) {
        throw new Error("manifest.workloads.businessScope.scopeGroups must be a non-empty array");
      }
      const scopeGroups = scopeInput.scopeGroups.map((value, index) => {
        const group = object(value, `manifest.workloads.businessScope.scopeGroups[${index}]`);
        exactKeys(group, ["displayName", "nodeId", "businessRole", "includeDescendants"], `manifest.workloads.businessScope.scopeGroups[${index}]`);
        const businessRole = string(group.businessRole, `manifest.workloads.businessScope.scopeGroups[${index}].businessRole`);
        if (!(["EVP", "DepartmentHead", "GroupManager", "ProjectOwner", "Delegate"] as const).includes(businessRole as BusinessRole)) {
          throw new Error(`manifest.workloads.businessScope.scopeGroups[${index}].businessRole is invalid`);
        }
        if (typeof group.includeDescendants !== "boolean") {
          throw new Error(`manifest.workloads.businessScope.scopeGroups[${index}].includeDescendants must be boolean`);
        }
        return {
          displayName: string(group.displayName, `manifest.workloads.businessScope.scopeGroups[${index}].displayName`),
          nodeId: string(group.nodeId, `manifest.workloads.businessScope.scopeGroups[${index}].nodeId`),
          businessRole: businessRole as BusinessRole,
          includeDescendants: group.includeDescendants,
        };
      });
      const displayNames = [string(scopeInput.reportAdminGroupDisplayName, "manifest.workloads.businessScope.reportAdminGroupDisplayName"), ...scopeGroups.map(({ displayName }) => displayName)];
      if (new Set(displayNames.map((value) => value.toLowerCase())).size !== displayNames.length) {
        throw new Error("manifest.workloads.businessScope Entra group display names must be distinct");
      }
      const site = {
        id: siteId,
        name: string(siteInput.name, "manifest.workloads.bootstrapSite.name"),
        hostname,
        path: sitePath,
        active: true,
        scanEnabled: true,
      };
      const businessNodeId = string(siteInput.businessNodeId, "manifest.workloads.bootstrapSite.businessNodeId");
      validateHierarchyConfiguration(nodes, [], [site], [{ nodeId: businessNodeId, siteId, active: true }]);
      for (const group of scopeGroups) {
        if (!nodes.some((node) => node.id === group.nodeId)) {
          throw new Error(`manifest.workloads.businessScope scope group references missing node: ${group.nodeId}`);
        }
      }
      businessScope = {
        nodes,
        memberUpns,
        reportAdminGroupDisplayName: displayNames[0],
        scopeGroups,
      };
    }

    workloads = {
      scanner: {
        scopeMode,
        allowedLibraryNames,
        reportableLabels,
        maxConcurrency,
        maxRetries,
        nightlySchedule,
        reconciliationSchedule,
        schedulesDisabled: scannerInput.schedulesDisabled,
      },
      bootstrapSite: {
        id: siteId,
        name: string(siteInput.name, "manifest.workloads.bootstrapSite.name"),
        hostname,
        path: sitePath,
        businessNodeId: string(siteInput.businessNodeId, "manifest.workloads.bootstrapSite.businessNodeId"),
      },
      report: { allowedUpns, maxDetailSites },
      configurationAdmin: { allowedActors },
      ...(businessScope ? { businessScope } : {}),
    };
  }

  const rbacInput = object(root.rbac, "manifest.rbac");
  exactKeys(rbacInput, ["mode", "tableDataPrincipalId", "tableDataPrincipalType"], "manifest.rbac");
  const mode = string(rbacInput.mode, "manifest.rbac.mode");
  if (mode !== "admin-handoff" && mode !== "deploy") {
    throw new Error("manifest.rbac.mode must be admin-handoff or deploy");
  }
  const tableDataPrincipalId = rbacInput.tableDataPrincipalId === undefined
    ? undefined
    : string(rbacInput.tableDataPrincipalId, "manifest.rbac.tableDataPrincipalId");
  if (tableDataPrincipalId && !UUID.test(tableDataPrincipalId)) {
    throw new Error("manifest.rbac.tableDataPrincipalId must be a UUID");
  }
  const tableDataPrincipalType = rbacInput.tableDataPrincipalType === undefined
    ? undefined
    : string(rbacInput.tableDataPrincipalType, "manifest.rbac.tableDataPrincipalType");
  if (tableDataPrincipalType && tableDataPrincipalType !== "User" && tableDataPrincipalType !== "ServicePrincipal") {
    throw new Error("manifest.rbac.tableDataPrincipalType must be User or ServicePrincipal");
  }
  if (mode === "deploy" && (!tableDataPrincipalId || !tableDataPrincipalType)) {
    throw new Error("manifest.rbac deploy mode requires tableDataPrincipalId and tableDataPrincipalType");
  }

  const tagsInput = object(root.tags, "manifest.tags");
  const tags = Object.fromEntries(Object.entries(tagsInput).map(([key, value]) => {
    if (!TAG_KEY.test(key)) throw new Error(`manifest.tags contains invalid key: ${key}`);
    const tagValue = string(value, `manifest.tags.${key}`);
    if (tagValue.length > 256) throw new Error(`manifest.tags.${key} exceeds 256 characters`);
    return [key, tagValue];
  }));
  if (!Object.keys(tags).length) throw new Error("manifest.tags must contain at least one tag");

  return {
    schemaVersion: CUSTOMER_DELIVERY_SCHEMA_VERSION,
    deploymentName,
    tenantId,
    subscriptionId,
    location,
    resourceGroupName,
    storageAccountName,
    entra: { webAppDisplayName, scannerAppDisplayName, webRedirectUris },
    ...(workloads ? { workloads } : {}),
    rbac: {
      mode,
      ...(tableDataPrincipalId ? { tableDataPrincipalId } : {}),
      ...(tableDataPrincipalType ? { tableDataPrincipalType: tableDataPrincipalType as "User" | "ServicePrincipal" } : {}),
    },
    tags,
  };
}

function stringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || !value.length) throw new Error(`${path} must be a non-empty array`);
  const result = value.map((item, index) => string(item, `${path}[${index}]`));
  if (new Set(result.map((item) => item.toLowerCase())).size !== result.length) throw new Error(`${path} contains duplicates`);
  return result;
}

function boundedInteger(value: unknown, path: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new Error(`${path} must be an integer from ${minimum} to ${maximum}`);
  }
  return Number(value);
}

function validateUpn(value: string): string {
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) throw new Error(`Invalid UPN: ${value}`);
  return value.toLowerCase();
}

export function loadCustomerDeliveryManifest(path: string): CustomerDeliveryManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read delivery manifest ${path}`, { cause: error });
  }
  return parseCustomerDeliveryManifest(parsed);
}
