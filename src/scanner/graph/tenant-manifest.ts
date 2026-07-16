import type { GovernedSharePointSite } from "../../domain/types";
import type { SiteStore } from "../../stores/contracts";
import { mapWithConcurrency } from "../bounded-concurrency";
import { GraphClient, GraphRequestError } from "./graph-client";

type GraphSite = {
  id: string;
  displayName?: string;
  webUrl?: string;
};

type GraphSitePage = {
  value: GraphSite[];
  "@odata.nextLink"?: string;
};

type GraphDrivePage = {
  value: Array<{ id: string; driveType?: string }>;
  "@odata.nextLink"?: string;
};

type ManifestFailure = {
  status: number;
  code: string;
};

type ReadableSite = {
  site: Omit<GovernedSharePointSite, "active" | "scanEnabled" | "baselineWave">;
  libraryCount: number;
};

export type TenantCandidateManifestResult = {
  discoveredSiteCount: number;
  pageCount: number;
  duplicateSiteCount: number;
  readableSiteCount: number;
  libraryCount: number;
  candidateSiteCount: number;
  candidateLibraryCount: number;
  savedCandidateCount: number;
  existingCandidateCount: number;
  preservedPilotCount: number;
  siteWithoutLibrariesCount: number;
  failedSiteCount: number;
  waveCount: number;
  status: "complete" | "partial";
  failureCounts: Array<{ status: number; code: string; count: number }>;
};

