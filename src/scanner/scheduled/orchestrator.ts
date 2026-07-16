import { buildSiteSensitivitySummary } from "../../domain/site-summary";
import type { SensitivityScanRun } from "../../domain/types";
import type {
  InventoryStore,
  ScanRunStore,
  SiteStore,
  SiteSummaryStore,
} from "../../stores/contracts";
import type { SensitivityScanExecutor } from "../contracts";
import type {
  ScanJobQueue,
  ScheduledScannerLogger,
  ScheduledScanTrigger,
} from "./contracts";
import { selectBaselineWave } from "./baseline-rollout";
import {
  baselineRunId,
  manualRunId,
  parseScheduledScanJob,
  scheduledRunId,
} from "./job";

export type BaselineAdvanceResult = {
  state: "queued" | "in-progress" | "review-required" | "stopped" | "complete";
  completedSiteCount: number;
  skippedSiteCount: number;
  totalSiteCount: number;
  runId?: string;
  status?: SensitivityScanRun["status"];
  scannedCount?: number;
  sensitiveCount?: number;
  lockedCount?: number;
  throttledCount?: number;
  unsupportedCount?: number;
  failedCount?: number;
};

const TERMINAL_DUPLICATE_STATUSES = new Set<SensitivityScanRun["status"]>([
  "succeeded",
  "partial",
  "cancelled",
]);

