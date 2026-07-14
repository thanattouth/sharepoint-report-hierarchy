export type HierarchyNodeType = "EVP" | "Department" | "Group" | "Project";

export type GovernanceHierarchyNode = {
  id: string;
  parentId?: string;
  type: HierarchyNodeType;
  name: string;
  active: boolean;
};

export type GovernedSharePointSite = {
  id: string;
  name: string;
  hostname: string;
  path: string;
  active: boolean;
  scanEnabled: boolean;
};

export type GovernanceHierarchySiteMapping = {
  nodeId: string;
  siteId: string;
  active: boolean;
};

export type BusinessRole =
  | "EVP"
  | "DepartmentHead"
  | "GroupManager"
  | "ProjectOwner"
  | "Delegate";

export type GovernanceHierarchyAssignment = {
  userUpn: string;
  nodeId: string;
  businessRole: BusinessRole;
  includeDescendants: boolean;
  active: boolean;
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
