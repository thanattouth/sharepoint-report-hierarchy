import { createHash, randomUUID } from "node:crypto";
import type { ScheduledScanJob, ScheduledScanTrigger } from "./contracts";

const RUN_ID = /^[A-Za-z0-9._-]{1,160}$/;
const SITE_ID = /^[A-Za-z0-9,._=-]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function scheduledRunId(input: {
  trigger: Exclude<ScheduledScanTrigger, "manual">;
  scheduledFor: Date;
  siteId: string;
}) {
  const slot = input.scheduledFor.toISOString().replaceAll(/[-:.]/g, "");
  const siteHash = createHash("sha256").update(input.siteId).digest("hex").slice(0, 16);
  return `${input.trigger}-${slot}-${siteHash}`;
}

export function manualRunId() {
  return `manual-${randomUUID()}`;
}

export function baselineRunId(input: { wave: number; siteId: string }) {
  if (!Number.isInteger(input.wave) || input.wave < 1) {
    throw new Error("Baseline wave must be a positive integer");
  }
  const siteHash = createHash("sha256").update(input.siteId).digest("hex").slice(0, 16);
  return `baseline-w${input.wave}-${siteHash}`;
}

export function parseScheduledScanJob(value: unknown): ScheduledScanJob {
  const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
  if (!isRecord(parsed) || parsed.version !== 1) throw new Error("Unsupported scan job version");
  if (typeof parsed.runId !== "string" || !RUN_ID.test(parsed.runId)) {
    throw new Error("Scan job runId is invalid");
  }
  if (parsed.trigger !== "schedule" && parsed.trigger !== "manual" && parsed.trigger !== "reconciliation") {
    throw new Error("Scan job trigger is invalid");
  }
  if (typeof parsed.siteId !== "string" || !SITE_ID.test(parsed.siteId)) {
    throw new Error("Scan job siteId is invalid");
  }
  if (typeof parsed.queuedAt !== "string" || Number.isNaN(Date.parse(parsed.queuedAt))) {
    throw new Error("Scan job queuedAt is invalid");
  }
  if (parsed.requestedBy !== undefined && typeof parsed.requestedBy !== "string") {
    throw new Error("Scan job requestedBy is invalid");
  }
  return parsed as ScheduledScanJob;
}
