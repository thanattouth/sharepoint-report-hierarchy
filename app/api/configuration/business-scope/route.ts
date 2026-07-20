import {
  fetchBusinessScope,
  loadConfigurationAdminBridgeConfig,
} from "@/src/configuration/admin-bridge";
import { authorizeReportAdminRequest, entraAuthorizationFailure } from "@/src/auth/http";

const responseHeaders = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

export async function GET(request: Request) {
  try {
    const administrator = await authorizeReportAdminRequest(request);
    const snapshot = await fetchBusinessScope(
      loadConfigurationAdminBridgeConfig(process.env),
      administrator.userPrincipalName,
    );
    return Response.json(snapshot, { headers: responseHeaders });
  } catch (error) {
    const authorizationFailure = entraAuthorizationFailure(error);
    if (authorizationFailure) return authorizationFailure;
    console.error({ event: "configuration-business-scope-bridge-failed", errorType: error instanceof Error ? error.name : "UnknownError" });
    return Response.json({ error: "configuration-admin-unavailable" }, { status: 503, headers: responseHeaders });
  }
}
