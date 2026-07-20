import assert from "node:assert/strict";
import test from "node:test";
import type { TableClient, TransactionAction } from "@azure/data-tables";
import type { SensitivityInventoryItem, SensitivityScanRun } from "../src/domain/types";
import { buildSiteSensitivitySummary } from "../src/domain/site-summary";
import { loadAzureTableStoreConfig } from "../src/stores/azure-table/config";
import {
  fromDeltaStateEntity,
  fromInventoryEntity,
  fromScanRunEntity,
  fromSiteEntity,
  fromSiteMappingEntity,
  fromSiteSummaryEntity,
  inventoryPartitionKey,
  inventoryRowKey,
  toDeltaStateEntity,
  toInventoryEntity,
  toScanRunEntity,
  toSiteEntity,
  toSiteMappingEntity,
  toSiteSummaryEntity,
} from "../src/stores/azure-table/codec";
import {
  AzureTableInventoryStore,
  AzureTableSiteStore,
} from "../src/stores/azure-table/stores";

const tenantId = "11111111-1111-4111-8111-111111111111";
const siteId = "contoso.sharepoint.com,site-collection,site-web";

function inventoryItem(overrides: Partial<SensitivityInventoryItem> = {}): SensitivityInventoryItem {
  return {
    tenantId,
    siteId,
    driveId: "drive-1",
    itemId: "item-1",
    siteName: "DGCS",
    libraryName: "Secret",
    fileName: "strategy.docx",
    filePath: "/strategy.docx",
    sensitivityLabels: [],
    scanStatus: "no-label",
    scannedAt: "2026-07-15T04:00:00.000Z",
    ...overrides,
  };
}

test("Azure Table configuration fails closed and supplies schema table names", () => {
  assert.throws(() => loadAzureTableStoreConfig({}), /AZURE_STORAGE_ACCOUNT_NAME/);
  assert.throws(
    () => loadAzureTableStoreConfig({ AZURE_STORAGE_ACCOUNT_NAME: "Invalid-Name" }),
    /lowercase alphanumeric/,
  );
  assert.throws(
    () => loadAzureTableStoreConfig({ AZURE_STORAGE_ACCOUNT_NAME: "senspilot123" }),
    /AZURE_STORAGE_TENANT_ID/,
  );
  const config = loadAzureTableStoreConfig({
    AZURE_STORAGE_ACCOUNT_NAME: "senspilot123",
    AZURE_STORAGE_TENANT_ID: tenantId,
    AZURE_TABLE_AUTH_MODE: "azure-cli",
  });
  assert.equal(config.endpoint, "https://senspilot123.table.core.windows.net");
  assert.equal(config.inventoryTableName, "SensitivityInventory");
  assert.equal(config.scanRunTableName, "SensitivityScanRuns");
  assert.equal(config.deltaStateTableName, "SensitivityDeltaState");
  assert.equal(config.siteSummaryTableName, "SiteLabelSummary");
  assert.equal(config.siteTableName, "ScannerSites");
  assert.equal(config.siteMappingTableName, "HierarchySiteMappings");
  assert.deepEqual(config.auth, { mode: "azure-cli", tenantId });
  assert.throws(
    () => loadAzureTableStoreConfig({
      AZURE_STORAGE_ACCOUNT_NAME: "senspilot123",
      AZURE_STORAGE_TENANT_ID: tenantId,
      AZURE_TABLE_AUTH_MODE: "azure-cli",
      AZURE_STORAGE_MANAGED_IDENTITY_CLIENT_ID: tenantId,
    }),
    /requires managed-identity/,
  );
});

test("Azure Table hierarchy-to-Site mapping codec preserves the explicit placement", () => {
  const mapping = { nodeId: "evp-corporate", siteId, active: true };
  assert.deepEqual(fromSiteMappingEntity({
    ...toSiteMappingEntity(tenantId, mapping),
    etag: "W/metadata",
    timestamp: new Date("2026-07-16T00:00:00.000Z"),
  }), mapping);
});

test("Azure Table Site registry codec preserves flat scan configuration", () => {
  const site = {
    id: siteId,
    name: "DGCS",
    hostname: "contoso.sharepoint.com",
    path: "/sites/DGCS",
    active: true,
    scanEnabled: true,
    scanLibraryIds: ["drive-secret", "drive-confidential"],
    baselineWave: 1,
  };
  assert.deepEqual(fromSiteEntity({
    ...toSiteEntity(tenantId, site),
    etag: "W/metadata",
    timestamp: new Date("2026-07-16T00:00:00.000Z"),
  }), site);
});

