import type { AzureApiReportCacheConfig } from "./cache-config";
import {
  ReportAuthorizationError,
  type ReportData,
  type ReportRequest,
} from "./report-service";

function setOptional(params: URLSearchParams, name: string, value?: string | number) {
  if (value !== undefined && value !== "") params.set(name, String(value));
}

function isReportData(value: unknown, expectedUpn: string, expectedCapability: ReportRequest["capability"]): value is ReportData {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ReportData>;
  const options = candidate.options as Partial<ReportData["options"]> | undefined;
  return candidate.userUpn === expectedUpn
    && candidate.capability === expectedCapability
    && ["ready", "no-assignment", "no-sites", "no-scan", "zero-sensitive"].includes(
      candidate.state ?? "",
    )
    && typeof candidate.scopeSensitiveCount === "number"
    && Array.isArray(candidate.allowedSiteIds)
    && Array.isArray(candidate.rows)
    && Array.isArray(candidate.siteRollups)
    && Array.isArray(candidate.hierarchyRollups)
    && Array.isArray(options?.nodes)
    && Array.isArray(options?.sites)
    && Array.isArray(options?.libraries)
    && Array.isArray(options?.labels);
}

export async function fetchReportFromApi(
  config: AzureApiReportCacheConfig,
  request: ReportRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<ReportData> {
  const url = new URL(`${config.baseUrl}/report`);
  const params = url.searchParams;
  setOptional(params, "node", request.filters.nodeId);
  setOptional(params, "site", request.filters.siteId);
  setOptional(params, "library", request.filters.library);
  setOptional(params, "label", request.filters.labelId);
  setOptional(params, "q", request.filters.search);
  setOptional(params, "status", request.filters.scanStatus);
  setOptional(params, "freshness", request.filters.freshness);
  setOptional(params, "page", request.filters.page);
  setOptional(params, "pageSize", request.filters.pageSize);

  const response = await fetchImpl(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "x-functions-key": config.functionKey,
      "x-report-tenant-id": request.principalContext?.tenantId ?? "",
      "x-report-user-upn": request.userUpn,
      "x-report-user-object-id": request.principalContext?.userObjectId ?? "",
      "x-report-group-object-ids": (request.principalContext?.groupObjectIds ?? []).join(","),
      "x-report-capability": request.capability,
    },
    // Workerd does not implement redirect="error". Manual mode preserves the
    // same security boundary: the Function key is never forwarded to another
    // origin, and every redirect is rejected below.
    redirect: "manual",
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  if (response.status >= 300 && response.status < 400) {
    throw new Error("Report API redirects are not allowed");
  }
  if (response.status === 401 || response.status === 403) {
    throw new ReportAuthorizationError();
  }
  if (!response.ok) throw new Error(`Report API returned HTTP ${response.status}`);
  const body: unknown = await response.json();
  if (!isReportData(body, request.userUpn, request.capability)) {
    throw new Error("Report API returned an invalid response");
  }
  return body;
}
