import {
  TableClient,
  type TableEntity,
  type TransactionAction,
} from "@azure/data-tables";
import type { TokenCredential } from "@azure/identity";
import type {
  DeltaState,
  DeletedInventoryIdentity,
  GovernedSharePointSite,
  GovernanceHierarchyAssignment,
  GovernanceHierarchyNode,
  GovernanceHierarchySiteMapping,
  SensitivityInventoryItem,
  SensitivityScanRun,
  SiteSensitivitySummary,
  SiteMappingAuditEvent,
} from "../../domain/types";
import type {
  DeltaStateStore,
  InventoryStore,
  HierarchyNodeStore,
  ScanRunStore,
  SiteStore,
  SiteMappingStore,
  SiteMappingAuditStore,
  SiteSummaryStore,
  ScopeAssignmentStore,
} from "../contracts";
import type { AzureTableStoreConfig } from "./config";
import {
  fromDeltaStateEntity,
  fromInventoryEntity,
  fromHierarchyNodeEntity,
  fromScanRunEntity,
  fromSiteEntity,
  fromSiteMappingEntity,
  fromSiteMappingAuditEntity,
  fromSiteSummaryEntity,
  inventoryPartitionKey,
  inventoryRowKey,
  toDeltaStateEntity,
  toInventoryEntity,
  toHierarchyNodeEntity,
  toScanRunEntity,
  toSiteEntity,
  toSiteMappingEntity,
  toSiteMappingAuditEntity,
  toScopeAssignmentEntity,
  fromScopeAssignmentEntity,
  toSiteSummaryEntity,
  type DeltaStateEntity,
  type InventoryEntity,
  type HierarchyNodeEntity,
  type ScanRunEntity,
  type SiteEntity,
  type SiteMappingEntity,
  type SiteMappingAuditEntity,
  type ScopeAssignmentEntity,
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

  async get(runId: string) {
    try {
      const entity = await this.client.getEntity<ScanRunEntity>(
        encodeURIComponent(this.tenantId),
        encodeURIComponent(runId),
      );
      return fromScanRunEntity(entity as ScanRunEntity);
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

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

export class AzureTableSiteStore implements SiteStore {
  constructor(
    private readonly client: TableClient,
    private readonly tenantId: string,
  ) {}

  async listAll() {
    const partitionKey = encodeURIComponent(this.tenantId);
    const entities = this.client.listEntities<SiteEntity>({
      queryOptions: { filter: `PartitionKey eq '${odata(partitionKey)}'` },
    });
    const sites: GovernedSharePointSite[] = [];
    for await (const entity of entities) sites.push(fromSiteEntity(entity as SiteEntity));
    return sites.sort((left, right) => left.id.localeCompare(right.id));
  }

  async get(siteId: string) {
    try {
      const entity = await this.client.getEntity<SiteEntity>(
        encodeURIComponent(this.tenantId),
        encodeURIComponent(siteId),
      );
      return fromSiteEntity(entity as SiteEntity);
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async listScanEnabled() {
    const partitionKey = encodeURIComponent(this.tenantId);
    const entities = this.client.listEntities<SiteEntity>({
      queryOptions: {
        filter: `PartitionKey eq '${odata(partitionKey)}' and active eq true and scanEnabled eq true`,
      },
    });
    const sites: GovernedSharePointSite[] = [];
    for await (const entity of entities) sites.push(fromSiteEntity(entity as SiteEntity));
    return sites.sort((left, right) => left.id.localeCompare(right.id));
  }

  async listActive() {
    const partitionKey = encodeURIComponent(this.tenantId);
    const entities = this.client.listEntities<SiteEntity>({
      queryOptions: {
        filter: `PartitionKey eq '${odata(partitionKey)}' and active eq true`,
      },
    });
    const sites: GovernedSharePointSite[] = [];
    for await (const entity of entities) sites.push(fromSiteEntity(entity as SiteEntity));
    return sites.sort((left, right) => left.id.localeCompare(right.id));
  }

  async listByBaselineWave(wave: number) {
    if (!Number.isInteger(wave) || wave < 1) throw new Error("Baseline wave must be a positive integer");
    const partitionKey = encodeURIComponent(this.tenantId);
    const entities = this.client.listEntities<SiteEntity>({
      queryOptions: {
        filter: `PartitionKey eq '${odata(partitionKey)}' and baselineWave eq ${wave}`,
      },
    });
    const sites: GovernedSharePointSite[] = [];
    for await (const entity of entities) sites.push(fromSiteEntity(entity as SiteEntity));
    return sites.sort((left, right) => left.id.localeCompare(right.id));
  }

  async save(site: GovernedSharePointSite) {
    await this.client.upsertEntity(toSiteEntity(this.tenantId, site), "Replace");
  }
}

export class AzureTableSiteMappingStore implements SiteMappingStore {
  constructor(
    private readonly client: TableClient,
    private readonly tenantId: string,
  ) {}

  async listAll() {
    const partitionKey = encodeURIComponent(this.tenantId);
    const entities = this.client.listEntities<SiteMappingEntity>({
      queryOptions: { filter: `PartitionKey eq '${odata(partitionKey)}'` },
    });
    const mappings: GovernanceHierarchySiteMapping[] = [];
    for await (const entity of entities) mappings.push(fromSiteMappingEntity(entity as SiteMappingEntity));
    return mappings.sort((left, right) => left.siteId.localeCompare(right.siteId));
  }

  async listActive() {
    const partitionKey = encodeURIComponent(this.tenantId);
    const entities = this.client.listEntities<SiteMappingEntity>({
      queryOptions: {
        filter: `PartitionKey eq '${odata(partitionKey)}' and active eq true`,
      },
    });
    const mappings: GovernanceHierarchySiteMapping[] = [];
    for await (const entity of entities) {
      mappings.push(fromSiteMappingEntity(entity as SiteMappingEntity));
    }
    return mappings.sort((left, right) =>
      left.nodeId.localeCompare(right.nodeId) || left.siteId.localeCompare(right.siteId));
  }

  async get(siteId: string) {
    try {
      const entity = await this.client.getEntity<SiteMappingEntity>(
        encodeURIComponent(this.tenantId),
        encodeURIComponent(siteId),
      );
      return fromSiteMappingEntity(entity as SiteMappingEntity);
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async save(mapping: GovernanceHierarchySiteMapping, expectedVersion?: number) {
    if (!mapping.nodeId.trim() || !mapping.siteId.trim()) {
      throw new Error("Hierarchy Site mapping requires non-empty node and Site IDs");
    }
    const entity = toSiteMappingEntity(this.tenantId, mapping);
    if (expectedVersion === undefined) {
      await this.client.upsertEntity(entity, "Replace");
      return;
    }
    if (expectedVersion === 0) {
      await this.client.createEntity(entity);
      return;
    }
    const current = await this.client.getEntity<SiteMappingEntity>(
      entity.partitionKey,
      entity.rowKey,
    );
    if ((current.version ?? 0) !== expectedVersion) {
      throw new Error(`Site mapping version conflict for ${mapping.siteId}`);
    }
    await this.client.updateEntity(entity, "Replace", { etag: current.etag });
  }
}

export class AzureTableHierarchyNodeStore implements HierarchyNodeStore {
  constructor(private readonly client: TableClient, private readonly tenantId: string) {}

  async listAll() {
    const partitionKey = encodeURIComponent(this.tenantId);
    const entities = this.client.listEntities<HierarchyNodeEntity>({
      queryOptions: { filter: `PartitionKey eq '${odata(partitionKey)}'` },
    });
    const nodes: GovernanceHierarchyNode[] = [];
    for await (const entity of entities) nodes.push(fromHierarchyNodeEntity(entity as HierarchyNodeEntity));
    return nodes.sort((left, right) => left.id.localeCompare(right.id));
  }

  async save(node: GovernanceHierarchyNode) {
    if (!node.id.trim() || !node.name.trim()) throw new Error("Hierarchy node ID and name are required");
    await this.client.upsertEntity(toHierarchyNodeEntity(this.tenantId, node), "Replace");
  }
}

export class AzureTableScopeAssignmentStore implements ScopeAssignmentStore {
  constructor(private readonly client: TableClient, private readonly tenantId: string) {}

  async listAll() {
    const partitionKey = encodeURIComponent(this.tenantId);
    const entities = this.client.listEntities<ScopeAssignmentEntity>({
      queryOptions: { filter: `PartitionKey eq '${odata(partitionKey)}'` },
    });
    const assignments: GovernanceHierarchyAssignment[] = [];
    for await (const entity of entities) assignments.push(fromScopeAssignmentEntity(entity as ScopeAssignmentEntity));
    return assignments.sort((left, right) => (left.id ?? "").localeCompare(right.id ?? ""));
  }

  async save(assignment: GovernanceHierarchyAssignment) {
    await this.client.upsertEntity(toScopeAssignmentEntity(this.tenantId, assignment), "Replace");
  }
}

export class AzureTableSiteMappingAuditStore implements SiteMappingAuditStore {
  constructor(private readonly client: TableClient, private readonly tenantId: string) {}

  async listRecent(siteId?: string) {
    const tenantKey = encodeURIComponent(this.tenantId);
    const filter = siteId
      ? `PartitionKey eq '${odata(`${tenantKey}|${encodeURIComponent(siteId)}`)}'`
      : `PartitionKey ge '${odata(`${tenantKey}|`)}' and PartitionKey lt '${odata(`${tenantKey}|~`)}'`;
    const entities = this.client.listEntities<SiteMappingAuditEntity>({ queryOptions: { filter } });
    const events: SiteMappingAuditEvent[] = [];
    for await (const entity of entities) events.push(fromSiteMappingAuditEntity(entity as SiteMappingAuditEntity));
    return events.sort((left, right) => right.occurredAt.localeCompare(left.occurredAt)).slice(0, 100);
  }

  async save(event: SiteMappingAuditEvent) {
    await this.client.createEntity(toSiteMappingAuditEntity(this.tenantId, event));
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
    siteStore: new AzureTableSiteStore(
      new TableClient(input.config.endpoint, input.config.siteTableName, input.credential),
      input.tenantId,
    ),
    siteMappingStore: new AzureTableSiteMappingStore(
      new TableClient(input.config.endpoint, input.config.siteMappingTableName, input.credential),
      input.tenantId,
    ),
    hierarchyNodeStore: new AzureTableHierarchyNodeStore(
      new TableClient(input.config.endpoint, input.config.hierarchyNodeTableName, input.credential),
      input.tenantId,
    ),
    scopeAssignmentStore: new AzureTableScopeAssignmentStore(
      new TableClient(input.config.endpoint, input.config.scopeAssignmentTableName, input.credential),
      input.tenantId,
    ),
    siteMappingAuditStore: new AzureTableSiteMappingAuditStore(
      new TableClient(input.config.endpoint, input.config.siteMappingAuditTableName, input.credential),
      input.tenantId,
    ),
  };
}
