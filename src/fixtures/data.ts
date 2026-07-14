import type {
  GovernanceHierarchyAssignment,
  GovernanceHierarchyNode,
  SensitivityInventoryItem,
  SensitivityScanRun,
} from "../domain/types";

export const SECRET_LABEL_IDS = new Set(["label-secret-th"]);
const TENANT_ID = "tenant-fixture";

export const hierarchyNodes: GovernanceHierarchyNode[] = [
  { id: "evp-corporate", type: "EVP", name: "Corporate Services", active: true },
  {
    id: "dept-commercial",
    parentId: "evp-corporate",
    type: "Department",
    name: "Commercial",
    active: true,
  },
  {
    id: "group-enterprise",
    parentId: "dept-commercial",
    type: "Group",
    name: "Enterprise Growth",
    active: true,
  },
  {
    id: "project-aurora",
    parentId: "group-enterprise",
    type: "Project",
    name: "Project Aurora",
    active: true,
    site: {
      hostname: "contoso.sharepoint.com",
      path: "/sites/project-aurora",
      siteId: "site-aurora",
    },
  },
  {
    id: "project-nova",
    parentId: "group-enterprise",
    type: "Project",
    name: "Project Nova",
    active: true,
    site: {
      hostname: "contoso.sharepoint.com",
      path: "/sites/project-nova",
      siteId: "site-nova",
    },
  },
  {
    id: "group-consumer",
    parentId: "dept-commercial",
    type: "Group",
    name: "Consumer Markets",
    active: true,
    site: {
      hostname: "contoso.sharepoint.com",
      path: "/sites/consumer-markets",
      siteId: "site-consumer",
    },
  },
  {
    id: "dept-operations",
    parentId: "evp-corporate",
    type: "Department",
    name: "Operations & Finance",
    active: true,
  },
  {
    id: "group-finance",
    parentId: "dept-operations",
    type: "Group",
    name: "Finance Control",
    active: true,
  },
  {
    id: "project-ledger",
    parentId: "group-finance",
    type: "Project",
    name: "Project Ledger",
    active: true,
    site: {
      hostname: "contoso.sharepoint.com",
      path: "/sites/project-ledger",
      siteId: "site-ledger",
    },
  },
  {
    id: "project-supply",
    parentId: "dept-operations",
    type: "Project",
    name: "Supply Excellence",
    active: true,
    site: {
      hostname: "contoso.sharepoint.com",
      path: "/sites/supply-excellence",
      siteId: "site-supply",
    },
  },
  {
    id: "project-archived",
    parentId: "dept-operations",
    type: "Project",
    name: "Archived Transformation",
    active: false,
    site: {
      hostname: "contoso.sharepoint.com",
      path: "/sites/archived-transformation",
      siteId: "site-archived",
    },
  },
];

export const hierarchyAssignments: GovernanceHierarchyAssignment[] = [
  {
    userUpn: "nipaporn@contoso.com",
    nodeId: "evp-corporate",
    businessRole: "EVP",
    includeDescendants: true,
    active: true,
  },
  {
    userUpn: "anan@contoso.com",
    nodeId: "dept-commercial",
    businessRole: "DepartmentHead",
    includeDescendants: true,
    active: true,
  },
  {
    userUpn: "mali@contoso.com",
    nodeId: "group-enterprise",
    businessRole: "GroupManager",
    includeDescendants: true,
    active: true,
  },
  {
    userUpn: "prach@contoso.com",
    nodeId: "project-aurora",
    businessRole: "ProjectOwner",
    includeDescendants: false,
    active: true,
  },
  {
    userUpn: "kittipong@contoso.com",
    nodeId: "dept-operations",
    businessRole: "DepartmentHead",
    includeDescendants: true,
    active: true,
  },
  {
    userUpn: "siriporn@contoso.com",
    nodeId: "project-supply",
    businessRole: "ProjectOwner",
    includeDescendants: false,
    active: true,
  },
  {
    userUpn: "delegate@contoso.com",
    nodeId: "group-enterprise",
    businessRole: "Delegate",
    includeDescendants: true,
    active: true,
  },
  {
    userUpn: "delegate@contoso.com",
    nodeId: "project-ledger",
    businessRole: "Delegate",
    includeDescendants: false,
    active: true,
  },
  {
    userUpn: "inactive@contoso.com",
    nodeId: "project-archived",
    businessRole: "ProjectOwner",
    includeDescendants: false,
    active: false,
  },
];

export type DemoPersona = {
  upn: string;
  name: string;
  role: string;
  initials: string;
};

