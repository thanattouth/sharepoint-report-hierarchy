import type {
  DeltaState,
  DeletedInventoryIdentity,
  GovernedSharePointSite,
  GovernanceHierarchyAssignment,
  GovernanceHierarchyNode,
  GovernanceHierarchySiteMapping,
  HierarchyConfigurationAuditEvent,
  SiteMappingAuditEvent,
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
  listActive(): Promise<GovernedSharePointSite[]>;
  listScanEnabled(): Promise<GovernedSharePointSite[]>;
  listByBaselineWave(wave: number): Promise<GovernedSharePointSite[]>;
  save(site: GovernedSharePointSite): Promise<void>;
}

export interface SiteMappingStore {
  listAll(): Promise<GovernanceHierarchySiteMapping[]>;
  listActive(): Promise<GovernanceHierarchySiteMapping[]>;
  get(siteId: string): Promise<GovernanceHierarchySiteMapping | null>;
  save(mapping: GovernanceHierarchySiteMapping, expectedVersion?: number): Promise<void>;
}

export interface HierarchyNodeStore {
  listAll(): Promise<GovernanceHierarchyNode[]>;
  get(nodeId: string): Promise<GovernanceHierarchyNode | null>;
  save(node: GovernanceHierarchyNode, expectedVersion?: number): Promise<void>;
}

export interface ScopeAssignmentStore {
  listAll(): Promise<GovernanceHierarchyAssignment[]>;
  get(assignmentId: string): Promise<GovernanceHierarchyAssignment | null>;
  save(assignment: GovernanceHierarchyAssignment, expectedVersion?: number): Promise<void>;
}

export interface SiteMappingAuditStore {
  listRecent(siteId?: string): Promise<SiteMappingAuditEvent[]>;
  save(event: SiteMappingAuditEvent): Promise<void>;
}

export interface HierarchyConfigurationAuditStore {
  listRecent(entityType?: HierarchyConfigurationAuditEvent["entityType"], entityId?: string): Promise<HierarchyConfigurationAuditEvent[]>;
  save(event: HierarchyConfigurationAuditEvent): Promise<void>;
}
