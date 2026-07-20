import { authorizeReportAdminRequest, entraAuthorizationFailure } from "@/src/auth/http";
import { fetchScopeAssignmentPreview, loadConfigurationAdminBridgeConfig } from "@/src/configuration/admin-bridge";
import { parseScopeAssignmentChange } from "@/src/configuration/api-config";

const responseHeaders = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

export async function POST(request: Request) {
  try {
    const administrator = await authorizeReportAdminRequest(request, { mutation: true });
    const body = await request.json() as Record<string, unknown>;
    const preview = await fetchScopeAssignmentPreview(
      loadConfigurationAdminBridgeConfig(process.env),
      administrator.userPrincipalName,
      parseScopeAssignmentChange(body.change),
    );
    return Response.json(preview, { headers: responseHeaders });
  } catch (error) {
    const authorizationFailure = entraAuthorizationFailure(error);
    if (authorizationFailure) return authorizationFailure;
    console.error({ event: "configuration-scope-assignment-preview-bridge-failed", errorType: error instanceof Error ? error.name : "UnknownError" });
    return Response.json({ error: "invalid-scope-assignment-change" }, { status: 400, headers: responseHeaders });
  }
}
