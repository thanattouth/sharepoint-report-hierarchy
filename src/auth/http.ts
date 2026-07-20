import { EntraAuthorizationError, requireReportAdmin } from "./entra";
import { loadEntraAuthConfig, validateMutationOrigin } from "./entra-config";

export async function authorizeReportAdminRequest(
  request: Request,
  input: { mutation?: boolean } = {},
) {
  const config = loadEntraAuthConfig(process.env);
  if (input.mutation) validateMutationOrigin(request, config);
  return requireReportAdmin(request.headers.get("cookie"));
}

export function entraAuthorizationFailure(error: unknown) {
  if (!(error instanceof EntraAuthorizationError)) return null;
  return Response.json(
    { error: error.code },
    {
      status: error.status,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
