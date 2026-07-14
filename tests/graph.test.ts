import assert from "node:assert/strict";
import test from "node:test";
import type {
  DeletedInventoryIdentity,
  GovernedSharePointSite,
  SensitivityInventoryItem,
  SensitivityScanRun,
} from "../src/domain/types";
import { mapWithConcurrency } from "../src/scanner/bounded-concurrency";
import { loadGraphPilotConfig, ScannerConfigurationError } from "../src/scanner/graph/config";
import {
  GraphClient,
  GraphRequestError,
  type GraphAccessTokenProvider,
} from "../src/scanner/graph/graph-client";
import { MicrosoftGraphPilotScanner } from "../src/scanner/graph/pilot-scanner";
import { probeGraphPilotAccess } from "../src/scanner/graph/probe";
import type { DeltaStateStore, InventoryStore, ScanRunStore } from "../src/stores/contracts";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const CLIENT_ID = "22222222-2222-4222-8222-222222222222";
const SECRET_LABEL_ID = "33333333-3333-4333-8333-333333333333";
const CONFIDENTIAL_LABEL_ID = "44444444-4444-4444-8444-444444444444";
const SITE_ID = "contoso.sharepoint.com,site-collection-id,site-web-id";

const tokenProvider: GraphAccessTokenProvider = {
  async getAccessToken() {
    return "test-token";
  },
};

test("Graph client respects Retry-After and bounds retry attempts", async () => {
  const delays: number[] = [];
  let requests = 0;
  const client = new GraphClient({
    tokenProvider,
    maxRetries: 1,
    sleep: async (milliseconds) => { delays.push(milliseconds); },
    fetch: async (_input, init) => {
      requests += 1;
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-token");
      if (requests === 1) {
        return new Response(JSON.stringify({ error: { code: "TooManyRequests" } }), {
          status: 429,
          headers: { "content-type": "application/json", "retry-after": "2" },
        });
      }
      return Response.json({ value: [{ id: "drive-1" }] });
    },
  });

  const response = await client.request<{ value: Array<{ id: string }> }>("/sites/site-1/drives");
  assert.equal(response.value[0].id, "drive-1");
  assert.deepEqual(delays, [2_000]);
  assert.equal(requests, 2);
});

test("Graph client rejects next links outside Microsoft Graph v1.0", async () => {
  const client = new GraphClient({ tokenProvider });
  await assert.rejects(
    () => client.request("https://example.com/v1.0/drives"),
    /outside the configured v1.0 endpoint/,
  );
});

test("Graph pilot configuration fails closed and supports managed identity by default", () => {
  assert.throws(() => loadGraphPilotConfig({}), ScannerConfigurationError);
  const config = loadGraphPilotConfig({
    SCANNER_TENANT_ID: TENANT_ID,
    SCANNER_ALLOWED_SITE_ID: SITE_ID,
    SCANNER_REPORTABLE_LABEL_IDS: `${CONFIDENTIAL_LABEL_ID},${SECRET_LABEL_ID}`,
    SCANNER_LABEL_DISPLAY_NAMES_JSON: JSON.stringify({
      [CONFIDENTIAL_LABEL_ID]: "Confidential",
      [SECRET_LABEL_ID]: "Secret",
    }),
  });
  assert.equal(config.auth.mode, "default");
  assert.equal(config.maxConcurrency, 4);
  assert.deepEqual([...config.reportableLabelIds], [CONFIDENTIAL_LABEL_ID, SECRET_LABEL_ID]);
  assert.equal(config.reportableLabelNames.get(CONFIDENTIAL_LABEL_ID), "Confidential");

  assert.throws(
    () => loadGraphPilotConfig({
      SCANNER_AUTH_MODE: "client-secret",
      SCANNER_TENANT_ID: TENANT_ID,
      SCANNER_ALLOWED_SITE_ID: SITE_ID,
      SCANNER_REPORTABLE_LABEL_IDS: `${CONFIDENTIAL_LABEL_ID},${SECRET_LABEL_ID}`,
      SCANNER_CLIENT_ID: CLIENT_ID,
    }),
    /SCANNER_CLIENT_SECRET is required/,
  );
  assert.throws(
    () => loadGraphPilotConfig({
      SCANNER_TENANT_ID: TENANT_ID,
      SCANNER_ALLOWED_SITE_ID: SITE_ID,
      SCANNER_REPORTABLE_LABEL_IDS: SECRET_LABEL_ID,
      SCANNER_LABEL_DISPLAY_NAMES_JSON: JSON.stringify({
        [CONFIDENTIAL_LABEL_ID]: "Confidential",
      }),
    }),
    /outside SCANNER_REPORTABLE_LABEL_IDS/,
  );
});

