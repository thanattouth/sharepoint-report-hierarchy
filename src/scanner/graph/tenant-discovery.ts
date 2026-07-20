import { GraphClient, GraphRequestError } from "./graph-client";
import { mapWithConcurrency } from "../bounded-concurrency";

type GraphSite = {
  id: string;
};

type GraphSitePage = {
  value: GraphSite[];
  "@odata.nextLink"?: string;
};

type GraphDrivePage = {
  value: Array<{ id: string; driveType?: string }>;
  "@odata.nextLink"?: string;
};

type GraphDriveItem = {
  id: string;
  file?: Record<string, unknown>;
  folder?: Record<string, unknown>;
  deleted?: Record<string, unknown>;
};

type GraphDriveItemPage = {
  value: GraphDriveItem[];
  "@odata.nextLink"?: string;
  "@odata.deltaLink"?: string;
};

export type TenantSiteDiscoveryResult = {
  siteCount: number;
  pageCount: number;
  duplicateCount: number;
  libraryCount: number;
  libraryPageCount: number;
  sitesWithLibraries: number;
  sitesWithoutLibraries: number;
  failedSiteCount: number;
  status: "complete" | "partial";
  failureCounts: Array<{
    status: number;
    code: string;
    count: number;
  }>;
};

export type TenantFileCountResult = {
  siteCount: number;
  libraryCount: number;
  countedLibraryCount: number;
  fileCount: number;
  itemPageCount: number;
  failedSiteCount: number;
  failedLibraryCount: number;
  status: "complete" | "partial";
  failureCounts: Array<{
    stage: "site-libraries" | "library-items";
    status: number;
    code: string;
    count: number;
  }>;
};

type SiteEnumeration = {
  siteIds: string[];
  pageCount: number;
  duplicateCount: number;
};

type DiscoveryFailure = {
  stage: "site-libraries" | "library-items";
  status: number;
  code: string;
};