export const demoPersonas: DemoPersona[] = [
  { upn: "nipaporn@contoso.com", name: "Nipaporn S.", role: "EVP", initials: "NS" },
  { upn: "anan@contoso.com", name: "Anan K.", role: "Department Head", initials: "AK" },
  { upn: "mali@contoso.com", name: "Mali P.", role: "Group Manager", initials: "MP" },
  { upn: "prach@contoso.com", name: "Prach T.", role: "Project Owner", initials: "PT" },
  { upn: "kittipong@contoso.com", name: "Kittipong R.", role: "Department Head", initials: "KR" },
  { upn: "siriporn@contoso.com", name: "Siriporn W.", role: "Project Owner · zero Secret", initials: "SW" },
  { upn: "delegate@contoso.com", name: "Delegate User", role: "Multiple assignments", initials: "DU" },
  { upn: "somchai@contoso.com", name: "Somchai N.", role: "No assignment", initials: "SN" },
];

type FixtureItemInput = Omit<
  SensitivityInventoryItem,
  "tenantId" | "driveId" | "modifiedAt" | "scannedAt" | "sensitivityLabels"
> & {
  driveId?: string;
  modifiedAt?: string;
  scannedAt?: string;
  secret?: boolean;
  labelName?: string;
  assignmentMethod?: string;
};

function fixtureItem(input: FixtureItemInput): SensitivityInventoryItem {
  const siteWebUrl = `https://contoso.sharepoint.com/sites/${input.siteId.replace("site-", "")}`;
  return {
    tenantId: TENANT_ID,
    driveId: input.driveId ?? `drive-${input.siteId.replace("site-", "")}`,
    modifiedAt: input.modifiedAt ?? "2026-07-13T08:30:00Z",
    scannedAt: input.scannedAt ?? "2026-07-14T06:18:00Z",
    sensitivityLabels: input.secret
      ? [
          {
            id: "label-secret-th",
            displayName: input.labelName ?? "Secret",
            assignmentMethod: input.assignmentMethod ?? "standard",
            tenantId: TENANT_ID,
          },
        ]
      : [],
    siteWebUrl,
    fileWebUrl: `${siteWebUrl}${input.filePath}`,
    ...input,
  };
}

