import assert from "node:assert/strict";
import test from "node:test";
import type { GovernedSharePointSite } from "../src/domain/types";
import type { GraphClient } from "../src/scanner/graph/graph-client";
import { reviewBaselineWave } from "../src/scanner/graph/wave-review";
import type { SiteStore } from "../src/stores/contracts";

class MemorySiteStore implements SiteStore {
  constructor(readonly sites: GovernedSharePointSite[]) {}
  async get(siteId: string) { return structuredClone(this.sites.find((site) => site.id === siteId) ?? null); }
  async listActive() { return structuredClone(this.sites.filter((site) => site.active)); }
  async listScanEnabled() { return structuredClone(this.sites.filter((site) => site.active && site.scanEnabled)); }
  async listByBaselineWave(wave: number) { return structuredClone(this.sites.filter((site) => site.baselineWave === wave)); }
  async save() {}
}

function candidate(id: string): GovernedSharePointSite {
  return {
    id,
    name: `Site ${id}`,
    hostname: "contoso.sharepoint.com",
    path: `/sites/${id}`,
    active: false,
    scanEnabled: false,
    scanLibraryIds: [`drive-${id}`],
    baselineWave: 1,
  };
}

test("Wave 1 review resolves names only for exact persisted drive IDs without file access", async () => {
  const requests: string[] = [];
  const graph = {
    async request(path: string) {
      requests.push(path);
      const id = path.includes("site-a") ? "site-a" : "site-b";
      return { value: [
        { id: `drive-${id}`, name: `Library ${id}`, webUrl: `https://contoso.sharepoint.com/sites/${id}/library`, driveType: "documentLibrary" },
        { id: `extra-${id}`, name: "Not approved", driveType: "documentLibrary" },
      ] };
    },
  } as unknown as GraphClient;
  const result = await reviewBaselineWave({
    graph,
    siteStore: new MemorySiteStore([candidate("site-b"), candidate("site-a")]),
    wave: 1,
  });

  assert.equal(result.siteCount, 2);
  assert.equal(result.libraryCount, 2);
  assert.deepEqual(result.sites.map((site) => site.siteId), ["site-a", "site-b"]);
  assert.ok(result.sites.every((site) => site.libraries.length === 1));
  assert.equal(JSON.stringify(result).includes("Not approved"), false);
  assert.equal(requests.some((path) => /delta|extractSensitivityLabels/.test(path)), false);
});

test("Wave 1 review rejects an active candidate before Graph access", async () => {
  let requested = false;
  await assert.rejects(
    () => reviewBaselineWave({
      graph: { async request() { requested = true; return {}; } } as unknown as GraphClient,
      siteStore: new MemorySiteStore([{ ...candidate("unsafe"), active: true }]),
      wave: 1,
    }),
    /not a disabled candidate/,
  );
  assert.equal(requested, false);
});
