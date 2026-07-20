const responseHeaders = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

export async function POST() {
  return Response.json(
    { error: "authenticated-administrator-required" },
    { status: 403, headers: responseHeaders },
  );
}
