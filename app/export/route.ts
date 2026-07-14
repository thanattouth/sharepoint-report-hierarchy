import { buildScopedCsv } from "@/src/report/data-access";
import { ReportAuthorizationError } from "@/src/report/report-service";

export async function GET(request: Request) {
  const params = Object.fromEntries(new URL(request.url).searchParams.entries());
  try {
    const csv = await buildScopedCsv(params);
    return new Response(`\uFEFF${csv}`, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="secret-file-inventory.csv"',
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    const status = error instanceof ReportAuthorizationError ? 403 : 503;
    return Response.json({ error: "Export is not available for this scope" }, { status });
  }
}
