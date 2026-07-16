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
  get(runId: string): Promise<SensitivityScanRun | null>;
  listRecent(): Promise<SensitivityScanRun[]>;
  save(run: SensitivityScanRun): Promise<void>;
}

export interface DeltaStateStore {
  get(driveId: string): Promise<DeltaState | null>;
  save(state: DeltaState): Promise<void>;
}

export interface SiteSummaryStore {
  listBySiteIds(siteIds: string[]): Promise<SiteSensitivitySummary[]>;
  save(summary: SiteSensitivitySummary): Promise<void>;
}

export interface SiteStore {
  get(siteId: string): Promise<GovernedSharePointSite | null>;
  listScanEnabled(): Promise<GovernedSharePointSite[]>;
  listByBaselineWave(wave: number): Promise<GovernedSharePointSite[]>;
  save(site: GovernedSharePointSite): Promise<void>;
}

export interface SiteMappingStore {
  listActive(): Promise<GovernanceHierarchySiteMapping[]>;
  save(mapping: GovernanceHierarchySiteMapping): Promise<void>;
}