test("Graph pilot probe verifies the exact allowlisted Site without reading files", async () => {
  const requests: string[] = [];
  const graph = {
    async request(path: string) {
      requests.push(path);
      if (path.includes("?$select=id,displayName,webUrl")) {
        return { id: SITE_ID, displayName: "P4 Sensitivity Pilot", webUrl: "https://contoso.sharepoint.com/sites/p4" };
      }
      return { value: [{ id: "drive-1", driveType: "documentLibrary" }] };
    },
  } as GraphClient;
  const result = await probeGraphPilotAccess(graph, scannerConfig());
  assert.equal(result.documentLibraryCount, 1);
  assert.equal(requests.length, 2);
  assert.ok(requests.every((path) => !path.includes("delta") && !path.includes("extractSensitivityLabels")));
});

test("bounded concurrency never exceeds the configured worker count", async () => {
  let active = 0;
  let peak = 0;
  const values = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (value) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active -= 1;
    return value * 2;
  });
  assert.equal(peak, 2);
  assert.deepEqual(values, [2, 4, 6, 8, 10]);
});

class MemoryInventoryStore implements InventoryStore {
  changes: Array<{ upserts: SensitivityInventoryItem[]; deletions: DeletedInventoryIdentity[] }> = [];
  async listCurrentBySiteIds() { return []; }
  async applyChanges(changes: { upserts: SensitivityInventoryItem[]; deletions: DeletedInventoryIdentity[] }) {
    this.changes.push(structuredClone(changes));
  }
}

class MemoryRunStore implements ScanRunStore {
  runs: SensitivityScanRun[] = [];
  async listRecent() { return structuredClone(this.runs); }
  async save(run: SensitivityScanRun) { this.runs.push(structuredClone(run)); }
}

class MemoryDeltaStore implements DeltaStateStore {
  states = new Map<string, { driveId: string; cursor: string; updatedAt: string }>();
  async get(driveId: string) { return this.states.get(driveId) ?? null; }
  async save(state: { driveId: string; cursor: string; updatedAt: string }) {
    this.states.set(state.driveId, structuredClone(state));
  }
}

const testSite: GovernedSharePointSite = {
  id: SITE_ID,
  name: "P4 Sensitivity Pilot",
  hostname: "contoso.sharepoint.com",
  path: "/sites/p4-sensitivity-pilot",
  active: true,
  scanEnabled: true,
};

function scannerConfig() {
  return loadGraphPilotConfig({
    SCANNER_TENANT_ID: TENANT_ID,
    SCANNER_ALLOWED_SITE_ID: SITE_ID,
    SCANNER_REPORTABLE_LABEL_IDS: `${CONFIDENTIAL_LABEL_ID},${SECRET_LABEL_ID}`,
    SCANNER_LABEL_DISPLAY_NAMES_JSON: JSON.stringify({
      [CONFIDENTIAL_LABEL_ID]: "Confidential",
      [SECRET_LABEL_ID]: "Secret",
    }),
    SCANNER_MAX_CONCURRENCY: "2",
  });
}

