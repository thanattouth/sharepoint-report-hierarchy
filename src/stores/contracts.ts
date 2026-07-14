import type {
  DeltaState,
  GovernanceHierarchyAssignment,
  GovernanceHierarchyNode,
  SensitivityInventoryItem,
  SensitivityScanRun,
} from "../domain/types";

export interface HierarchyStore {
  getNodes(): Promise<GovernanceHierarchyNode[]>;
  getAssignments(): Promise<GovernanceHierarchyAssignment[]>;
}

export interface InventoryStore {
  listCurrentBySiteIds(siteIds: string[]): Promise<SensitivityInventoryItem[]>;
  upsert(items: SensitivityInventoryItem[]): Promise<void>;
}

export interface ScanRunStore {
  listRecent(): Promise<SensitivityScanRun[]>;
  save(run: SensitivityScanRun): Promise<void>;
}

export interface DeltaStateStore {
  get(driveId: string): Promise<DeltaState | null>;
  save(state: DeltaState): Promise<void>;
}
