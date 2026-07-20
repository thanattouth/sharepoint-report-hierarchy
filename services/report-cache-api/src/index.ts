import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from "@azure/functions";
import {
  loadReportApiConfig,
  parseReportApiRequest,
  ReportApiRequestError,
} from "../../../src/report/api-config";
import { loadReportCacheConfig } from "../../../src/report/cache-config";
import {
  buildReport,
  ReportAuthorizationError,
} from "../../../src/report/report-service";
import { loadReportSource } from "../../../src/report/report-source";

const responseHeaders = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
};

function json(status: number, body: unknown): HttpResponseInit {
  return { status, jsonBody: body, headers: responseHeaders };
}

export async function reportHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    const apiConfig = loadReportApiConfig(process.env);
    const cacheConfig = loadReportCacheConfig(process.env);
    if (cacheConfig.mode !== "azure-table") {
      throw new Error("The report API requires Azure Table cache mode");
    }
    const reportRequest = parseReportApiRequest(request.url, apiConfig, request.headers);
    const report = buildReport(
      await loadReportSource(reportRequest, cacheConfig),
      reportRequest,
    );
    context.log({
      event: "report-cache-read",
      state: report.state,
      siteCount: report.siteCount,
      sensitiveCount: report.scopeSensitiveCount,
      rowCount: report.rows.length,
    });
    return json(200, report);
  } catch (error) {
    if (error instanceof ReportApiRequestError) {
      return json(400, { error: "invalid-request" });
    }
    if (error instanceof ReportAuthorizationError) {
      return json(403, { error: "scope-denied" });
    }
    context.error({
      event: "report-cache-unavailable",
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return json(503, { error: "cache-unavailable" });
  }
}

export async function healthHandler(): Promise<HttpResponseInit> {
  try {
    const apiConfig = loadReportApiConfig(process.env);
    const cacheConfig = loadReportCacheConfig(process.env);
    if (cacheConfig.mode !== "azure-table") throw new Error("Azure cache mode is required");
    return json(200, {
      status: "configured",
      cacheMode: cacheConfig.mode,
      allowedPilotPersonaCount: apiConfig.allowedPilotUpns.size,
    });
  } catch {
    return json(503, { status: "unavailable" });
  }
}

app.http("report", {
  methods: ["GET"],
  authLevel: "function",
  route: "report",
  handler: reportHandler,
});

app.http("health", {
  methods: ["GET"],
  authLevel: "function",
  route: "health",
  handler: healthHandler,
});
