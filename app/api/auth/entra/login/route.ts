import { createEntraAuthorizationRequest } from "@/src/auth/entra";

export async function GET(request: Request) {
  try {
    const authorization = await createEntraAuthorizationRequest(request);
    const response = Response.redirect(authorization.authorizationUrl, 302);
    response.headers.append("Set-Cookie", authorization.cookie);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    console.error({
      event: "entra-login-start-failed",
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return Response.json(
      { error: "entra-authentication-unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
