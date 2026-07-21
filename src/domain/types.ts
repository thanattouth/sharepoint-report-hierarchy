export type HierarchyNodeType = "EVP" | "Department" | "Group" | "Project";

export type GovernanceHierarchyNode = {
  id: string;
  parentId?: string;
  type: HierarchyNodeType;
  name: string;
  active: boolean;
  version?: number;
  updatedAt?: string;
  updatedBy?: string;
};

export type GovernedSharePointSite = {
  id: string;
  name: string;
  hostname: string;
  path: string;
  active: boolean;
  scanEnabled: boolean;
  scanLibraryIds?: string[];
  baselineWave?: number;
  baselineState?: "candidate" | "excluded" | "approved" | "completed" | "skipped";
  baselineExclusionReason?: string;
  baselineExcludedAt?: string;
  baselineSkipReason?: string;
  baselineSkippedAt?: string;
};

export type GovernanceHierarchySiteMapping = {
  nodeId: string;
  siteId: string;
  active: boolean;
  version?: number;
  updatedAt?: string;
  updatedBy?: string;
};

export type GovernancePrincipalType = "User" | "Group";

export type BusinessRole =
  | "EVP"
  | "DepartmentHead"
  | "GroupManager"
  | "ProjectOwner"
  | "Delegate";

export type GovernanceHierarchyAssignment = {
  id?: string;
  principalType?: GovernancePrincipalType;
  principalObjectId?: string;
  principalDisplayName?: string;
  userUpn?: string;
  nodeId: string;
  businessRole: BusinessRole;
  includeDescendants: boolean;
  active: boolean;
  version?: number;
  updatedAt?: string;
  updatedBy?: string;
};

export type GovernancePrincipalContext = {
  tenantId?: string;
  userUpn: string;
  userObjectId?: string;
  groupObjectIds?: string[];
};

export type SiteMappingAuditEvent = {
  id: string;
  siteId: string;
  previousNodeId?: string;
  nodeId: string;
  action: "assigned" | "moved" | "reactivated" | "deactivated";
  actor: string;
  occurredAt: string;
  version: number;
};

export type HierarchyConfigurationEntityType = "HierarchyNode" | "ScopeAssignment";

export type HierarchyConfigurationAuditEvent = {
  id: string;
  entityType: HierarchyConfigurationEntityType;
  entityId: string;
  action: "created" | "updated" | "moved" | "reactivated" | "deactivated";
  actor: string;
  occurredAt: string;
  version: number;
  summary: string;
};

export type AppCapability = "ReportAdmin" | "ReportViewer";
export type ScanStatus =
  | "success"
  | "no-label"
  | "unsupported"
  | "locked"
  | "throttled"
  | "failed";

export type SensitivityInventoryItem = {
  tenantId: string;
  siteId: string;
  driveId: string;
  itemId: string;
  siteName: string;
  siteWebUrl?: string;
  libraryName: string;
  fileName: string;
  filePath: string;
  fileWebUrl?: string;
  modifiedAt?: string;
  sensitivityLabels: Array<{
    id: string;
    displayName?: string;
    assignmentMethod?: string;
    tenantId?: string;
  }>;
  scanStatus: ScanStatus;
  scannedAt: string;
  deletedAt?: string;
  errorCode?: string;
  errorMessage?: string;
  graphRequestId?: string;
};

export type SensitivityScanRun = {
  id: string;
  trigger: "schedule" | "manual" | "reconciliation";
  status:
    | "queued"
    | "running"
    | "succeeded"
    | "partial"
    | "failed"
    | "cancelled";
  startedAt?: string;
  finishedAt?: string;
  targetSiteIds: string[];
  scannedCount: number;
  changedCount: number;
  sensitiveCount: number;
  noLabelCount: number;
  lockedCount: number;
  throttledCount: number;
  unsupportedCount: number;
  failedCount: number;
  errorSummary?: string;
};

export type SiteSensitivitySummary = {
  tenantId: string;
  siteId: string;
  siteName: string;
  siteWebUrl?: string;
  inventoryCount: number;
  sensitiveCount: number;
  libraryCount: number;
  labelCounts: Array<{
    id: string;
    displayName?: string;
    count: number;
  }>;
  libraryCounts: Array<{
    libraryName: string;
    sensitiveCount: number;
  }>;
  statusCounts: Record<ScanStatus, number>;
  lastScannedAt?: string;
  latestRunId?: string;
  updatedAt: string;
};

export type DeltaState = {
  driveId: string;
  cursor: string;
  updatedAt: string;
};

export type DeletedInventoryIdentity = {
  tenantId: string;
  siteId: string;
  driveId: string;
  itemId: string;
  deletedAt: string;
};

export function stableFileKey(item: SensitivityInventoryItem): string {
  return [item.tenantId, item.siteId, item.driveId, item.itemId].join(":");
}
