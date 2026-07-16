import assert from "node:assert/strict";
import test from "node:test";
import { GraphClient } from "../src/scanner/graph/graph-client";
import {
  countTenantFiles,
  discoverTenantSites,
} from "../src/scanner/graph/tenant-discovery";

test("tenant discovery returns counts without exposing Site identities", async () => {
  const requests: string[] = [];
  const graph = {
    async request(path: string) {
      requests.push(path);
      if (path.includes("/drives?")) {
        return { value: path.includes("site-3") ? [] : [{ id: `drive-${path.length}`, driveType: "documentLibrary" }] };
      }
      if (!path.includes("skiptoken")) {
        return {
          value: [{ id: "site-1" }, { id: "site-2" }],
          "@odata.nextLink": "https://graph.microsoft.com/v1.0/sites/getAllSites?$skiptoken=opaque",
        };
      }
      return { value: [{ id: "site-2" }, { id: "site-3" }] };
    },
  } as unknown as GraphClient;

  const result = await discoverTenantSites({ graph, maxPages: 5 });

  assert.deepEqual(result, {
    siteCount: 3,
    pageCount: 2,
    duplicateCount: 1,
    libraryCount: 2,
    libraryPageCount: 3,
    sitesWithLibraries: 2,
    sitesWithoutLibraries: 1,
    failedSiteCount: 0,
    status: "complete",
    failureCounts: [],
  });
  assert.equal(JSON.stringify(result).includes("site-1"), false);
  assert.equal(requests.length, 5);
});

test("tenant discovery fails closed at its page ceiling", async () => {
  const graph = {
    async request() {
      return {
        value: [{ id: "site-1" }],
        "@odata.nextLink": "https://graph.microsoft.com/v1.0/sites/getAllSites?$skiptoken=loop",
      };
    },
  } as unknown as GraphClient;

  await assert.rejects(
    () => discoverTenantSites({ graph, maxPages: 1 }),
    /page ceiling/,
  );
});

test("tenant file count returns aggregate file facets without exposing item identities", async () => {
  const requests: string[] = [];
  const graph = {
    async request(path: string) {
      requests.push(path);
      if (path.includes("/root/delta?")) {
        return {
          value: [
            { id: "file-1", file: {} },
            { id: "folder-1", folder: {} },
            { id: "file-deleted", file: {}, deleted: {} },
          ],
        };
      }
      if (path.includes("/drives?")) {
        return { value: [{ id: "drive-1", driveType: "documentLibrary" }] };
      }
      return { value: [{ id: "site-1" }] };
    },
  } as unknown as GraphClient;

  const result = await countTenantFiles({ graph, maxConcurrency: 2 });

  assert.deepEqual(result, {
    siteCount: 1,
    libraryCount: 1,
    countedLibraryCount: 1,
    fileCount: 1,
    itemPageCount: 1,
    failedSiteCount: 0,
    failedLibraryCount: 0,
    status: "complete",
    failureCounts: [],
  });
  assert.equal(JSON.stringify(result).includes("file-1"), false);
  assert.equal(requests.at(-1), "/drives/drive-1/root/delta?$select=id,file,folder,deleted");
});

test("tenant file count reports library failures without returning partial file counts", async () => {
  const graph = {
    async request(path: string) {
      if (path.includes("/root/delta?")) {
        throw new Error("page ceiling or transport failure");
      }
      if (path.includes("/drives?")) {
        return { value: [{ id: "drive-1", driveType: "documentLibrary" }] };
      }
      return { value: [{ id: "site-1" }] };
    },
  } as unknown as GraphClient;

  const result = await countTenantFiles({ graph });

  assert.equal(result.status, "partial");
  assert.equal(result.countedLibraryCount, 0);
  assert.equal(result.fileCount, 0);
  assert.deepEqual(result.failureCounts, [{
    stage: "library-items",
    status: 0,
    code: "DISCOVERY_ERROR",
    count: 1,
  }]);
});
