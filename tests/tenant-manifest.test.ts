import assert from "node:assert/strict";
import test from "node:test";
import type { GovernedSharePointSite } from "../src/domain/types";
import type { GraphClient } from "../src/scanner/graph/graph-client";
import { GraphRequestError } from "../src/scanner/graph/graph-client";
import { buildTenantCandidateManifest } from "../src/scanner/graph/tenant-manifest";
import type { SiteStore } from "../src/stores/contracts";

const PILOT_ID = "contoso.sharepoint.com,pilot,web";

class MemorySiteStore implements SiteStore {
  values = new Map<string, GovernedSharePointSite>();
  async get(siteId: string) { return structuredClone(this.values.get(siteId) ?? null); }
  async listActive() { return structuredClone([...this.values.values()].filter((site) => site.active)); }
  async listScanEnabled() { return structuredClone([...this.values.values()].filter((site) => site.active && site.scanEnabled)); }
  async listByBaselineWave(wave: number) { return structuredClone([...this.values.values()].filter((site) => site.baselineWave === wave)); }
  async save(site: GovernedSharePointSite) { this.values.set(site.id, structuredClone(site)); }
}

test("candidate manifest persists only disabled readable Sites and preserves the pilot", async () => {
  const store = new MemorySiteStore();
  store.values.set(PILOT_ID, {
    id: PILOT_ID,
    name: "Pilot",
    hostname: "contoso.sharepoint.com",
    path: "/sites/pilot",
    active: true,
    scanEnabled: true,
  });
  const requests: string[] = [];
  const graph = {
    async request(path: string) {
      requests.push(path);
      if (path.includes("getAllSites")) {
        return { value: [
          { id: PILOT_ID, displayName: "Pilot", webUrl: "https://contoso.sharepoint.com/sites/pilot" },
          { id: "contoso.sharepoint.com,candidate,web", displayName: "Candidate", webUrl: "https://contoso.sharepoint.com/sites/candidate" },
          { id: "contoso.sharepoint.com,empty,web", displayName: "Empty", webUrl: "https://contoso.sharepoint.com/sites/empty" },
          { id: "contoso.sharepoint.com,blocked,web", displayName: "Blocked", webUrl: "https://contoso.sharepoint.com/sites/blocked" },
        ] };
      }
      if (path.includes("blocked")) throw new GraphRequestError("blocked", 423, "notAllowed");
      if (path.includes("empty")) return { value: [] };
      if (path.includes("candidate")) return { value: [{ id: "drive-candidate", driveType: "documentLibrary" }] };
      return { value: [{ id: "drive-pilot", driveType: "documentLibrary" }] };
    },
  } as unknown as GraphClient;

  const result = await buildTenantCandidateManifest({
    graph,
    siteStore: store,
    pilotSiteId: PILOT_ID,
    maxSitesPerWave: 10,
  });

  assert.deepEqual(result, {
    discoveredSiteCount: 4,
    pageCount: 1,
    duplicateSiteCount: 0,
    readableSiteCount: 2,
    libraryCount: 2,
    candidateSiteCount: 1,
    candidateLibraryCount: 1,
    savedCandidateCount: 1,
    existingCandidateCount: 0,
    preservedPilotCount: 1,
    siteWithoutLibrariesCount: 1,
    failedSiteCount: 1,
    waveCount: 1,
    status: "partial",
    failureCounts: [{ status: 423, code: "notAllowed", count: 1 }],
  });
  assert.deepEqual(store.values.get("contoso.sharepoint.com,candidate,web"), {
    id: "contoso.sharepoint.com,candidate,web",
    name: "Candidate",
    hostname: "contoso.sharepoint.com",
    path: "/sites/candidate",
    scanLibraryIds: ["drive-candidate"],
    active: false,
    scanEnabled: false,
    baselineWave: 1,
    baselineState: "candidate",
  });
  assert.equal(store.values.get(PILOT_ID)?.scanEnabled, true);
  assert.equal(requests.some((path) => /delta|extractSensitivityLabels/.test(path)), false);
  assert.equal(JSON.stringify(result).includes("contoso.sharepoint.com,candidate,web"), false);
});

test("candidate manifest is idempotent and rejects a conflicting active candidate", async () => {
  const store = new MemorySiteStore();
  store.values.set(PILOT_ID, {
    id: PILOT_ID,
    name: "Pilot",
    hostname: "contoso.sharepoint.com",
    path: "/sites/pilot",
    active: true,
    scanEnabled: true,
  });
  const graph = {
    async request(path: string) {
      if (path.includes("getAllSites")) return { value: [
        { id: PILOT_ID, displayName: "Pilot", webUrl: "https://contoso.sharepoint.com/sites/pilot" },
        { id: "contoso.sharepoint.com,candidate,web", displayName: "Candidate", webUrl: "https://contoso.sharepoint.com/sites/candidate" },
      ] };
      return { value: [{ id: path.includes("candidate") ? "drive-candidate" : "drive-pilot", driveType: "documentLibrary" }] };
    },
  } as unknown as GraphClient;
  await buildTenantCandidateManifest({ graph, siteStore: store, pilotSiteId: PILOT_ID });
  const repeated = await buildTenantCandidateManifest({ graph, siteStore: store, pilotSiteId: PILOT_ID });
  assert.equal(repeated.savedCandidateCount, 0);
  assert.equal(repeated.existingCandidateCount, 1);
  store.values.set("contoso.sharepoint.com,candidate,web", {
    ...store.values.get("contoso.sharepoint.com,candidate,web")!,
    active: true,
  });
  await assert.rejects(
    () => buildTenantCandidateManifest({ graph, siteStore: store, pilotSiteId: PILOT_ID }),
    /conflicts with the approved disabled manifest/,
  );
});
