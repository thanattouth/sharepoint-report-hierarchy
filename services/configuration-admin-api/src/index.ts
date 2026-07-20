import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from "@azure/functions";
import {
  authorizeConfigurationActor,
  loadConfigurationAdminApiConfig,
  parseMappingChanges,
} from "../../../src/configuration/api-config";
import {
  applySiteMappingChanges,
  buildSiteMappingInbox,
  hierarchyBreadcrumb,
  previewSiteMappingChange,
  querySiteMappingInbox,
  type SiteMappingInboxStatus,
} from "../../../src/configuration/site-mapping";
import { createAzureTableCredential } from "../../../src/stores/azure-table/auth";
import { loadAzureTableStoreConfig } from "../../../src/stores/azure-table/config";
import { createAzureTableStores } from "../../../src/stores/azure-table/stores";

const headers = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
};

function json(status: number, body: unknown): HttpResponseInit {
  return { status, jsonBody: body, headers };
}

async function contextFor(request: HttpRequest) {
  const api = loadConfigurationAdminApiConfig(process.env);
  const actor = authorizeConfigurationActor(request.headers.get("x-configuration-actor"), api);
  const table = loadAzureTableStoreConfig(process.env);
  const stores = createAzureTableStores({
    config: table,
    credential: createAzureTableCredential(table.auth),
    tenantId: api.cacheTenantId,
  });
  const [nodes, assignments, sites, mappings] = await Promise.all([
    stores.hierarchyNodeStore.listAll(),
    stores.scopeAssignmentStore.listAll(),
    stores.siteStore.listAll(),
    stores.siteMappingStore.listAll(),
  ]);
  if (nodes.length === 0) throw new Error("Persistent hierarchy contains no nodes");
  return { actor, stores, nodes, assignments, sites, mappings };
}

export async function inboxHandler(request: HttpRequest, context: InvocationContext) {
  try {
    const source = await contextFor(request);
    const params = new URL(request.url).searchParams;
    const status = params.get("status") ?? "all";
    if (!["all", "mapped", "unmapped", "inactive"].includes(status)) {
      return json(400, { error: "invalid-inbox-status" });
    }
    const query = params.get("q")?.trim() ?? "";
    if (query.length > 200) return json(400, { error: "inbox-query-too-long" });
    const page = Number(params.get("page") ?? "1");
    const pageSize = Number(params.get("pageSize") ?? "25");
    if (!Number.isInteger(page) || page < 1 || page > 100_000
      || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) {
      return json(400, { error: "invalid-inbox-pagination" });
    }
    const result = querySiteMappingInbox(
      buildSiteMappingInbox(source.sites, source.nodes, source.mappings),
      { status: status as SiteMappingInboxStatus, query, page, pageSize },
    );
    const nodes = source.nodes.filter((node) => node.active).map((node) => ({
      id: node.id,
      type: node.type,
      name: node.name,
      breadcrumb: hierarchyBreadcrumb(node.id, source.nodes),
    }));
    return json(200, { ...result, nodes });
  } catch (error) {
    context.error({ event: "configuration-inbox-failed", errorType: error instanceof Error ? error.name : "UnknownError" });
    return json(error instanceof Error && error.message.includes("denied") ? 403 : 503, { error: "configuration-unavailable" });
  }
}

async function readBody(request: HttpRequest) {
  const body = await request.json() as Record<string, unknown>;
  const targetNodeId = typeof body.targetNodeId === "string" ? body.targetNodeId.trim() : "";
  if (!targetNodeId) throw new Error("targetNodeId is required");
  return { body, targetNodeId, changes: parseMappingChanges(body.changes) };
}

export async function previewHandler(request: HttpRequest, context: InvocationContext) {
  try {
    const [source, input] = await Promise.all([contextFor(request), readBody(request)]);
    return json(200, previewSiteMappingChange({
      changes: input.changes,
      targetNodeId: input.targetNodeId,
      nodes: source.nodes,
      sites: source.sites,
      mappings: source.mappings,
      assignments: source.assignments,
    }));
  } catch (error) {
    context.error({ event: "configuration-preview-failed", errorType: error instanceof Error ? error.name : "UnknownError" });
    return json(error instanceof Error && error.message.includes("denied") ? 403 : 400, { error: "invalid-configuration-change" });
  }
}

export async function applyHandler(request: HttpRequest, context: InvocationContext) {
  try {
    const [source, input] = await Promise.all([contextFor(request), readBody(request)]);
    if (input.body.confirm !== true) return json(400, { error: "preview-confirmation-required" });
    previewSiteMappingChange({
      changes: input.changes,
      targetNodeId: input.targetNodeId,
      nodes: source.nodes,
      sites: source.sites,
      mappings: source.mappings,
      assignments: source.assignments,
    });
    const saved = await applySiteMappingChanges({
      changes: input.changes,
      targetNodeId: input.targetNodeId,
      actor: source.actor,
      nodes: source.nodes,
      mappingStore: source.stores.siteMappingStore,
      auditStore: source.stores.siteMappingAuditStore,
    });
    context.log({ event: "configuration-site-mappings-applied", siteCount: saved.length });
    return json(200, { status: "applied", siteCount: saved.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    context.error({ event: "configuration-apply-failed", errorType: error instanceof Error ? error.name : "UnknownError" });
    return json(message.includes("denied") ? 403 : message.includes("version conflict") ? 409 : 400, { error: "configuration-change-rejected" });
  }
}

app.http("configuration-inbox", { methods: ["GET"], authLevel: "function", route: "configuration/site-mappings", handler: inboxHandler });
app.http("configuration-preview", { methods: ["POST"], authLevel: "function", route: "configuration/site-mappings/preview", handler: previewHandler });
app.http("configuration-apply", { methods: ["POST"], authLevel: "function", route: "configuration/site-mappings/apply", handler: applyHandler });
