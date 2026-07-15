import type {
  DeltaState,
  SensitivityInventoryItem,
  SensitivityScanRun,
} from "../../domain/types";

type InventoryEntity = Omit<SensitivityInventoryItem, "sensitivityLabels"> & {
  partitionKey: string;
  rowKey: string;
  sensitivityLabelsJson: string;
};

type ScanRunEntity = Omit<SensitivityScanRun, "targetSiteIds"> & {
  partitionKey: string;
  rowKey: string;
  targetSiteIdsJson: string;
};

type DeltaStateEntity = DeltaState & {
  partitionKey: string;
  rowKey: string;
};

type AzureTableServiceMetadata = {
  etag?: string;
  timestamp?: Date;
};

function encodedKey(value: string) {
  return encodeURIComponent(value);
}

function withoutUndefined<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, property]) => property !== undefined),
  ) as T;
}

function entityProperties<T extends object, K extends keyof T>(
  entity: T,
  excluded: readonly K[],
): Omit<T, K> {
  const excludedKeys = new Set<PropertyKey>(excluded);
  return Object.fromEntries(
    Object.entries(entity).filter(([key]) => !excludedKeys.has(key)),
  ) as Omit<T, K>;
}

export function inventoryPartitionKey(tenantId: string, siteId: string) {
  return `${encodedKey(tenantId)}|${encodedKey(siteId)}`;
}

export function inventoryRowKey(driveId: string, itemId: string) {
  return `${encodedKey(driveId)}|${encodedKey(itemId)}`;
}

export function toInventoryEntity(item: SensitivityInventoryItem): InventoryEntity {
  const { sensitivityLabels, ...properties } = item;
  return withoutUndefined({
    ...properties,
    partitionKey: inventoryPartitionKey(item.tenantId, item.siteId),
    rowKey: inventoryRowKey(item.driveId, item.itemId),
    sensitivityLabelsJson: JSON.stringify(sensitivityLabels),
  });
}

export function fromInventoryEntity(
  entity: InventoryEntity & AzureTableServiceMetadata,
): SensitivityInventoryItem {
  const { sensitivityLabelsJson } = entity;
  const item = entityProperties(
    entity,
    ["partitionKey", "rowKey", "sensitivityLabelsJson", "etag", "timestamp"] as const,
  );
  const labels = JSON.parse(sensitivityLabelsJson) as SensitivityInventoryItem["sensitivityLabels"];
  if (!Array.isArray(labels)) throw new Error("Azure Table inventory labels are invalid");
  return { ...item, sensitivityLabels: labels };
}

export function toScanRunEntity(tenantId: string, run: SensitivityScanRun): ScanRunEntity {
  const { targetSiteIds, ...properties } = run;
  return withoutUndefined({
    ...properties,
    partitionKey: encodedKey(tenantId),
    rowKey: encodedKey(run.id),
    targetSiteIdsJson: JSON.stringify(targetSiteIds),
  });
}

export function fromScanRunEntity(
  entity: ScanRunEntity & AzureTableServiceMetadata,
): SensitivityScanRun {
  const { targetSiteIdsJson } = entity;
  const run = entityProperties(
    entity,
    ["partitionKey", "rowKey", "targetSiteIdsJson", "etag", "timestamp"] as const,
  );
  const targetSiteIds = JSON.parse(targetSiteIdsJson) as string[];
  if (!Array.isArray(targetSiteIds) || targetSiteIds.some((value) => typeof value !== "string")) {
    throw new Error("Azure Table scan-run target sites are invalid");
  }
  return { ...run, targetSiteIds };
}

export function toDeltaStateEntity(tenantId: string, state: DeltaState): DeltaStateEntity {
  return {
    ...state,
    partitionKey: encodedKey(tenantId),
    rowKey: encodedKey(state.driveId),
  };
}

export function fromDeltaStateEntity(
  entity: DeltaStateEntity & AzureTableServiceMetadata,
): DeltaState {
  return entityProperties(
    entity,
    ["partitionKey", "rowKey", "etag", "timestamp"] as const,
  );
}

export type { DeltaStateEntity, InventoryEntity, ScanRunEntity };
