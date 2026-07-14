import type { SensitivityScanRun } from "../domain/types";

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
