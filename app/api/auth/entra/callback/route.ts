import {
  completeEntraAuthorizationRequest,
  EntraAuthorizationError,
} from "@/src/auth/entra";
import { clearCookie, ENTRA_FLOW_COOKIE } from "@/src/auth/session";

export async function GET(request: Request) {
  const secure = new URL(request.url).protocol === "https:";
  try {
    const authorization = await completeEntraAuthorizationRequest(request);
    const response = new Response(null, {
      status: 302,
      headers: { Location: authorization.returnUrl.toString() },
    });
    response.headers.append("Set-Cookie", authorization.cookie);
    response.headers.append("Set-Cookie", clearCookie(ENTRA_FLOW_COOKIE, secure));
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    console.error({
      event: "entra-login-callback-failed",
      errorType: error instanceof Error ? error.name : "UnknownError",
      errorMessage: error instanceof Error ? error.message.slice(0, 200) : "Unknown Entra callback error",
    });
    const code = error instanceof EntraAuthorizationError
      ? error.code
      : "entra-authentication-failed";
    const response = new Response(null, {
      status: 302,
      headers: {
        Location: new URL(`/auth/denied?reason=${encodeURIComponent(code)}`, request.url).toString(),
      },
    });
    response.headers.append("Set-Cookie", clearCookie(ENTRA_FLOW_COOKIE, secure));
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
}
