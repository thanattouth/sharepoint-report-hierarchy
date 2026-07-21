export const MICROSOFT_GRAPH_APP_ID = "00000003-0000-0000-c000-000000000000";
export const ENTERPRISE_APPLICATION_TAG = "WindowsAzureActiveDirectoryIntegratedApp";

export const WEB_APP_ROLES = [
  {
    allowedMemberTypes: ["User"],
    description: "Can view reports and administer business scope configuration.",
    displayName: "Report Administrator",
    id: "b63aa29b-e1af-4c8a-9ec9-29932a2f370f",
    isEnabled: true,
    value: "ReportAdmin",
  },
  {
    allowedMemberTypes: ["User"],
    description: "Can view reports inside assigned business scope.",
    displayName: "Report Viewer",
    id: "a2fd650c-454d-4ca8-8bd4-74cf8ac77cb9",
    isEnabled: true,
    value: "ReportViewer",
  },
] as const;

export const WEB_DELEGATED_GRAPH_PERMISSIONS = ["GroupMember.Read.All"] as const;
export const SCANNER_APPLICATION_GRAPH_PERMISSIONS = ["Files.Read.All", "Sites.Read.All"] as const;

type GraphPermission = { id: string; value?: string | null; allowedMemberTypes?: string[] };

export function enterpriseApplicationTags(tags: readonly string[] = []): string[] {
  return [...new Set([...tags, ENTERPRISE_APPLICATION_TAG])];
}

export function resolveGraphResourceAccess(
  graph: { appRoles: GraphPermission[]; oauth2PermissionScopes: GraphPermission[] },
  values: readonly string[],
  type: "Role" | "Scope",
): Array<{ id: string; type: "Role" | "Scope" }> {
  const source = type === "Role" ? graph.appRoles : graph.oauth2PermissionScopes;
  return values.map((value) => {
    const permission = source.find((candidate) =>
      candidate.value === value && (type === "Scope" || candidate.allowedMemberTypes?.includes("Application")),
    );
    if (!permission) throw new Error(`Microsoft Graph ${type} permission is unavailable: ${value}`);
    return { id: permission.id, type };
  });
}
