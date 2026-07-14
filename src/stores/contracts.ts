import type {
  DeltaState,
  DeletedInventoryIdentity,
  GovernedSharePointSite,
  GovernanceHierarchyAssignment,
  GovernanceHierarchyNode,
  GovernanceHierarchySiteMapping,
  SensitivityInventoryItem,
  SensitivityScanRun,
} from "../domain/types";

export interface HierarchyStore {
  getNodes(): Promise<GovernanceHierarchyNode[]>;
  getAssignments(): Promise<GovernanceHierarchyAssignment[]>;
  getSites(): Promise<GovernedSharePointSite[]>;
  getSiteMappings(): Promise<GovernanceHierarchySiteMapping[]>;
}

export interface InventoryStore {
  listCurrentBySiteIds(siteIds: string[]): Promise<SensitivityInventoryItem[]>;
  applyChanges(changes: {
    upserts: SensitivityInventoryItem[];
    deletions: DeletedInventoryIdentity[];
  }): Promise<void>;
}

export interface ScanRunStore {
  listRecent(): Promise<SensitivityScanRun[]>;
  save(run: SensitivityScanRun): Promise<void>;
}

export interface DeltaStateStore {
  get(driveId: string): Promise<DeltaState | null>;
  save(state: DeltaState): Promise<void>;
}