function emptyQueuedRun(input: {
  runId: string;
  trigger: ScheduledScanTrigger;
  siteId: string;
}): SensitivityScanRun {
  return {
    id: input.runId,
    trigger: input.trigger,
    status: "queued",
    targetSiteIds: [input.siteId],
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

export class ScheduledScanScheduler {
  constructor(private readonly dependencies: {
    siteStore: SiteStore;
    scanRunStore: ScanRunStore;
    queue: ScanJobQueue;
    logger?: ScheduledScannerLogger;
    now?: () => Date;
  }) {}

  async enqueueScheduled(
    trigger: Exclude<ScheduledScanTrigger, "manual">,
    scheduledFor = (this.dependencies.now ?? (() => new Date()))(),
  ) {
    const sites = await this.dependencies.siteStore.listScanEnabled();
    let enqueued = 0;
    let skipped = 0;
    let failed = 0;

    for (const site of sites) {
      const runId = scheduledRunId({ trigger, scheduledFor, siteId: site.id });
      const existing = await this.dependencies.scanRunStore.get(runId);
      if (existing && existing.status !== "failed") {
        skipped += 1;
        continue;
      }
      const queuedAt = (this.dependencies.now ?? (() => new Date()))().toISOString();
      const queued = emptyQueuedRun({ runId, trigger, siteId: site.id });
      await this.dependencies.scanRunStore.save(queued);
      try {
        await this.dependencies.queue.enqueue({
          version: 1,
          runId,
          trigger,
          siteId: site.id,
          queuedAt,
        });
        enqueued += 1;
      } catch (error) {
        failed += 1;
        await this.dependencies.scanRunStore.save({
          ...queued,
          status: "failed",
          finishedAt: (this.dependencies.now ?? (() => new Date()))().toISOString(),
          failedCount: 1,
          errorSummary: "Queue enqueue failed",
        });
        this.dependencies.logger?.error("scanner.schedule.enqueue-failed", {
          runId,
          siteId: site.id,
          errorType: error instanceof Error ? error.name : "UnknownError",
        });
      }
    }

    this.dependencies.logger?.info("scanner.schedule.completed", {
      trigger,
      siteCount: sites.length,
      enqueued,
      skipped,
      failed,
    });
    return { siteCount: sites.length, enqueued, skipped, failed };
  }

  async enqueueManual(siteId: string, requestedBy?: string) {
    const site = await this.dependencies.siteStore.get(siteId);
    if (!site || !site.active || !site.scanEnabled) {
      throw new Error("Manual scan target is missing, inactive or disabled");
    }
    const runId = manualRunId();
    const queuedAt = (this.dependencies.now ?? (() => new Date()))().toISOString();
    const queued = emptyQueuedRun({ runId, trigger: "manual", siteId });
    await this.dependencies.scanRunStore.save(queued);
    try {
      await this.dependencies.queue.enqueue({
        version: 1,
        runId,
        trigger: "manual",
        siteId,
        queuedAt,
        requestedBy,
      });
    } catch (error) {
      await this.dependencies.scanRunStore.save({
        ...queued,
        status: "failed",
        finishedAt: (this.dependencies.now ?? (() => new Date()))().toISOString(),
        failedCount: 1,
        errorSummary: "Queue enqueue failed",
      });
      throw error;
    }
    this.dependencies.logger?.info("scanner.manual.queued", { runId, siteId });
    return queued;
  }

  async advanceBaselineWave(input: {
    wave: number;
    maxSites: number;
    requestedBy?: string;
  }): Promise<BaselineAdvanceResult> {
    const sites = selectBaselineWave({
      sites: await this.dependencies.siteStore.listByBaselineWave(input.wave),
      wave: input.wave,
      maxSites: input.maxSites,
    });

    let completedSiteCount = 0;
    let skippedSiteCount = 0;
    for (const site of sites) {
      if (site.baselineState === "skipped") {
        skippedSiteCount += 1;
        continue;
      }
      const runId = baselineRunId({ wave: input.wave, siteId: site.id });
      const existing = await this.dependencies.scanRunStore.get(runId);
      if (!existing) {
        const queuedAt = (this.dependencies.now ?? (() => new Date()))().toISOString();
        const queued = emptyQueuedRun({ runId, trigger: "manual", siteId: site.id });
        await this.dependencies.scanRunStore.save(queued);
        try {
          await this.dependencies.queue.enqueue({
            version: 1,
            runId,
            trigger: "manual",
            siteId: site.id,
            queuedAt,
            requestedBy: input.requestedBy,
          });
        } catch (error) {
          await this.dependencies.scanRunStore.save({
            ...queued,
            status: "failed",
            finishedAt: (this.dependencies.now ?? (() => new Date()))().toISOString(),
            failedCount: 1,
            errorSummary: "Queue enqueue failed",
          });
          throw error;
        }
        this.dependencies.logger?.info("scanner.baseline.queued", {
          wave: input.wave,
          runId,
          completedSiteCount,
          skippedSiteCount,
          totalSiteCount: sites.length,
        });
        return {
          state: "queued",
          runId,
          status: queued.status,
          completedSiteCount,
          skippedSiteCount,
          totalSiteCount: sites.length,
        };
      }

      const result = {
        runId,
        status: existing.status,
        completedSiteCount,
        skippedSiteCount,
        totalSiteCount: sites.length,
        scannedCount: existing.scannedCount,
        sensitiveCount: existing.sensitiveCount,
        lockedCount: existing.lockedCount,
        throttledCount: existing.throttledCount,
        unsupportedCount: existing.unsupportedCount,
        failedCount: existing.failedCount,
      };
      if (existing.status === "queued" || existing.status === "running") {
        return { state: "in-progress", ...result };
      }
      if (existing.status === "failed"
        || existing.status === "cancelled"
        || existing.failedCount > 0
        || existing.throttledCount > 0) {
        return { state: "stopped", ...result };
      }
      if (existing.status === "partial"
        || existing.lockedCount > 0
        || existing.unsupportedCount > 0) {
        return { state: "review-required", ...result };
      }
      if (existing.status !== "succeeded") {
        return { state: "stopped", ...result };
      }
      if (site.baselineState !== "completed") {
        await this.dependencies.siteStore.save({ ...site, baselineState: "completed" });
      }
      completedSiteCount += 1;
    }

    return {
      state: "complete",
      completedSiteCount,
      skippedSiteCount,
      totalSiteCount: sites.length,
    };
  }
}

export class ScheduledScanWorker {
  constructor(private readonly dependencies: {
    tenantId: string;
    reportableLabelIds: ReadonlySet<string>;
    siteStore: SiteStore;
    inventoryStore: InventoryStore;
    scanRunStore: ScanRunStore;
    siteSummaryStore: SiteSummaryStore;
    executor: SensitivityScanExecutor;
    logger?: ScheduledScannerLogger;
    now?: () => Date;
  }) {}

  async process(message: unknown) {
    const job = parseScheduledScanJob(message);
    const existing = await this.dependencies.scanRunStore.get(job.runId);
    if (existing && TERMINAL_DUPLICATE_STATUSES.has(existing.status)) {
      this.dependencies.logger?.info("scanner.job.duplicate-skipped", {
        runId: job.runId,
        siteId: job.siteId,
        status: existing.status,
      });
      return existing;
    }

    const site = await this.dependencies.siteStore.get(job.siteId);
    if (!site || !site.active || !site.scanEnabled) {
      const failed = {
        ...emptyQueuedRun(job),
        status: "failed" as const,
        finishedAt: (this.dependencies.now ?? (() => new Date()))().toISOString(),
        failedCount: 1,
        errorSummary: "Scan target is missing, inactive or disabled",
      };
      await this.dependencies.scanRunStore.save(failed);
      throw new Error("Scan target is missing, inactive or disabled");
    }

    const result = await this.dependencies.executor.execute({
      runId: job.runId,
      trigger: job.trigger,
      target: site,
    });
    if (result.status === "failed") {
      throw new Error("Site scan failed");
    }

    const items = await this.dependencies.inventoryStore.listCurrentBySiteIds([site.id]);
    await this.dependencies.siteSummaryStore.save(buildSiteSensitivitySummary({
      tenantId: this.dependencies.tenantId,
      siteId: site.id,
      siteName: site.name,
      siteWebUrl: `https://${site.hostname}${site.path}`,
      items,
      reportableLabelIds: this.dependencies.reportableLabelIds,
      latestRunId: result.id,
      updatedAt: (this.dependencies.now ?? (() => new Date()))().toISOString(),
    }));
    this.dependencies.logger?.info("scanner.job.completed", {
      runId: result.id,
      siteId: site.id,
      status: result.status,
      scannedCount: result.scannedCount,
      sensitiveCount: result.sensitiveCount,
      failedItemCount: result.failedCount
        + result.lockedCount
        + result.throttledCount
        + result.unsupportedCount,
    });
    return result;
  }
}