function validateBoundedInteger(name: string, value: number, maximum: number) {
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} must be an integer from 1 to ${maximum}`);
  }
}

function parseSite(site: GraphSite) {
  if (!site.id || !site.displayName?.trim() || !site.webUrl) {
    throw new Error("Microsoft Graph returned incomplete Site manifest metadata");
  }
  const url = new URL(site.webUrl);
  if (url.protocol !== "https:" || !url.hostname.toLowerCase().endsWith(".sharepoint.com")) {
    throw new Error("Microsoft Graph returned an invalid SharePoint Site URL");
  }
  return {
    id: site.id,
    name: site.displayName.trim(),
    hostname: url.hostname,
    path: url.pathname || "/",
  };
}

function failure(error: unknown): ManifestFailure {
  return {
    status: error instanceof GraphRequestError ? error.status : 0,
    code: error instanceof GraphRequestError ? error.code : "INVALID_SITE_METADATA",
  };
}

function aggregateFailures(failures: ManifestFailure[]) {
  const counts = new Map<string, ManifestFailure & { count: number }>();
  for (const item of failures) {
    const key = `${item.status}:${item.code}`;
    const current = counts.get(key) ?? { ...item, count: 0 };
    current.count += 1;
    counts.set(key, current);
  }
  return [...counts.values()].sort((left, right) =>
    left.status - right.status || left.code.localeCompare(right.code),
  );
}

function sameIds(left: string[] | undefined, right: string[]) {
  if (!left || left.length !== right.length) return false;
  const expected = new Set(right);
  return left.every((id) => expected.has(id));
}

export async function buildTenantCandidateManifest(input: {
  graph: GraphClient;
  siteStore: SiteStore;
  pilotSiteId: string;
  maxSitePages?: number;
  maxLibraryPagesPerSite?: number;
  maxSitesPerWave?: number;
  maxCandidates?: number;
  maxConcurrency?: number;
}): Promise<TenantCandidateManifestResult> {
  const maxSitePages = input.maxSitePages ?? 100;
  const maxLibraryPagesPerSite = input.maxLibraryPagesPerSite ?? 20;
  const maxSitesPerWave = input.maxSitesPerWave ?? 10;
  const maxCandidates = input.maxCandidates ?? 2_000;
  validateBoundedInteger("Manifest Site page ceiling", maxSitePages, 1_000);
  validateBoundedInteger("Manifest library page ceiling", maxLibraryPagesPerSite, 100);
  validateBoundedInteger("Manifest Sites per wave", maxSitesPerWave, 10);
  validateBoundedInteger("Manifest candidate ceiling", maxCandidates, 10_000);

  const discovered = new Map<string, GraphSite>();
  let itemCount = 0;
  let pageCount = 0;
  let next: string | undefined = "/sites/getAllSites?$select=id,displayName,webUrl";
  while (next) {
    if (pageCount >= maxSitePages) throw new Error("Manifest Site discovery exceeded its page ceiling");
    const page: GraphSitePage = await input.graph.request(next);
    if (!Array.isArray(page.value) || page.value.some((site) => !site?.id)) {
      throw new Error("Microsoft Graph returned an invalid Site manifest page");
    }
    pageCount += 1;
    itemCount += page.value.length;
    for (const site of page.value) discovered.set(site.id, site);
    next = page["@odata.nextLink"];
  }

  const siteResults = await mapWithConcurrency(
    [...discovered.values()],
    input.maxConcurrency ?? 4,
    async (graphSite): Promise<{ readable?: ReadableSite; noLibraries?: true; failure?: ManifestFailure }> => {
      try {
        const site = parseSite(graphSite);
        const driveIds = new Set<string>();
        let drivePageCount = 0;
        let driveNext: string | undefined = `/sites/${encodeURIComponent(site.id)}/drives?$select=id,driveType`;
        while (driveNext) {
          if (drivePageCount >= maxLibraryPagesPerSite) {
            throw new Error("Manifest library discovery exceeded its per-Site page ceiling");
          }
          const page: GraphDrivePage = await input.graph.request(driveNext);
          if (!Array.isArray(page.value) || page.value.some((drive) => !drive?.id)) {
            throw new Error("Microsoft Graph returned an invalid manifest library page");
          }
          for (const drive of page.value) {
            if (!drive.driveType || drive.driveType === "documentLibrary") driveIds.add(drive.id);
          }
          drivePageCount += 1;
          driveNext = page["@odata.nextLink"];
        }
        if (driveIds.size === 0) return { noLibraries: true };
        return {
          readable: {
            site: { ...site, scanLibraryIds: [...driveIds].sort() },
            libraryCount: driveIds.size,
          },
        };
      } catch (error) {
        return { failure: failure(error) };
      }
    },
  );
  const readable = siteResults.flatMap((result) => result.readable ? [result.readable] : []);
  const failures = siteResults.flatMap((result) => result.failure ? [result.failure] : []);
  const candidates = readable
    .filter((entry) => entry.site.id !== input.pilotSiteId)
    .sort((left, right) => left.site.id.localeCompare(right.site.id));
  if (candidates.length > maxCandidates) throw new Error("Manifest exceeded its candidate ceiling");

  const desiredCandidates = candidates.map((entry, index) => ({
    ...entry,
    target: {
      ...entry.site,
      active: false,
      scanEnabled: false,
      baselineWave: Math.floor(index / maxSitesPerWave) + 1,
      baselineState: "candidate",
    } satisfies GovernedSharePointSite,
  }));
  const existing = await mapWithConcurrency(
    readable,
    input.maxConcurrency ?? 4,
    async (entry) => ({ entry, current: await input.siteStore.get(entry.site.id) }),
  );
  const pilot = existing.find(({ entry }) => entry.site.id === input.pilotSiteId);
  if (!pilot?.current?.active || !pilot.current.scanEnabled) {
    throw new Error("The existing pilot Site is missing, inactive or scan-disabled");
  }

  let existingCandidateCount = 0;
  const toSave: GovernedSharePointSite[] = [];
  for (const desired of desiredCandidates) {
    const current = existing.find(({ entry }) => entry.site.id === desired.site.id)?.current;
    if (!current) {
      toSave.push(desired.target);
      continue;
    }
    if (current.active
      || current.scanEnabled
      || current.baselineWave !== desired.target.baselineWave
      || !sameIds(current.scanLibraryIds, desired.target.scanLibraryIds ?? [])
      || (current.baselineState !== undefined && current.baselineState !== "candidate")) {
      throw new Error("An existing candidate Site conflicts with the approved disabled manifest");
    }
    if (current.baselineState === undefined) {
      toSave.push(desired.target);
      continue;
    }
    existingCandidateCount += 1;
  }
  for (const target of toSave) await input.siteStore.save(target);

  return {
    discoveredSiteCount: discovered.size,
    pageCount,
    duplicateSiteCount: itemCount - discovered.size,
    readableSiteCount: readable.length,
    libraryCount: readable.reduce((sum, entry) => sum + entry.libraryCount, 0),
    candidateSiteCount: desiredCandidates.length,
    candidateLibraryCount: desiredCandidates.reduce((sum, entry) => sum + entry.libraryCount, 0),
    savedCandidateCount: toSave.length,
    existingCandidateCount,
    preservedPilotCount: 1,
    siteWithoutLibrariesCount: siteResults.filter((result) => result.noLibraries).length,
    failedSiteCount: failures.length,
    waveCount: Math.ceil(desiredCandidates.length / maxSitesPerWave),
    status: failures.length > 0 ? "partial" : "complete",
    failureCounts: aggregateFailures(failures),
  };
}
