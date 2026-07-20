import { authorizeReportAdminRequest, entraAuthorizationFailure } from "@/src/auth/http";
import { applyScopeAssignmentChangeFromApi, loadConfigurationAdminBridgeConfig } from "@/src/configuration/admin-bridge";
import { parseScopeAssignmentChange } from "@/src/configuration/api-config";

const responseHeaders = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

export async function POST(request: Request) {
  try {
    const administrator = await authorizeReportAdminRequest(request, { mutation: true });
    const body = await request.json() as Record<string, unknown>;
    const result = await applyScopeAssignmentChangeFromApi(
      loadConfigurationAdminBridgeConfig(process.env),
      administrator.userPrincipalName,
      parseScopeAssignmentChange(body.change),
    );
    return Response.json(result, { headers: responseHeaders });
  } catch (error) {
    const authorizationFailure = entraAuthorizationFailure(error);
    if (authorizationFailure) return authorizationFailure;
    const conflict = error instanceof Error && error.message.includes("changed");
    console.error({ event: "configuration-scope-assignment-apply-bridge-failed", errorType: error instanceof Error ? error.name : "UnknownError" });
    return Response.json({ error: conflict ? "configuration-version-conflict" : "scope-assignment-change-rejected" }, { status: conflict ? 409 : 400, headers: responseHeaders });
  }
}
