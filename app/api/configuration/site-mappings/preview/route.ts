import {
  fetchSiteMappingPreview,
  loadConfigurationAdminBridgeConfig,
} from "@/src/configuration/admin-bridge";
import { parseMappingChanges } from "@/src/configuration/api-config";

const responseHeaders = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const targetNodeId = typeof body.targetNodeId === "string" ? body.targetNodeId.trim() : "";
    if (!targetNodeId || targetNodeId.length > 256) throw new Error("targetNodeId is invalid");
    const preview = await fetchSiteMappingPreview(
      loadConfigurationAdminBridgeConfig(process.env),
      { targetNodeId, changes: parseMappingChanges(body.changes) },
    );
    return Response.json(preview, { headers: responseHeaders });
  } catch (error) {
    console.error({
      event: "configuration-admin-bridge-preview-failed",
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    const message = error instanceof Error ? error.message : "";
    const invalidRequest = /invalid|required|1-100/.test(message);
    return Response.json(
      { error: invalidRequest ? "invalid-preview-request" : "configuration-preview-unavailable" },
      { status: invalidRequest ? 400 : 503, headers: responseHeaders },
    );
  }
}
