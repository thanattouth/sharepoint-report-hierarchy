import assert from "node:assert/strict";
import test from "node:test";
import type {
  GovernedSharePointSite,
  SensitivityInventoryItem,
  SensitivityScanRun,
  SiteSensitivitySummary,
} from "../src/domain/types";
import type {
  InventoryStore,
  ScanRunStore,
  SiteStore,
  SiteSummaryStore,
} from "../src/stores/contracts";
import type { SensitivityScanExecutor } from "../src/scanner/contracts";
import type { ScanJobQueue, ScheduledScanJob } from "../src/scanner/scheduled/contracts";
import { baselineRunId, scheduledRunId } from "../src/scanner/scheduled/job";
import {
  ScheduledScanScheduler,
  ScheduledScanWorker,
} from "../src/scanner/scheduled/orchestrator";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const SITE: GovernedSharePointSite = {
  id: "contoso.sharepoint.com,site-collection,site-web",
  name: "DGCS",
  hostname: "contoso.sharepoint.com",
  path: "/sites/DGCS",
  active: true,
  scanEnabled: true,
};

function run(job: Pick<ScheduledScanJob, "runId" | "trigger" | "siteId">, status: SensitivityScanRun["status"] = "queued"): SensitivityScanRun {
  return {
    id: job.runId,
    trigger: job.trigger,
    status,
    targetSiteIds: [job.siteId],
    scannedCount: 0,
    changedCount: 0,
    sensitiveCount: 0,
    noLabelCount: 0,
    lockedCount: 0,
    throttledCount: 0,
    unsupportedCount: 0,
    failedCount: 0,
  };
}

class MemoryRunStore implements ScanRunStore {
  values = new Map<string, SensitivityScanRun>();
  async get(runId: string) { return structuredClone(this.values.get(runId) ?? null); }
  async listRecent() { return structuredClone([...this.values.values()]); }
  async save(value: SensitivityScanRun) { this.values.set(value.id, structuredClone(value)); }
}

class MemorySiteStore implements SiteStore {
  constructor(readonly sites = [SITE]) {}
  async get(siteId: string) { return structuredClone(this.sites.find((site) => site.id === siteId) ?? null); }
  async listScanEnabled() { return structuredClone(this.sites.filter((site) => site.active && site.scanEnabled)); }
  async listByBaselineWave(wave: number) { return structuredClone(this.sites.filter((site) => site.baselineWave === wave)); }
  async save() {}
}

class MemoryQueue implements ScanJobQueue {
  jobs: ScheduledScanJob[] = [];
  async enqueue(job: ScheduledScanJob) { this.jobs.push(structuredClone(job)); }
}

class MemoryInventoryStore implements InventoryStore {
  items: SensitivityInventoryItem[] = [];
  async listCurrentBySiteIds(siteIds: string[]) { return structuredClone(this.items.filter((item) => siteIds.includes(item.siteId))); }
  async applyChanges() {}
}

class MemorySummaryStore implements SiteSummaryStore {
  summaries: SiteSensitivitySummary[] = [];
  async listBySiteIds(siteIds: string[]) { return structuredClone(this.summaries.filter((item) => siteIds.includes(item.siteId))); }
  async save(summary: SiteSensitivitySummary) { this.summaries.push(structuredClone(summary)); }
}

test("timer enqueues one deterministic job per active scan-enabled Site and is idempotent", async () => {
  const runStore = new MemoryRunStore();
  const queue = new MemoryQueue();
  const at = new Date("2026-07-16T18:00:00.000Z");
  const scheduler = new ScheduledScanScheduler({
    siteStore: new MemorySiteStore([
      SITE,
      { ...SITE, id: "disabled", scanEnabled: false },
      { ...SITE, id: "inactive", active: false },
    ]),
    scanRunStore: runStore,
    queue,
    now: () => at,
  });

  assert.deepEqual(await scheduler.enqueueScheduled("schedule", at), {
    siteCount: 1,
    enqueued: 1,
    skipped: 0,
    failed: 0,
  });
  assert.equal(queue.jobs.length, 1);
  assert.equal(queue.jobs[0].runId, scheduledRunId({ trigger: "schedule", scheduledFor: at, siteId: SITE.id }));
  assert.deepEqual(await scheduler.enqueueScheduled("schedule", at), {
    siteCount: 1,
    enqueued: 0,
    skipped: 1,
    failed: 0,
  });
});

