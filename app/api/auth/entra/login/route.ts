import { createEntraAuthorizationRequest } from "@/src/auth/entra";

export async function GET(request: Request) {
  try {
    const authorization = await createEntraAuthorizationRequest(request);
    return new Response(null, {
      status: 302,
      headers: {
        Location: authorization.authorizationUrl.toString(),
        "Set-Cookie": authorization.cookie,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error({
      event: "entra-login-start-failed",
      errorType: error instanceof Error ? error.name : "UnknownError",
      errorMessage: error instanceof Error ? error.message.slice(0, 200) : "Unknown Entra login error",
    });
    return Response.json(
      { error: "entra-authentication-unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
