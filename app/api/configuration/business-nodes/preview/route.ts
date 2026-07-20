import { authorizeReportAdminRequest, entraAuthorizationFailure } from "@/src/auth/http";
import { fetchBusinessNodePreview, loadConfigurationAdminBridgeConfig } from "@/src/configuration/admin-bridge";
import { parseBusinessNodeChange } from "@/src/configuration/api-config";

const responseHeaders = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

export async function POST(request: Request) {
  try {
    const administrator = await authorizeReportAdminRequest(request, { mutation: true });
    const body = await request.json() as Record<string, unknown>;
    const preview = await fetchBusinessNodePreview(
      loadConfigurationAdminBridgeConfig(process.env),
      administrator.userPrincipalName,
      parseBusinessNodeChange(body.change),
    );
    return Response.json(preview, { headers: responseHeaders });
  } catch (error) {
    const authorizationFailure = entraAuthorizationFailure(error);
    if (authorizationFailure) return authorizationFailure;
    console.error({ event: "configuration-business-node-preview-bridge-failed", errorType: error instanceof Error ? error.name : "UnknownError" });
    return Response.json({ error: "invalid-business-node-change" }, { status: 400, headers: responseHeaders });
  }
}