test("Run now queues one exact Site and returns without executing the scanner", async () => {
  const runStore = new MemoryRunStore();
  const queue = new MemoryQueue();
  const scheduler = new ScheduledScanScheduler({
    siteStore: new MemorySiteStore(),
    scanRunStore: runStore,
    queue,
    now: () => new Date("2026-07-16T10:00:00.000Z"),
  });

  const queued = await scheduler.enqueueManual(SITE.id, "pilot-function-key");

  assert.equal(queued.status, "queued");
  assert.equal(queue.jobs[0].siteId, SITE.id);
  assert.equal(queue.jobs[0].trigger, "manual");
  assert.equal(queue.jobs[0].requestedBy, "pilot-function-key");
  await assert.rejects(() => scheduler.enqueueManual("unknown"), /missing, inactive or disabled/);
});

test("baseline coordinator queues one deterministic approved Site at a time", async () => {
  const sites = ["b", "a"].map((id): GovernedSharePointSite => ({
    ...SITE,
    id,
    scanLibraryIds: [`drive-${id}`],
    baselineWave: 1,
    baselineState: "approved",
  }));
  const runStore = new MemoryRunStore();
  const queue = new MemoryQueue();
  const scheduler = new ScheduledScanScheduler({
    siteStore: new MemorySiteStore(sites),
    scanRunStore: runStore,
    queue,
    now: () => new Date("2026-07-16T10:00:00.000Z"),
  });

  const first = await scheduler.advanceBaselineWave({
    wave: 1,
    maxSites: 10,
    requestedBy: "baseline-test",
  });
  assert.equal(first.state, "queued");
  assert.equal(first.runId, baselineRunId({ wave: 1, siteId: "a" }));
  assert.equal(queue.jobs.length, 1);

  const duplicate = await scheduler.advanceBaselineWave({
    wave: 1,
    maxSites: 10,
  });
  assert.equal(duplicate.state, "in-progress");
  assert.equal(queue.jobs.length, 1);

  await runStore.save({ ...run(queue.jobs[0]), status: "succeeded" });
  const second = await scheduler.advanceBaselineWave({
    wave: 1,
    maxSites: 10,
  });
  assert.equal(second.state, "queued");
  assert.equal(second.runId, baselineRunId({ wave: 1, siteId: "b" }));
  assert.equal(queue.jobs.length, 2);
});

test("baseline coordinator stops before the next Site on partial or failed outcomes", async () => {
  const sites = ["a", "b"].map((id): GovernedSharePointSite => ({
    ...SITE,
    id,
    scanLibraryIds: [`drive-${id}`],
    baselineWave: 1,
    baselineState: "approved",
  }));
  const runStore = new MemoryRunStore();
  const queue = new MemoryQueue();
  const scheduler = new ScheduledScanScheduler({
    siteStore: new MemorySiteStore(sites),
    scanRunStore: runStore,
    queue,
  });
  const firstRunId = baselineRunId({ wave: 1, siteId: "a" });
  await runStore.save({
    ...run({ runId: firstRunId, trigger: "manual", siteId: "a" }),
    status: "partial",
    unsupportedCount: 1,
  });
  const result = await scheduler.advanceBaselineWave({
    wave: 1,
    maxSites: 10,
  });
  assert.equal(result.state, "review-required");
  assert.equal(queue.jobs.length, 0);

  await runStore.save({
    ...run({ runId: firstRunId, trigger: "manual", siteId: "a" }),
    status: "succeeded",
    throttledCount: 1,
  });
  const throttled = await scheduler.advanceBaselineWave({
    wave: 1,
    maxSites: 10,
  });
  assert.equal(throttled.state, "stopped");
  assert.equal(queue.jobs.length, 0);
});