function validateBoundedInteger(name: string, value: number, maximum: number) {
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} must be an integer from 1 to ${maximum}`);
  }
}

function failureFrom(error: unknown, stage: DiscoveryFailure["stage"]): DiscoveryFailure {
  return {
    stage,
    status: error instanceof GraphRequestError ? error.status : 0,
    code: error instanceof GraphRequestError ? error.code : "DISCOVERY_ERROR",
  };
}

function aggregateFailures(failures: DiscoveryFailure[]) {
  const counts = new Map<string, DiscoveryFailure & { count: number }>();
  for (const failure of failures) {
    const key = `${failure.stage}:${failure.status}:${failure.code}`;
    const current = counts.get(key) ?? { ...failure, count: 0 };
    current.count += 1;
    counts.set(key, current);
  }
  return [...counts.values()].sort((left, right) =>
    left.stage.localeCompare(right.stage)
      || left.status - right.status
      || left.code.localeCompare(right.code),
  );
}

async function enumerateTenantSiteIds(input: {
  graph: GraphClient;
  maxPages: number;
}): Promise<SiteEnumeration> {
  const siteIds = new Set<string>();
  let itemCount = 0;
  let pageCount = 0;
  let next: string | undefined = "/sites/getAllSites?$select=id";

  while (next) {
    if (pageCount >= input.maxPages) {
      throw new Error("Tenant Site discovery exceeded the configured page ceiling");
    }
    const page: GraphSitePage = await input.graph.request(next);
    if (!Array.isArray(page.value) || page.value.some((site) => !site?.id)) {
      throw new Error("Microsoft Graph returned an invalid Site discovery page");
    }
    pageCount += 1;
    itemCount += page.value.length;
    for (const site of page.value) siteIds.add(site.id);
    next = page["@odata.nextLink"];
  }
  return {
    siteIds: [...siteIds],
    pageCount,
    duplicateCount: itemCount - siteIds.size,
  };
}

export async function discoverTenantSites(input: {
  graph: GraphClient;
  maxPages?: number;
  maxLibraryPagesPerSite?: number;
  maxConcurrency?: number;
}): Promise<TenantSiteDiscoveryResult> {
  const maxPages = input.maxPages ?? 100;
  validateBoundedInteger("Tenant Site discovery maxPages", maxPages, 1_000);
  const maxLibraryPagesPerSite = input.maxLibraryPagesPerSite ?? 20;
  validateBoundedInteger("Tenant library discovery max pages", maxLibraryPagesPerSite, 100);
  const sites = await enumerateTenantSiteIds({ graph: input.graph, maxPages });
  const libraryResults = await mapWithConcurrency(
    sites.siteIds,
    input.maxConcurrency ?? 4,
    async (siteId) => {
      const driveIds = new Set<string>();
      let libraryPageCount = 0;
      let next: string | undefined = `/sites/${encodeURIComponent(siteId)}/drives?$select=id,driveType`;
      try {
        while (next) {
          if (libraryPageCount >= maxLibraryPagesPerSite) {
            throw new Error("Tenant library discovery exceeded the per-Site page ceiling");
          }
          const page: GraphDrivePage = await input.graph.request(next);
          if (!Array.isArray(page.value) || page.value.some((drive) => !drive?.id)) {
            throw new Error("Microsoft Graph returned an invalid library discovery page");
          }
          for (const drive of page.value) {
            if (!drive.driveType || drive.driveType === "documentLibrary") driveIds.add(drive.id);
          }
          libraryPageCount += 1;
          next = page["@odata.nextLink"];
        }
        return { failed: false, libraryCount: driveIds.size, libraryPageCount };
      } catch (error) {
        return {
          failed: true,
          libraryCount: 0,
          libraryPageCount,
          status: error instanceof GraphRequestError ? error.status : 0,
          code: error instanceof GraphRequestError ? error.code : "DISCOVERY_ERROR",
        };
      }
    },
  );
  const failedSiteCount = libraryResults.filter((result) => result.failed).length;
  const successful = libraryResults.filter((result) => !result.failed);
  const failures = new Map<string, { status: number; code: string; count: number }>();
  for (const result of libraryResults) {
    if (!result.failed) continue;
    const failure = result as typeof result & { status: number; code: string };
    const key = `${failure.status}:${failure.code}`;
    const count = failures.get(key) ?? { status: failure.status, code: failure.code, count: 0 };
    count.count += 1;
    failures.set(key, count);
  }

  return {
    siteCount: sites.siteIds.length,
    pageCount: sites.pageCount,
    duplicateCount: sites.duplicateCount,
    libraryCount: successful.reduce((sum, result) => sum + result.libraryCount, 0),
    libraryPageCount: successful.reduce((sum, result) => sum + result.libraryPageCount, 0),
    sitesWithLibraries: successful.filter((result) => result.libraryCount > 0).length,
    sitesWithoutLibraries: successful.filter((result) => result.libraryCount === 0).length,
    failedSiteCount,
    status: failedSiteCount > 0 ? "partial" : "complete",
    failureCounts: [...failures.values()].sort((left, right) =>
      left.status - right.status || left.code.localeCompare(right.code),
    ),
  };
}

export async function countTenantFiles(input: {
  graph: GraphClient;
  maxSitePages?: number;
  maxLibraryPagesPerSite?: number;
  maxItemPagesPerLibrary?: number;
  maxConcurrency?: number;
}): Promise<TenantFileCountResult> {
  const maxSitePages = input.maxSitePages ?? 100;
  const maxLibraryPagesPerSite = input.maxLibraryPagesPerSite ?? 20;
  const maxItemPagesPerLibrary = input.maxItemPagesPerLibrary ?? 1_000;
  validateBoundedInteger("Tenant Site discovery maxPages", maxSitePages, 1_000);
  validateBoundedInteger("Tenant library discovery max pages", maxLibraryPagesPerSite, 100);
  validateBoundedInteger("Tenant file count max pages", maxItemPagesPerLibrary, 10_000);

  const sites = await enumerateTenantSiteIds({ graph: input.graph, maxPages: maxSitePages });
  const siteResults = await mapWithConcurrency(
    sites.siteIds,
    input.maxConcurrency ?? 4,
    async (siteId) => {
      const driveIds = new Set<string>();
      let pageCount = 0;
      let next: string | undefined = `/sites/${encodeURIComponent(siteId)}/drives?$select=id,driveType`;
      try {
        while (next) {
          if (pageCount >= maxLibraryPagesPerSite) {
            throw new Error("Tenant library discovery exceeded the per-Site page ceiling");
          }
          const page: GraphDrivePage = await input.graph.request(next);
          if (!Array.isArray(page.value) || page.value.some((drive) => !drive?.id)) {
            throw new Error("Microsoft Graph returned an invalid library discovery page");
          }
          for (const drive of page.value) {
            if (!drive.driveType || drive.driveType === "documentLibrary") driveIds.add(drive.id);
          }
          pageCount += 1;
          next = page["@odata.nextLink"];
        }
        return { driveIds: [...driveIds] };
      } catch (error) {
        return { driveIds: [], failure: failureFrom(error, "site-libraries") };
      }
    },
  );
  const driveIds = siteResults.flatMap((result) => result.driveIds);
  const siteFailures = siteResults.flatMap((result) => result.failure ? [result.failure] : []);

  const libraryResults = await mapWithConcurrency(
    driveIds,
    input.maxConcurrency ?? 4,
    async (driveId) => {
      const currentFiles = new Set<string>();
      let pageCount = 0;
      let next: string | undefined = `/drives/${encodeURIComponent(driveId)}/root/delta?$select=id,file,folder,deleted`;
      try {
        while (next) {
          if (pageCount >= maxItemPagesPerLibrary) {
            throw new Error("Tenant file count exceeded the per-library page ceiling");
          }
          const page: GraphDriveItemPage = await input.graph.request(next);
          if (!Array.isArray(page.value) || page.value.some((item) => !item?.id)) {
            throw new Error("Microsoft Graph returned an invalid file-count page");
          }
          for (const item of page.value) {
            if (item.deleted || item.folder || !item.file) currentFiles.delete(item.id);
            else currentFiles.add(item.id);
          }
          pageCount += 1;
          next = page["@odata.nextLink"];
        }
        return { fileCount: currentFiles.size, pageCount };
      } catch (error) {
        return {
          fileCount: 0,
          pageCount,
          failure: failureFrom(error, "library-items"),
        };
      }
    },
  );
  const libraryFailures = libraryResults.flatMap((result) => result.failure ? [result.failure] : []);
  const failures = [...siteFailures, ...libraryFailures];

  return {
    siteCount: sites.siteIds.length,
    libraryCount: driveIds.length,
    countedLibraryCount: libraryResults.length - libraryFailures.length,
    fileCount: libraryResults.reduce((sum, result) => sum + result.fileCount, 0),
    itemPageCount: libraryResults.reduce((sum, result) => sum + result.pageCount, 0),
    failedSiteCount: siteFailures.length,
    failedLibraryCount: libraryFailures.length,
    status: failures.length > 0 ? "partial" : "complete",
    failureCounts: aggregateFailures(failures),
  };
}
