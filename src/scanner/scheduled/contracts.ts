import type { SensitivityScanRun } from "../../domain/types";

export type ScheduledScanTrigger = SensitivityScanRun["trigger"];

export type ScheduledScanJob = {
  version: 1;
  runId: string;
  trigger: ScheduledScanTrigger;
  siteId: string;
  queuedAt: string;
  requestedBy?: string;
};

export interface ScanJobQueue {
  enqueue(job: ScheduledScanJob): Promise<void>;
}

export interface ScheduledScannerLogger {
  info(event: string, details: Record<string, unknown>): void;
  warn(event: string, details: Record<string, unknown>): void;
  error(event: string, details: Record<string, unknown>): void;
}

