import {
  fetchSiteMappingInbox,
  loadConfigurationAdminBridgeConfig,
  parseSiteMappingInboxQuery,
} from "@/src/configuration/admin-bridge";
import {
  authorizeReportAdminRequest,
  entraAuthorizationFailure,
} from "@/src/auth/http";

const responseHeaders = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

export async function GET(request: Request) {
  try {
    const administrator = await authorizeReportAdminRequest(request);
    const query = parseSiteMappingInboxQuery(request.url);
    const inbox = await fetchSiteMappingInbox(
      loadConfigurationAdminBridgeConfig(process.env),
      administrator.userPrincipalName,
      query,
    );
    return Response.json(inbox, { headers: responseHeaders });
  } catch (error) {
    const authorizationFailure = entraAuthorizationFailure(error);
    if (authorizationFailure) return authorizationFailure;
    console.error({
      event: "configuration-admin-bridge-inbox-failed",
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    const message = error instanceof Error ? error.message : "";
    const invalidRequest = /invalid|too long|integer/.test(message);
    return Response.json(
      { error: invalidRequest ? "invalid-inbox-request" : "configuration-admin-unavailable" },
      { status: invalidRequest ? 400 : 503, headers: responseHeaders },
    );
  }
}
