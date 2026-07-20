import { authorizeReportAdminRequest, entraAuthorizationFailure } from "@/src/auth/http";
import { applyBusinessNodeChangeFromApi, loadConfigurationAdminBridgeConfig } from "@/src/configuration/admin-bridge";
import { parseBusinessNodeChange } from "@/src/configuration/api-config";

const responseHeaders = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

export async function POST(request: Request) {
  try {
    const administrator = await authorizeReportAdminRequest(request, { mutation: true });
    const body = await request.json() as Record<string, unknown>;
    const result = await applyBusinessNodeChangeFromApi(
      loadConfigurationAdminBridgeConfig(process.env),
      administrator.userPrincipalName,
      parseBusinessNodeChange(body.change),
    );
    return Response.json(result, { headers: responseHeaders });
  } catch (error) {
    const authorizationFailure = entraAuthorizationFailure(error);
    if (authorizationFailure) return authorizationFailure;
    const conflict = error instanceof Error && error.message.includes("changed");
    console.error({ event: "configuration-business-node-apply-bridge-failed", errorType: error instanceof Error ? error.name : "UnknownError" });
    return Response.json({ error: conflict ? "configuration-version-conflict" : "business-node-change-rejected" }, { status: conflict ? 409 : 400, headers: responseHeaders });
  }
}
