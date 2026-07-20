import { readEntraGraphCredential, requireReportAdmin } from "@/src/auth/entra";
import { EntraGroupSearchError, searchEntraSecurityGroups } from "@/src/auth/entra-groups";
import { entraAuthorizationFailure } from "@/src/auth/http";

const responseHeaders = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

export async function GET(request: Request) {
  try {
    const cookie = request.headers.get("cookie");
    await requireReportAdmin(cookie);
    const credential = await readEntraGraphCredential(cookie);
    if (!credential) {
      return Response.json(
        { error: "entra-group-picker-unavailable", reauthenticationRequired: true },
        { status: 503, headers: responseHeaders },
      );
    }
    const groups = await searchEntraSecurityGroups(
      new URL(request.url).searchParams.get("q") ?? "",
      credential.accessToken,
    );
    return Response.json({ groups }, { headers: responseHeaders });
  } catch (error) {
    const authorizationFailure = entraAuthorizationFailure(error);
    if (authorizationFailure) return authorizationFailure;
    if (error instanceof EntraGroupSearchError) {
      return Response.json(
        { error: error.status === 400 ? "invalid-group-search" : "entra-group-search-unavailable" },
        { status: error.status, headers: responseHeaders },
      );
    }
    console.error({
      event: "entra-group-search-failed",
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return Response.json({ error: "entra-group-search-unavailable" }, { status: 503, headers: responseHeaders });
  }
}
