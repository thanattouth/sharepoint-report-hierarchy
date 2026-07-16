import type { SiteStore } from "../../stores/contracts";
import { mapWithConcurrency } from "../bounded-concurrency";
import { GraphClient } from "./graph-client";

type GraphDrivePage = {
  value: Array<{
    id: string;
    name?: string;
    webUrl?: string;
    driveType?: string;
  }>;
  "@odata.nextLink"?: string;
};

export type BaselineWaveReview = {
  wave: number;
  siteCount: number;
  libraryCount: number;
  sites: Array<{
    siteId: string;
    siteName: string;
    siteUrl: string;
    libraries: Array<{
      driveId: string;
      libraryName: string;
      libraryUrl?: string;
    }>;
  }>;
};

export async function reviewBaselineWave(input: {
  graph: GraphClient;
  siteStore: SiteStore;
  wave: number;
  maxSites?: number;
  maxLibraryPagesPerSite?: number;
  maxConcurrency?: number;
}): Promise<BaselineWaveReview> {
  const maxSites = input.maxSites ?? 10;
  const maxLibraryPagesPerSite = input.maxLibraryPagesPerSite ?? 20;
  if (!Number.isInteger(input.wave) || input.wave < 1) {
    throw new Error("Baseline review wave must be a positive integer");
  }
  if (!Number.isInteger(maxSites) || maxSites < 1 || maxSites > 10) {
    throw new Error("Baseline review maxSites must be an integer from 1 to 10");
  }
  if (!Number.isInteger(maxLibraryPagesPerSite)
    || maxLibraryPagesPerSite < 1
    || maxLibraryPagesPerSite > 100) {
    throw new Error("Baseline review library page ceiling must be an integer from 1 to 100");
  }
  const targets = (await input.siteStore.listByBaselineWave(input.wave))
    .sort((left, right) => left.id.localeCompare(right.id));
  if (targets.length === 0 || targets.length > maxSites) {
    throw new Error("Baseline review wave is empty or exceeds its Site ceiling");
  }
  for (const target of targets) {
    if (target.active || target.scanEnabled || !target.scanLibraryIds?.length) {
      throw new Error("Baseline review target is not a disabled candidate with an exact allowlist");
    }
  }

  const sites = await mapWithConcurrency(
    targets,
    input.maxConcurrency ?? 4,
    async (target) => {
      const approvedIds = new Set(target.scanLibraryIds);
      const approved = new Map<string, { name: string; webUrl?: string }>();
      let pageCount = 0;
      let next: string | undefined = `/sites/${encodeURIComponent(target.id)}/drives?$select=id,name,webUrl,driveType`;
      while (next) {
        if (pageCount >= maxLibraryPagesPerSite) {
          throw new Error("Baseline review exceeded its per-Site library page ceiling");
        }
        const page: GraphDrivePage = await input.graph.request(next);
        if (!Array.isArray(page.value) || page.value.some((drive) => !drive?.id)) {
          throw new Error("Microsoft Graph returned an invalid baseline review page");
        }
        for (const drive of page.value) {
          if (!approvedIds.has(drive.id)) continue;
          if (drive.driveType && drive.driveType !== "documentLibrary") {
            throw new Error("An approved baseline drive is no longer a document library");
          }
          if (!drive.name?.trim()) throw new Error("An approved baseline library has no display name");
          approved.set(drive.id, { name: drive.name.trim(), webUrl: drive.webUrl });
        }
        pageCount += 1;
        next = page["@odata.nextLink"];
      }
      const missing = [...approvedIds].filter((driveId) => !approved.has(driveId));
      if (missing.length > 0) throw new Error("An approved baseline drive could not be resolved");
      return {
        siteId: target.id,
        siteName: target.name,
        siteUrl: `https://${target.hostname}${target.path}`,
        libraries: [...approved.entries()]
          .map(([driveId, library]) => ({
            driveId,
            libraryName: library.name,
            libraryUrl: library.webUrl,
          }))
          .sort((left, right) => left.libraryName.localeCompare(right.libraryName)
            || left.driveId.localeCompare(right.driveId)),
      };
    },
  );

  return {
    wave: input.wave,
    siteCount: sites.length,
    libraryCount: sites.reduce((sum, site) => sum + site.libraries.length, 0),
    sites,
  };
}
