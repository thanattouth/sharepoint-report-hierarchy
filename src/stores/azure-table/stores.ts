import {
  TableClient,
  type TableEntity,
  type TransactionAction,
} from "@azure/data-tables";
import type { TokenCredential } from "@azure/identity";
import type {
  DeltaState,
  DeletedInventoryIdentity,
  SensitivityInventoryItem,
  SensitivityScanRun,
  SiteSensitivitySummary,
} from "../../domain/types";
import type {
  DeltaStateStore,
  InventoryStore,
  ScanRunStore,
  SiteSummaryStore,
} from "../contracts";
import type { AzureTableStoreConfig } from "./config";
import {
  fromDeltaStateEntity,
  fromInventoryEntity,
  fromScanRunEntity,
  fromSiteSummaryEntity,
  inventoryPartitionKey,
  inventoryRowKey,
  toDeltaStateEntity,
  toInventoryEntity,
  toScanRunEntity,
  toSiteSummaryEntity,
  type DeltaStateEntity,
  type InventoryEntity,
  type ScanRunEntity,
  type SiteSummaryEntity,
} from "./codec";

function odata(value: string) {
  return value.replaceAll("'", "''");
}

function chunks<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function isNotFound(error: unknown) {
  return Boolean(error && typeof error === "object" && "statusCode" in error
    && (error as { statusCode?: number }).statusCode === 404);
}

export class AzureTableInventoryStore implements InventoryStore {
  constructor(
    private readonly client: TableClient,
    private readonly tenantId: string,
  ) {}

  async listCurrentBySiteIds(siteIds: string[]) {
    const items: SensitivityInventoryItem[] = [];
    for (const siteId of [...new Set(siteIds)]) {
      const partitionKey = inventoryPartitionKey(this.tenantId, siteId);
      const entities = this.client.listEntities<InventoryEntity>({
        queryOptions: { filter: `PartitionKey eq '${odata(partitionKey)}'` },
      });
      for await (const entity of entities) {
        if (!entity.deletedAt) items.push(fromInventoryEntity(entity as InventoryEntity));
      }
    }
    return items;
  }

  async applyChanges(changes: {
    upserts: SensitivityInventoryItem[];
    deletions: DeletedInventoryIdentity[];
  }) {
    const byPartition = new Map<string, Map<string, TransactionAction>>();
    const put = (partitionKey: string, rowKey: string, action: TransactionAction) => {
      const partition = byPartition.get(partitionKey) ?? new Map<string, TransactionAction>();
      partition.set(rowKey, action);
      byPartition.set(partitionKey, partition);
    };

    for (const item of changes.upserts) {
      if (item.tenantId !== this.tenantId) {
        throw new Error("Refusing Azure Table inventory upsert for another tenant");
      }
      const entity = toInventoryEntity(item);
      put(entity.partitionKey, entity.rowKey, ["upsert", entity, "Replace"]);
    }
    for (const deletion of changes.deletions) {
      if (deletion.tenantId !== this.tenantId) {
        throw new Error("Refusing Azure Table inventory deletion for another tenant");
      }
      const partitionKey = inventoryPartitionKey(deletion.tenantId, deletion.siteId);
      const rowKey = inventoryRowKey(deletion.driveId, deletion.itemId);
      const tombstone: TableEntity = { partitionKey, rowKey, deletedAt: deletion.deletedAt };
      put(partitionKey, rowKey, ["upsert", tombstone, "Merge"]);
    }

    for (const actions of byPartition.values()) {
      for (const batch of chunks([...actions.values()], 100)) {
        await this.client.submitTransaction(batch);
      }
    }
  }
}

export class AzureTableScanRunStore implements ScanRunStore {
  constructor(
    private readonly client: TableClient,
    private readonly tenantId: string,
  ) {}

  async listRecent() {
    const entities = this.client.listEntities<ScanRunEntity>({
      queryOptions: { filter: `PartitionKey eq '${odata(encodeURIComponent(this.tenantId))}'` },
    });
    const runs: SensitivityScanRun[] = [];
    for await (const entity of entities) runs.push(fromScanRunEntity(entity as ScanRunEntity));
    return runs
      .sort((a, b) => (b.finishedAt ?? b.startedAt ?? "").localeCompare(a.finishedAt ?? a.startedAt ?? ""))
      .slice(0, 20);
  }

  async save(run: SensitivityScanRun) {
    await this.client.upsertEntity(toScanRunEntity(this.tenantId, run), "Replace");
  }
}

export class AzureTableDeltaStateStore implements DeltaStateStore {
  constructor(
    private readonly client: TableClient,
    private readonly tenantId: string,
  ) {}

  async get(driveId: string) {
    try {
      const entity = await this.client.getEntity<DeltaStateEntity>(
        encodeURIComponent(this.tenantId),
        encodeURIComponent(driveId),
      );
      return fromDeltaStateEntity(entity as DeltaStateEntity);
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async save(state: DeltaState) {
    await this.client.upsertEntity(toDeltaStateEntity(this.tenantId, state), "Replace");
  }
}

export class AzureTableSiteSummaryStore implements SiteSummaryStore {
  constructor(
    private readonly client: TableClient,
    private readonly tenantId: string,
  ) {}

  async listBySiteIds(siteIds: string[]) {
    const allowed = new Set(siteIds);
    if (allowed.size === 0) return [];
    const partitionKey = encodeURIComponent(this.tenantId);
    const entities = this.client.listEntities<SiteSummaryEntity>({
      queryOptions: { filter: `PartitionKey eq '${odata(partitionKey)}'` },
    });
    const summaries: SiteSensitivitySummary[] = [];
    for await (const entity of entities) {
      if (allowed.has(entity.siteId)) {
        summaries.push(fromSiteSummaryEntity(entity as SiteSummaryEntity));
      }
    }
    return summaries;
  }

  async save(summary: SiteSensitivitySummary) {
    if (summary.tenantId !== this.tenantId) {
      throw new Error("Refusing Azure Table Site summary write for another tenant");
    }
    await this.client.upsertEntity(toSiteSummaryEntity(summary), "Replace");
  }
}

export function createAzureTableStores(input: {
  config: AzureTableStoreConfig;
  credential: TokenCredential;
  tenantId: string;
}) {
  return {
    inventoryStore: new AzureTableInventoryStore(
      new TableClient(input.config.endpoint, input.config.inventoryTableName, input.credential),
      input.tenantId,
    ),
    scanRunStore: new AzureTableScanRunStore(
      new TableClient(input.config.endpoint, input.config.scanRunTableName, input.credential),
      input.tenantId,
    ),
    deltaStateStore: new AzureTableDeltaStateStore(
      new TableClient(input.config.endpoint, input.config.deltaStateTableName, input.credential),
      input.tenantId,
    ),
    siteSummaryStore: new AzureTableSiteSummaryStore(
      new TableClient(input.config.endpoint, input.config.siteSummaryTableName, input.credential),
      input.tenantId,
    ),
  };
}