test("Azure Table Site registry can list every active Site independently of rollout wave", async () => {
  let observedFilter = "";
  const activeSite = {
    id: siteId,
    name: "DGCS",
    hostname: "contoso.sharepoint.com",
    path: "/sites/DGCS",
    active: true,
    scanEnabled: true,
  };
  const client = {
    listEntities(options: { queryOptions?: { filter?: string } }) {
      observedFilter = options.queryOptions?.filter ?? "";
      return {
        async *[Symbol.asyncIterator]() {
          yield toSiteEntity(tenantId, activeSite);
        },
      };
    },
  } as unknown as TableClient;

  const sites = await new AzureTableSiteStore(client, tenantId).listActive();

  assert.deepEqual(sites, [activeSite]);
  assert.match(observedFilter, /active eq true/);
  assert.doesNotMatch(observedFilter, /baselineWave|scanEnabled/);
});

test("Site summary materializes distinct reportable counts and round-trips through Table", () => {
  const labelId = "22222222-2222-4222-8222-222222222222";
  const sensitive = inventoryItem({
    sensitivityLabels: [{ id: labelId, displayName: "Highly Confidential" }],
    scanStatus: "success",
  });
  const summary = buildSiteSensitivitySummary({
    tenantId,
    siteId,
    siteName: "DGCS",
    siteWebUrl: "https://contoso.sharepoint.com/sites/DGCS",
    items: [sensitive, sensitive, inventoryItem({ itemId: "unsupported", scanStatus: "unsupported" })],
    reportableLabelIds: new Set([labelId]),
    latestRunId: "bounded-1",
    updatedAt: "2026-07-15T04:10:00.000Z",
  });
  assert.equal(summary.inventoryCount, 2);
  assert.equal(summary.sensitiveCount, 1);
  assert.equal(summary.statusCounts.unsupported, 1);
  assert.deepEqual(summary.labelCounts, [{ id: labelId, displayName: "Highly Confidential", count: 1 }]);
  assert.deepEqual(
    fromSiteSummaryEntity({
      ...toSiteSummaryEntity(summary),
      etag: "W/metadata",
      timestamp: new Date("2026-07-15T04:10:01.000Z"),
    }),
    summary,
  );
});

test("Azure Table inventory codec preserves the stable file identity and labels", () => {
  const item = inventoryItem({
    driveId: "b!drive-id",
    itemId: "item-id",
    siteWebUrl: "https://contoso.sharepoint.com/sites/DGCS",
    sensitivityLabels: [{
      id: "22222222-2222-4222-8222-222222222222",
      displayName: "Highly Confidential \\ User Defined Protection",
      assignmentMethod: "standard",
      tenantId,
    }],
    scanStatus: "success",
  });
  const entity = toInventoryEntity(item);
  assert.equal(entity.partitionKey, inventoryPartitionKey(tenantId, siteId));
  assert.equal(entity.rowKey, inventoryRowKey(item.driveId, item.itemId));
  assert.deepEqual(fromInventoryEntity({
    ...entity,
    etag: "W/metadata",
    timestamp: new Date("2026-07-15T04:00:01.000Z"),
  }), item);
});

test("Azure Table inventory adapter batches within a Site partition and rejects another tenant", async () => {
  const transactions: TransactionAction[][] = [];
  const client = {
    async submitTransaction(actions: TransactionAction[]) {
      transactions.push(actions);
    },
  } as unknown as TableClient;
  const store = new AzureTableInventoryStore(client, tenantId);
  const upserts = Array.from({ length: 101 }, (_, index) => inventoryItem({
    itemId: `item-${index}`,
  }));
  upserts.push(inventoryItem({ siteId: "contoso.sharepoint.com,other-site,web", itemId: "other" }));

  await store.applyChanges({ upserts, deletions: [] });

  assert.deepEqual(transactions.map((batch) => batch.length), [100, 1, 1]);
  assert.ok(transactions.every((batch) => new Set(
    batch.map((action) => action[1].partitionKey),
  ).size === 1));
  await assert.rejects(
    () => store.applyChanges({
      upserts: [inventoryItem({ tenantId: "22222222-2222-4222-8222-222222222222" })],
      deletions: [],
    }),
    /another tenant/,
  );
  assert.equal(transactions.length, 3);
});

test("Azure Table run and delta codecs round-trip operational state", () => {
  const run: SensitivityScanRun = {
    id: "P5-001",
    trigger: "manual",
    status: "partial",
    startedAt: "2026-07-15T04:00:00.000Z",
    finishedAt: "2026-07-15T04:01:00.000Z",
    targetSiteIds: [siteId],
    scannedCount: 16,
    changedCount: 16,
    sensitiveCount: 12,
    noLabelCount: 0,
    lockedCount: 0,
    throttledCount: 0,
    unsupportedCount: 4,
    failedCount: 0,
  };
  assert.deepEqual(fromScanRunEntity({
    ...toScanRunEntity(tenantId, run),
    etag: "W/metadata",
    timestamp: new Date("2026-07-15T04:01:01.000Z"),
  }), run);
  const delta = { driveId: "drive-1", cursor: "opaque-cursor", updatedAt: run.finishedAt! };
  assert.deepEqual(fromDeltaStateEntity({
    ...toDeltaStateEntity(tenantId, delta),
    etag: "W/metadata",
    timestamp: new Date("2026-07-15T04:01:01.000Z"),
  }), delta);
});
