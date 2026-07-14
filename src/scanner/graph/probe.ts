import type { GraphPilotConfig } from "./config";
import { GraphClient } from "./graph-client";
import type { GraphCollection, GraphDrive } from "./types";

type GraphSite = {
  id: string;
  displayName?: string;
  webUrl?: string;
};

export type GraphPilotProbeResult = {
  siteId: string;
  displayName?: string;
  webUrl?: string;
  documentLibraryCount: number;
};

export async function probeGraphPilotAccess(
  graph: GraphClient,
  config: GraphPilotConfig,
): Promise<GraphPilotProbeResult> {
  const site = await graph.request<GraphSite>(
    `/sites/${encodeURIComponent(config.allowedSiteId)}?$select=id,displayName,webUrl`,
  );
  if (site.id !== config.allowedSiteId) {
    throw new Error("Microsoft Graph returned a Site outside the configured P4 allowlist");
  }

  let next: string | undefined = `/sites/${encodeURIComponent(config.allowedSiteId)}/drives?$select=id,driveType`;
  let documentLibraryCount = 0;
  while (next) {
    const page: GraphCollection<GraphDrive> = await graph.request(next);
    documentLibraryCount += page.value.filter(
      (drive) => !drive.driveType || drive.driveType === "documentLibrary",
    ).length;
    next = page["@odata.nextLink"];
  }

  return {
    siteId: site.id,
    displayName: site.displayName,
    webUrl: site.webUrl,
    documentLibraryCount,
  };
}