test("baseline coordinator continues after an explicitly skipped Site", async () => {
  const sites: GovernedSharePointSite[] = [
    {
      ...SITE,
      id: "a",
      active: false,
      scanEnabled: false,
      scanLibraryIds: ["drive-a"],
      baselineWave: 1,
      baselineState: "skipped",
    },
    {
      ...SITE,
      id: "b",
      scanLibraryIds: ["drive-b"],
      baselineWave: 1,
      baselineState: "approved",
    },
  ];
  const queue = new MemoryQueue();
  const scheduler = new ScheduledScanScheduler({
    siteStore: new MemorySiteStore(sites),
    scanRunStore: new MemoryRunStore(),
    queue,
  });
  const result = await scheduler.advanceBaselineWave({ wave: 1, maxSites: 10 });
  assert.equal(result.state, "queued");
  assert.equal(result.skippedSiteCount, 1);
  assert.equal(queue.jobs[0].siteId, "b");
});

test("queue worker scans one Site, materializes its summary and skips a terminal duplicate", async () => {
  const runStore = new MemoryRunStore();
  const inventoryStore = new MemoryInventoryStore();
  const summaryStore = new MemorySummaryStore();
  const labelId = "22222222-2222-4222-8222-222222222222";
  inventoryStore.items = [{
    tenantId: TENANT_ID,
    siteId: SITE.id,
    driveId: "drive-secret",
    itemId: "item-1",
    siteName: SITE.name,
    libraryName: "Secret",
    fileName: "redacted.docx",
    filePath: "/redacted.docx",
    sensitivityLabels: [{ id: labelId, displayName: "Highly Confidential" }],
    scanStatus: "success",
    scannedAt: "2026-07-16T18:01:00.000Z",
  }];
  let executions = 0;
  const executor: SensitivityScanExecutor = {
    async execute(request) {
      executions += 1;
      const completed = {
        ...run({ runId: request.runId, trigger: request.trigger, siteId: request.target.id }),
        status: "succeeded" as const,
        scannedCount: 1,
        sensitiveCount: 1,
      };
      await runStore.save(completed);
      return completed;
    },
  };
  const worker = new ScheduledScanWorker({
    tenantId: TENANT_ID,
    reportableLabelIds: new Set([labelId]),
    siteStore: new MemorySiteStore(),
    inventoryStore,
    scanRunStore: runStore,
    siteSummaryStore: summaryStore,
    executor,
    now: () => new Date("2026-07-16T18:02:00.000Z"),
  });
  const job: ScheduledScanJob = {
    version: 1,
    runId: "schedule-20260716T180000000Z-test",
    trigger: "schedule",
    siteId: SITE.id,
    queuedAt: "2026-07-16T18:00:00.000Z",
  };

  const first = await worker.process(job);
  assert.equal(first.status, "succeeded");
  assert.equal(summaryStore.summaries[0].sensitiveCount, 1);
  assert.equal(summaryStore.summaries[0].latestRunId, job.runId);
  await worker.process(JSON.stringify(job));
  assert.equal(executions, 1);
});

test("queue worker fails closed for an unknown Site before executor access", async () => {
  let executed = false;
  const runStore = new MemoryRunStore();
  const worker = new ScheduledScanWorker({
    tenantId: TENANT_ID,
    reportableLabelIds: new Set(),
    siteStore: new MemorySiteStore([]),
    inventoryStore: new MemoryInventoryStore(),
    scanRunStore: runStore,
    siteSummaryStore: new MemorySummaryStore(),
    executor: { async execute() { executed = true; throw new Error("unexpected"); } },
  });
  await assert.rejects(() => worker.process({
    version: 1,
    runId: "schedule-safe",
    trigger: "schedule",
    siteId: SITE.id,
    queuedAt: "2026-07-16T18:00:00.000Z",
  }), /missing, inactive or disabled/);
  assert.equal(executed, false);
  assert.equal((await runStore.get("schedule-safe"))?.status, "failed");
});