export const inventoryItems: SensitivityInventoryItem[] = [
  fixtureItem({ siteId: "site-aurora", itemId: "aur-001", siteName: "Project Aurora", libraryName: "Board Documents", fileName: "FY27-Strategy.pdf", filePath: "/Board Documents/Executive/FY27-Strategy.pdf", scanStatus: "success", secret: true, assignmentMethod: "privileged" }),
  fixtureItem({ siteId: "site-aurora", itemId: "aur-002", siteName: "Project Aurora", libraryName: "Deal Room", fileName: "M&A-Target-Assessment.docx", filePath: "/Deal Room/Restricted/M&A-Target-Assessment.docx", scanStatus: "locked", secret: true, scannedAt: "2026-07-12T04:10:00Z", errorCode: "423", errorMessage: "File was locked during the latest extraction attempt" }),
  fixtureItem({ siteId: "site-aurora", itemId: "aur-003", siteName: "Project Aurora", libraryName: "Documents", fileName: "Partner-Brief.docx", filePath: "/Documents/Partner-Brief.docx", scanStatus: "success", secret: false }),
  fixtureItem({ siteId: "site-aurora", itemId: "aur-004", siteName: "Project Aurora", libraryName: "Documents", fileName: "README.txt", filePath: "/Documents/README.txt", scanStatus: "no-label", secret: false }),
  fixtureItem({ siteId: "site-aurora", itemId: "aur-deleted", siteName: "Project Aurora", libraryName: "Deal Room", fileName: "Old-Terms.xlsx", filePath: "/Deal Room/Old-Terms.xlsx", scanStatus: "success", secret: true, deletedAt: "2026-07-13T12:00:00Z" }),

  fixtureItem({ siteId: "site-nova", itemId: "nov-001", siteName: "Project Nova", libraryName: "Launch", fileName: "Launch-Readiness.xlsx", filePath: "/Launch/PMO/Launch-Readiness.xlsx", scanStatus: "success", secret: true }),
  fixtureItem({ siteId: "site-nova", itemId: "nov-002", siteName: "Project Nova", libraryName: "Commercial", fileName: "Pricing-Scenario.xlsx", filePath: "/Commercial/Finance/Pricing-Scenario.xlsx", scanStatus: "success", secret: true, assignmentMethod: "auto" }),
  fixtureItem({ siteId: "site-nova", itemId: "nov-003", siteName: "Project Nova", libraryName: "Media", fileName: "Launch-Reel.mov", filePath: "/Media/Launch-Reel.mov", scanStatus: "unsupported", secret: false, errorCode: "unsupportedFileType" }),
  fixtureItem({ siteId: "site-nova", itemId: "nov-004", siteName: "Project Nova", libraryName: "Launch", fileName: "Roadmap.pptx", filePath: "/Launch/Roadmap.pptx", scanStatus: "no-label", secret: false }),

  fixtureItem({ siteId: "site-consumer", itemId: "con-001", siteName: "Consumer Markets", libraryName: "Insights", fileName: "Customer-Segmentation.xlsx", filePath: "/Insights/Research/Customer-Segmentation.xlsx", scanStatus: "success", secret: true }),
  fixtureItem({ siteId: "site-consumer", itemId: "con-002", siteName: "Consumer Markets", libraryName: "Campaigns", fileName: "Q4-Campaign-Plan.pptx", filePath: "/Campaigns/Q4/Q4-Campaign-Plan.pptx", scanStatus: "failed", secret: true, scannedAt: "2026-07-11T07:00:00Z", errorCode: "extractFailed", errorMessage: "Previous Secret label retained after a transient extraction failure" }),
  fixtureItem({ siteId: "site-consumer", itemId: "con-003", siteName: "Consumer Markets", libraryName: "Brand", fileName: "Brand-Guidelines.pdf", filePath: "/Brand/Brand-Guidelines.pdf", scanStatus: "no-label", secret: false }),
  fixtureItem({ siteId: "site-consumer", itemId: "con-004", siteName: "Consumer Markets", libraryName: "Contracts", fileName: "Agency-Rate-Card.pdf", filePath: "/Contracts/Agency-Rate-Card.pdf", scanStatus: "success", secret: true, assignmentMethod: "auto" }),

  fixtureItem({ siteId: "site-ledger", itemId: "led-001", siteName: "Project Ledger", libraryName: "Finance", fileName: "Cashflow-Forecast.xlsx", filePath: "/Finance/Forecast/Cashflow-Forecast.xlsx", scanStatus: "success", secret: true }),
  fixtureItem({ siteId: "site-ledger", itemId: "led-002", siteName: "Project Ledger", libraryName: "Audit", fileName: "Audit-Findings-2026.docx", filePath: "/Audit/Restricted/Audit-Findings-2026.docx", scanStatus: "success", secret: true, assignmentMethod: "privileged" }),
  fixtureItem({ siteId: "site-ledger", itemId: "led-003", siteName: "Project Ledger", libraryName: "Payroll", fileName: "Payroll-Exceptions.xlsx", filePath: "/Payroll/Payroll-Exceptions.xlsx", scanStatus: "throttled", secret: true, scannedAt: "2026-07-13T01:30:00Z", errorCode: "429", errorMessage: "Retry scheduled after Graph throttling" }),
  fixtureItem({ siteId: "site-ledger", itemId: "led-004", siteName: "Project Ledger", libraryName: "Documents", fileName: "Finance-Handbook.pdf", filePath: "/Documents/Finance-Handbook.pdf", scanStatus: "no-label", secret: false }),
  fixtureItem({ siteId: "site-ledger", itemId: "led-005", siteName: "Project Ledger", libraryName: "Archive", fileName: "Legacy-Ledger.mdb", filePath: "/Archive/Legacy-Ledger.mdb", scanStatus: "unsupported", secret: false, errorCode: "unsupportedFileType" }),

  fixtureItem({ siteId: "site-supply", itemId: "sup-001", siteName: "Supply Excellence", libraryName: "Operations", fileName: "Warehouse-Checklist.xlsx", filePath: "/Operations/Warehouse-Checklist.xlsx", scanStatus: "no-label", secret: false }),
  fixtureItem({ siteId: "site-supply", itemId: "sup-002", siteName: "Supply Excellence", libraryName: "Documents", fileName: "Supplier-Onboarding.pdf", filePath: "/Documents/Supplier-Onboarding.pdf", scanStatus: "no-label", secret: false }),
  fixtureItem({ siteId: "site-supply", itemId: "sup-003", siteName: "Supply Excellence", libraryName: "Media", fileName: "Safety-Training.mp4", filePath: "/Media/Safety-Training.mp4", scanStatus: "unsupported", secret: false }),
];

export const scanRuns: SensitivityScanRun[] = [
  {
    id: "RUN-260714-042",
    trigger: "schedule",
    status: "succeeded",
    startedAt: "2026-07-14T06:00:00Z",
    finishedAt: "2026-07-14T06:20:00Z",
    targetSiteIds: ["site-aurora", "site-nova", "site-consumer", "site-ledger", "site-supply"],
    scannedCount: 20,
    changedCount: 8,
    secretCount: 10,
    noLabelCount: 6,
    lockedCount: 1,
    unsupportedCount: 3,
    failedCount: 1,
  },
  {
    id: "RUN-260714-043",
    trigger: "manual",
    status: "partial",
    startedAt: "2026-07-14T07:00:00Z",
    finishedAt: "2026-07-14T07:05:00Z",
    targetSiteIds: ["site-aurora", "site-consumer"],
    scannedCount: 7,
    changedCount: 3,
    secretCount: 5,
    noLabelCount: 1,
    lockedCount: 1,
    unsupportedCount: 0,
    failedCount: 1,
    errorSummary: "1 locked file and 1 transient extraction failure",
  },
];
