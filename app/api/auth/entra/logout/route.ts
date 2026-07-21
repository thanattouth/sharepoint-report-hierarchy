import { clearCookie, ENTRA_FLOW_COOKIE, ENTRA_GRAPH_COOKIE, ENTRA_SESSION_COOKIE } from "@/src/auth/session";

function logout(request: Request) {
  const url = new URL(request.url);
  const response = new Response(null, {
    status: 303,
    headers: { Location: "/auth/signed-out" },
  });
  const secure = url.protocol === "https:";
  response.headers.append("Set-Cookie", clearCookie(ENTRA_SESSION_COOKIE, secure));
  response.headers.append("Set-Cookie", clearCookie(ENTRA_FLOW_COOKIE, secure));
  response.headers.append("Set-Cookie", clearCookie(ENTRA_GRAPH_COOKIE, secure));
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function POST(request: Request) {
  return logout(request);
}
