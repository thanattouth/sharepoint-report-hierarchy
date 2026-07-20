import {
  applySiteMappingChangesFromApi,
  loadConfigurationAdminBridgeConfig,
} from "@/src/configuration/admin-bridge";
import { parseMappingChanges } from "@/src/configuration/api-config";
import {
  authorizeReportAdminRequest,
  entraAuthorizationFailure,
} from "@/src/auth/http";

const responseHeaders = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

export async function POST(request: Request) {
  try {
    const administrator = await authorizeReportAdminRequest(request, { mutation: true });
    const body = await request.json() as Record<string, unknown>;
    const targetNodeId = typeof body.targetNodeId === "string" ? body.targetNodeId.trim() : "";
    if (!targetNodeId || targetNodeId.length > 256) throw new Error("targetNodeId is invalid");
    const result = await applySiteMappingChangesFromApi(
      loadConfigurationAdminBridgeConfig(process.env),
      administrator.userPrincipalName,
      { targetNodeId, changes: parseMappingChanges(body.changes) },
    );
    return Response.json(result, { headers: responseHeaders });
  } catch (error) {
    const authorizationFailure = entraAuthorizationFailure(error);
    if (authorizationFailure) return authorizationFailure;
    console.error({
      event: "configuration-admin-bridge-apply-failed",
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    const message = error instanceof Error ? error.message : "";
    const conflict = message.includes("refresh and preview again");
    const invalidRequest = /invalid|required|1-100/.test(message);
    return Response.json(
      { error: conflict ? "site-mapping-version-conflict" : invalidRequest ? "invalid-apply-request" : "configuration-apply-unavailable" },
      { status: conflict ? 409 : invalidRequest ? 400 : 503, headers: responseHeaders },
    );
  }
}
