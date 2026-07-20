import { spawnSync } from "node:child_process";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function azJson(args: string[]) {
  const result = spawnSync("az", [...args, "--only-show-errors", "--output", "json"], { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr.trim() || "Azure CLI command failed");
  return JSON.parse(result.stdout) as unknown;
}

function outputValue(outputs: unknown, name: string) {
  if (!outputs || typeof outputs !== "object") throw new Error("Deployment outputs are unavailable");
  const output = (outputs as Record<string, unknown>)[name];
  const value = output && typeof output === "object" && "value" in output
    ? (output as { value?: unknown }).value
    : undefined;
  if (typeof value !== "string" || !value) throw new Error(`Deployment output ${name} is unavailable`);
  return value;
}

const subscriptionId = required("P7_AZURE_SUBSCRIPTION_ID");
const resourceGroup = required("P7_AZURE_RESOURCE_GROUP");
const actor = required("CONFIG_ADMIN_ALLOWED_ACTORS").split(",")[0]?.trim();
if (!actor) throw new Error("CONFIG_ADMIN_ALLOWED_ACTORS has no actor");
const expectedMappedSiteCount = Number(process.env.P7_EXPECTED_MAPPED_SITE_COUNT ?? "8");
if (!Number.isInteger(expectedMappedSiteCount) || expectedMappedSiteCount < 0) {
  throw new Error("P7_EXPECTED_MAPPED_SITE_COUNT must be a non-negative integer");
}
const outputs = azJson([
  "deployment", "group", "show",
  "--subscription", subscriptionId,
  "--resource-group", resourceGroup,
  "--name", "p7-configuration-admin-api-v1",
  "--query", "properties.outputs",
]);
const functionAppName = outputValue(outputs, "functionAppName");
const hostname = outputValue(outputs, "functionAppHostname");
const keys = azJson([
  "functionapp", "keys", "list",
  "--subscription", subscriptionId,
  "--resource-group", resourceGroup,
  "--name", functionAppName,
]);
const functionKeys = keys && typeof keys === "object"
  ? (keys as { functionKeys?: unknown }).functionKeys
  : undefined;
const functionKey = functionKeys && typeof functionKeys === "object"
  ? Object.values(functionKeys as Record<string, unknown>)
    .find((value): value is string => typeof value === "string" && Boolean(value))
  : undefined;
if (!functionKey) throw new Error("Function key is unavailable");
const requestHeaders = {
  "x-functions-key": functionKey,
  "x-configuration-actor": actor,
  "content-type": "application/json",
};
type InboxPage = {
  rows?: Array<{ siteId?: string; siteName?: string; nodeId?: string; version?: number }>;
  nodes?: Array<{ id?: string }>;
  total?: number;
  page?: number;
  pageCount?: number;
};

async function fetchInboxPage(page: number): Promise<InboxPage> {
  const inboxResponse = await fetch(
    `https://${hostname}/api/configuration/site-mappings?status=all&page=${page}&pageSize=50`,
    { headers: requestHeaders, redirect: "manual" },
  );
  if (inboxResponse.status !== 200) {
    const diagnostic = (await inboxResponse.text()).slice(0, 200).replaceAll(/\s+/g, " ");
    throw new Error(`Configuration inbox returned HTTP ${inboxResponse.status}: ${diagnostic}`);
  }
  return inboxResponse.json() as Promise<InboxPage>;
}

const firstPage = await fetchInboxPage(1);
if (!Array.isArray(firstPage.rows) || !Array.isArray(firstPage.nodes)
  || firstPage.nodes.length !== 15 || !Number.isInteger(firstPage.total)
  || !Number.isInteger(firstPage.pageCount) || (firstPage.pageCount ?? 0) > 100) {
  throw new Error("Configuration inbox response is invalid");
}
const rows = [...firstPage.rows];
for (let page = 2; page <= (firstPage.pageCount ?? 1); page += 1) {
  const nextPage = await fetchInboxPage(page);
  if (!Array.isArray(nextPage.rows) || nextPage.total !== firstPage.total) {
    throw new Error("Configuration inbox pagination changed during verification");
  }
  rows.push(...nextPage.rows);
}
if (rows.length !== firstPage.total) throw new Error("Configuration inbox pagination is incomplete");
const mappedSiteCount = rows.filter((row) => Boolean(row.nodeId)).length;
if (mappedSiteCount !== expectedMappedSiteCount) {
  throw new Error("Configuration inbox canonical placement count is invalid");
}
let previewUnchanged: number | null = null;
const mapped = rows.find((row) => row.siteId && row.nodeId && Number.isInteger(row.version));
if (mapped?.siteId && mapped.nodeId && Number.isInteger(mapped.version)) {
  const previewResponse = await fetch(`https://${hostname}/api/configuration/site-mappings/preview`, {
    method: "POST",
    headers: requestHeaders,
    redirect: "manual",
    body: JSON.stringify({
      targetNodeId: mapped.nodeId,
      changes: [{ siteId: mapped.siteId, expectedVersion: mapped.version }],
    }),
  });
  if (previewResponse.status !== 200) throw new Error(`Configuration preview returned HTTP ${previewResponse.status}`);
  const preview = await previewResponse.json() as Record<string, unknown>;
  if (preview.selectedSiteCount !== 1 || preview.unchanged !== 1 || preview.moves !== 0) {
    throw new Error("Configuration preview response is invalid");
  }
  previewUnchanged = 1;
}
const businessScopeResponse = await fetch(
  `https://${hostname}/api/configuration/business-scope`,
  { headers: requestHeaders, redirect: "manual" },
);
if (businessScopeResponse.status !== 200) {
  throw new Error(`Business scope returned HTTP ${businessScopeResponse.status}`);
}
const businessScope = await businessScopeResponse.json() as {
  nodes?: Array<Record<string, unknown>>;
  assignments?: Array<Record<string, unknown>>;
  auditEvents?: unknown[];
  counts?: Record<string, unknown>;
};
if (!Array.isArray(businessScope.nodes)
  || businessScope.nodes.filter((node) => node.active === true).length !== 15
  || !businessScope.nodes.every((node) => typeof node.id === "string"
    && typeof node.name === "string"
    && typeof node.type === "string"
    && typeof node.active === "boolean"
    && Number.isInteger(node.version))
  || !Array.isArray(businessScope.assignments)
  || !businessScope.assignments.every((assignment) => typeof assignment.id === "string"
    && typeof assignment.nodeId === "string"
    && Number.isInteger(assignment.version))
  || !Array.isArray(businessScope.auditEvents)) {
  throw new Error("Business scope response is invalid");
}
const previewNode = businessScope.nodes.find((node) => node.active === true);
if (!previewNode) throw new Error("Business scope has no active node to preview");
const nodePreviewResponse = await fetch(`https://${hostname}/api/configuration/business-nodes/preview`, {
  method: "POST",
  headers: requestHeaders,
  redirect: "manual",
  body: JSON.stringify({
    change: {
      id: previewNode.id,
      expectedVersion: previewNode.version,
      type: previewNode.type,
      name: previewNode.name,
      parentId: previewNode.parentId,
      active: previewNode.active,
    },
  }),
});
if (nodePreviewResponse.status !== 200) {
  throw new Error(`Business node preview returned HTTP ${nodePreviewResponse.status}`);
}
const nodePreview = await nodePreviewResponse.json() as Record<string, unknown>;
if (nodePreview.entityType !== "HierarchyNode" || nodePreview.nextVersion !== Number(previewNode.version) + 1) {
  throw new Error("Business node preview response is invalid");
}
process.stdout.write(`${JSON.stringify({
  status: "verified-read-preview-only",
  inboxSiteCount: rows.length,
  mappedSiteCount,
  activeNodeCount: firstPage.nodes.length,
  assignmentCount: businessScope.assignments.length,
  configurationAuditEventCount: businessScope.auditEvents.length,
  businessNodePreview: true,
  previewUnchanged,
  expectedMappedSiteCount,
})}\n`);