test("one-site Graph pilot persists outcomes, deletion markers and delta state", async () => {
  const inventoryStore = new MemoryInventoryStore();
  const scanRunStore = new MemoryRunStore();
  const deltaStateStore = new MemoryDeltaStore();
  const requests: string[] = [];
  const graph = {
    async request(path: string) {
      requests.push(path);
      if (path.includes("/drives?$select=")) {
        return { value: [{ id: "drive-1", name: "Documents" }] };
      }
      if (path.includes("/root/delta?")) {
        return {
          value: [
            { id: "item-secret", name: "strategy.docx", file: {}, parentReference: { path: "/drives/drive-1/root:/Board" } },
            { id: "item-locked", name: "locked.xlsx", file: {}, parentReference: { path: "/drives/drive-1/root:/Board" } },
            { id: "item-deleted", deleted: {} },
          ],
          "@odata.deltaLink": "https://graph.microsoft.com/v1.0/drives/drive-1/root/delta?token=next",
        };
      }
      if (path.includes("item-secret")) {
        return { value: { labels: [{ sensitivityLabelId: CONFIDENTIAL_LABEL_ID, assignmentMethod: "standard", tenantId: TENANT_ID }] } };
      }
      if (path.includes("item-locked")) {
        throw new GraphRequestError("locked", 423, "fileDecryptionDeferred", "request-423");
      }
      throw new Error(`Unexpected Graph request: ${path}`);
    },
  } as GraphClient;
  const scanner = new MicrosoftGraphPilotScanner({
    graph,
    inventoryStore,
    scanRunStore,
    deltaStateStore,
    config: scannerConfig(),
    now: () => new Date("2026-07-14T10:00:00.000Z"),
  });

  const result = await scanner.execute({ runId: "P4-001", trigger: "manual", target: testSite });

  assert.equal(result.status, "succeeded");
  assert.equal(result.changedCount, 3);
  assert.equal(result.scannedCount, 2);
  assert.equal(result.sensitiveCount, 1);
  assert.equal(inventoryStore.changes[0].upserts[0].sensitivityLabels[0].displayName, "Confidential");
  assert.equal(result.lockedCount, 1);
  assert.equal(inventoryStore.changes[0].upserts[1].scanStatus, "locked");
  assert.equal(inventoryStore.changes[0].deletions[0].itemId, "item-deleted");
  assert.equal(deltaStateStore.states.get("drive-1")?.cursor.includes("token=next"), true);
  assert.equal(scanRunStore.runs.at(-1)?.status, "succeeded");
  assert.equal(requests.filter((path) => path.includes("extractSensitivityLabels")).length, 2);
});

test("one-site Graph pilot rejects a non-allowlisted Site before network access", async () => {
  let requested = false;
  const graph = { async request() { requested = true; return {}; } } as unknown as GraphClient;
  const scanner = new MicrosoftGraphPilotScanner({
    graph,
    inventoryStore: new MemoryInventoryStore(),
    scanRunStore: new MemoryRunStore(),
    deltaStateStore: new MemoryDeltaStore(),
    config: scannerConfig(),
  });
  await assert.rejects(
    () => scanner.execute({ runId: "P4-002", trigger: "manual", target: { ...testSite, id: "other-site" } }),
    /not the active P4 allowlisted target/,
  );
  assert.equal(requested, false);
});

test("delta cursor does not advance when inventory persistence fails", async () => {
  const deltaStateStore = new MemoryDeltaStore();
  const inventoryStore = new MemoryInventoryStore();
  inventoryStore.applyChanges = async () => { throw new Error("storage unavailable"); };
  const graph = {
    async request(path: string) {
      if (path.includes("/drives?$select=")) return { value: [{ id: "drive-1", name: "Documents" }] };
      if (path.includes("/root/delta?")) {
        return {
          value: [{ id: "item-1", name: "file.docx", file: {} }],
          "@odata.deltaLink": "https://graph.microsoft.com/v1.0/drives/drive-1/root/delta?token=unsafe",
        };
      }
      return { value: { labels: [] } };
    },
  } as GraphClient;
  const scanner = new MicrosoftGraphPilotScanner({
    graph,
    inventoryStore,
    scanRunStore: new MemoryRunStore(),
    deltaStateStore,
    config: scannerConfig(),
  });

  const result = await scanner.execute({ runId: "P4-003", trigger: "manual", target: testSite });
  assert.equal(result.status, "failed");
  assert.equal(deltaStateStore.states.has("drive-1"), false);
});
