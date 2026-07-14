import type { GovernedSharePointSite, SensitivityScanRun } from "../domain/types";

export type ScanTarget = {
  siteId: string;
  driveIds?: string[];
};

export type QueueScanRequest = {
  trigger: "schedule" | "manual" | "reconciliation";
  targets: ScanTarget[];
  requestedBy?: string;
};

export interface SensitivityScanner {
  queue(request: QueueScanRequest): Promise<SensitivityScanRun>;
}

export function scheduledScanTargets(sites: GovernedSharePointSite[]): ScanTarget[] {
  return [
    ...new Set(
      sites
        .filter((site) => site.active && site.scanEnabled)
        .map((site) => site.id),
    ),
  ].map((siteId) => ({ siteId }));
}
