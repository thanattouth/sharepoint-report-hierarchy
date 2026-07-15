import { queueAuthorizedRunNow } from "@/src/scanner/fixture-scanner";
import { getReportMode } from "@/src/report/data-access";

export async function POST(request: Request) {
  try {
    if (getReportMode() !== "fixture") {
      return Response.json({ error: "Run now is disabled for live cache modes" }, { status: 409 });
    }
    const body = (await request.json()) as { userUpn?: string; capability?: string };
    if (!body.userUpn) return Response.json({ error: "UPN is required" }, { status: 400 });
    const run = await queueAuthorizedRunNow({
      userUpn: body.userUpn,
      capability: body.capability === "ReportAdmin" ? "ReportAdmin" : "ReportViewer",
    });
    return Response.json({ runId: run.id, status: run.status }, { status: 202 });
  } catch {
    return Response.json({ error: "Run now is not authorized" }, { status: 403 });
  }
}
