import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
  type Timer,
} from "@azure/functions";
import {
  DefaultAzureCredential,
  ManagedIdentityCredential,
  type TokenCredential,
} from "@azure/identity";
import { QueueClient } from "@azure/storage-queue";
import { createMicrosoftGraphPilotScanner } from "../../../src/scanner/graph/create-pilot-scanner";
import { createGraphTokenProvider } from "../../../src/scanner/graph/auth";
import { loadGraphPilotConfig } from "../../../src/scanner/graph/config";
import { GraphClient } from "../../../src/scanner/graph/graph-client";
import {
  countTenantFiles,
  discoverTenantSites,
} from "../../../src/scanner/graph/tenant-discovery";
import { buildTenantCandidateManifest } from "../../../src/scanner/graph/tenant-manifest";
import { reviewBaselineWave } from "../../../src/scanner/graph/wave-review";
import type {
  ScanJobQueue,
  ScheduledScannerLogger,
  ScheduledScanJob,
} from "../../../src/scanner/scheduled/contracts";
import {
  ScheduledScanScheduler,
  ScheduledScanWorker,
} from "../../../src/scanner/scheduled/orchestrator";
import { createAzureTableCredential } from "../../../src/stores/azure-table/auth";
import { loadAzureTableStoreConfig } from "../../../src/stores/azure-table/config";
import { createAzureTableStores } from "../../../src/stores/azure-table/stores";

const QUEUE_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;
const JOB_QUEUE_NAME = process.env.SCANNER_JOB_QUEUE_NAME?.trim() || "sensitivity-scan-jobs";
if (!QUEUE_NAME_PATTERN.test(JOB_QUEUE_NAME)) {
  throw new Error("SCANNER_JOB_QUEUE_NAME is invalid");
}

class InvocationLogger implements ScheduledScannerLogger {
  constructor(private readonly context: InvocationContext) {}
  info(event: string, details: Record<string, unknown>) { this.context.log({ event, ...details }); }
  warn(event: string, details: Record<string, unknown>) { this.context.warn({ event, ...details }); }
  error(event: string, details: Record<string, unknown>) { this.context.error({ event, ...details }); }
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function queueCredential(): TokenCredential {
  const clientId = process.env.SCANNER_HOST_MANAGED_IDENTITY_CLIENT_ID?.trim();
  return clientId
    ? new ManagedIdentityCredential(clientId)
    : new DefaultAzureCredential({ tenantId: required("AZURE_STORAGE_TENANT_ID") });
}

class AzureScanJobQueue implements ScanJobQueue {
  private readonly client: QueueClient;

  constructor() {
    const accountName = required("SCANNER_HOST_STORAGE_ACCOUNT_NAME");
    this.client = new QueueClient(
      `https://${accountName}.queue.core.windows.net/${JOB_QUEUE_NAME}`,
      queueCredential(),
    );
  }

  async enqueue(job: ScheduledScanJob) {
    await this.client.sendMessage(JSON.stringify(job));
  }

  async approximateMessageCount() {
    return (await this.client.getProperties()).approximateMessagesCount ?? 0;
  }
}

function runtime(context: InvocationContext) {
  const graphConfig = loadGraphPilotConfig(process.env);
  const tableConfig = loadAzureTableStoreConfig(process.env);
  const tableCredential = createAzureTableCredential(tableConfig.auth);
  const stores = createAzureTableStores({
    config: tableConfig,
    credential: tableCredential,
    tenantId: graphConfig.tenantId,
  });
  const logger = new InvocationLogger(context);
  const executor = createMicrosoftGraphPilotScanner({
    env: process.env,
    ...stores,
    logger,
  });
  return {
    graphConfig,
    scheduler: new ScheduledScanScheduler({
      siteStore: stores.siteStore,
      scanRunStore: stores.scanRunStore,
      queue: new AzureScanJobQueue(),
      logger,
    }),
    worker: new ScheduledScanWorker({
      tenantId: graphConfig.tenantId,
      reportableLabelIds: graphConfig.reportableLabelIds,
      siteStore: stores.siteStore,
      inventoryStore: stores.inventoryStore,
      scanRunStore: stores.scanRunStore,
      siteSummaryStore: stores.siteSummaryStore,
      executor,
      logger,
    }),
  };
}

function baselineWindowIsOpen() {
  return process.env.SCANNER_BASELINE_WINDOW_OPEN?.trim().toLowerCase() === "true"
    && process.env["AzureWebJobs.nightlySchedule.Disabled"]?.trim().toLowerCase() === "true"
    && process.env["AzureWebJobs.weeklyReconciliation.Disabled"]?.trim().toLowerCase() === "true";
}

export async function nightlyTimerHandler(timer: Timer, context: InvocationContext) {
  context.log({ event: "scanner.timer.started", trigger: "schedule", pastDue: timer.isPastDue });
  return runtime(context).scheduler.enqueueScheduled("schedule");
}

export async function reconciliationTimerHandler(timer: Timer, context: InvocationContext) {
  context.log({ event: "scanner.timer.started", trigger: "reconciliation", pastDue: timer.isPastDue });
  return runtime(context).scheduler.enqueueScheduled("reconciliation");
}

export async function scanQueueHandler(message: unknown, context: InvocationContext) {
  return runtime(context).worker.process(message);
}

export async function runNowHandler(
  _request: unknown,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    const siteId = loadGraphPilotConfig(process.env).allowedSiteId;
    const queued = await runtime(context).scheduler.enqueueManual(siteId, "pilot-function-key");
    return {
      status: 202,
      jsonBody: { runId: queued.id, status: queued.status },
      headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    };
  } catch (error) {
    context.error({
      event: "scanner.manual.failed",
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return {
      status: 503,
      jsonBody: { error: "queue-unavailable" },
      headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    };
  }
}

export async function runBaselineNextHandler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const wave = Number(request.query.get("wave"));
  try {
    if (!Number.isInteger(wave) || wave < 1 || wave > 1_000) {
      return {
        status: 400,
        jsonBody: { error: "invalid-baseline-wave" },
        headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
      };
    }
    const current = runtime(context);
    if (current.graphConfig.scopeMode !== "registry" || !baselineWindowIsOpen()) {
      return {
        status: 409,
        jsonBody: { error: "baseline-window-closed" },
        headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
      };
    }
    const result = await current.scheduler.advanceBaselineWave({
      wave,
      maxSites: 10,
      requestedBy: `baseline-wave-${wave}-function-key`,
    });
    context.log({
      event: "scanner.baseline.advanced",
      wave,
      state: result.state,
      runId: result.runId,
      status: result.status,
      completedSiteCount: result.completedSiteCount,
      skippedSiteCount: result.skippedSiteCount,
      totalSiteCount: result.totalSiteCount,
    });
    return {
      status: result.state === "queued" || result.state === "in-progress" ? 202 : 200,
      jsonBody: result,
      headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    };
  } catch (error) {
    context.error({
      event: "scanner.baseline.failed",
      wave,
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return {
      status: 503,
      jsonBody: { error: "baseline-unavailable" },
      headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    };
  }
}

export async function queueStatusHandler(
  _request: unknown,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    const messageCount = await new AzureScanJobQueue().approximateMessageCount();
    context.log({ event: "scanner.queue_status.completed", messageCount });
    return {
      status: 200,
      jsonBody: { messageCount },
      headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    };
  } catch (error) {
    context.error({
      event: "scanner.queue_status.failed",
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return {
      status: 503,
      jsonBody: { error: "queue-status-unavailable" },
      headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    };
  }
}

export async function consentCompleteHandler(): Promise<HttpResponseInit> {
  return {
    status: 200,
    body: "Admin consent flow returned successfully. You can close this window and return to the operator.",
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  };
}

export async function discoverSitesHandler(
  _request: unknown,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    const config = loadGraphPilotConfig(process.env);
    const logger = new InvocationLogger(context);
    const result = await discoverTenantSites({
      graph: new GraphClient({
        tokenProvider: createGraphTokenProvider(config.auth),
        logger,
        maxRetries: config.maxRetries,
      }),
      maxPages: 100,
      maxLibraryPagesPerSite: 20,
      maxConcurrency: config.maxConcurrency,
    });
    context.log({ event: "scanner.discovery.completed", ...result });
    return {
      status: 200,
      jsonBody: result,
      headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    };
  } catch (error) {
    context.error({
      event: "scanner.discovery.failed",
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return {
      status: 503,
      jsonBody: { error: "discovery-unavailable" },
      headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    };
  }
}

export async function countTenantFilesHandler(
  _request: unknown,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    const config = loadGraphPilotConfig(process.env);
    const logger = new InvocationLogger(context);
    const result = await countTenantFiles({
      graph: new GraphClient({
        tokenProvider: createGraphTokenProvider(config.auth),
        logger,
        maxRetries: config.maxRetries,
      }),
      maxSitePages: 100,
      maxLibraryPagesPerSite: 20,
      maxItemPagesPerLibrary: 1_000,
      maxConcurrency: config.maxConcurrency,
    });
    context.log({ event: "scanner.file_count.completed", ...result });
    return {
      status: 200,
      jsonBody: result,
      headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    };
  } catch (error) {
    context.error({
      event: "scanner.file_count.failed",
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return {
      status: 503,
      jsonBody: { error: "file-count-unavailable" },
      headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    };
  }
}

export async function buildCandidateManifestHandler(
  _request: unknown,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    const config = loadGraphPilotConfig(process.env);
    const tableConfig = loadAzureTableStoreConfig(process.env);
    const stores = createAzureTableStores({
      config: tableConfig,
      credential: createAzureTableCredential(tableConfig.auth),
      tenantId: config.tenantId,
    });
    const logger = new InvocationLogger(context);
    const result = await buildTenantCandidateManifest({
      graph: new GraphClient({
        tokenProvider: createGraphTokenProvider(config.auth),
        logger,
        maxRetries: config.maxRetries,
      }),
      siteStore: stores.siteStore,
      pilotSiteId: config.allowedSiteId,
      maxSitePages: 100,
      maxLibraryPagesPerSite: 20,
      maxSitesPerWave: 10,
      maxCandidates: 2_000,
      maxConcurrency: config.maxConcurrency,
    });
    context.log({ event: "scanner.candidate_manifest.completed", ...result });
    return {
      status: 200,
      jsonBody: result,
      headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    };
  } catch (error) {
    context.error({
      event: "scanner.candidate_manifest.failed",
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return {
      status: 503,
      jsonBody: { error: "candidate-manifest-unavailable" },
      headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    };
  }
}

export async function reviewWaveOneHandler(
  _request: unknown,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    const config = loadGraphPilotConfig(process.env);
    const tableConfig = loadAzureTableStoreConfig(process.env);
    const stores = createAzureTableStores({
      config: tableConfig,
      credential: createAzureTableCredential(tableConfig.auth),
      tenantId: config.tenantId,
    });
    const logger = new InvocationLogger(context);
    const result = await reviewBaselineWave({
      graph: new GraphClient({
        tokenProvider: createGraphTokenProvider(config.auth),
        logger,
        maxRetries: config.maxRetries,
      }),
      siteStore: stores.siteStore,
      wave: 1,
      maxSites: 10,
      maxLibraryPagesPerSite: 20,
      maxConcurrency: config.maxConcurrency,
    });
    context.log({
      event: "scanner.wave_review.completed",
      wave: result.wave,
      siteCount: result.siteCount,
      libraryCount: result.libraryCount,
    });
    return {
      status: 200,
      jsonBody: result,
      headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    };
  } catch (error) {
    context.error({
      event: "scanner.wave_review.failed",
      wave: 1,
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return {
      status: 503,
      jsonBody: { error: "wave-review-unavailable" },
      headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    };
  }
}

app.timer("nightlySchedule", {
  schedule: "%SCANNER_NIGHTLY_SCHEDULE%",
  runOnStartup: false,
  handler: nightlyTimerHandler,
});

app.timer("weeklyReconciliation", {
  schedule: "%SCANNER_RECONCILIATION_SCHEDULE%",
  runOnStartup: false,
  handler: reconciliationTimerHandler,
});

app.storageQueue("processSiteScan", {
  queueName: JOB_QUEUE_NAME,
  connection: "AzureWebJobsStorage",
  handler: scanQueueHandler,
});

app.http("runNow", {
  methods: ["POST"],
  authLevel: "function",
  route: "scanner/run-now",
  handler: runNowHandler,
});

app.http("runBaselineNext", {
  methods: ["POST"],
  authLevel: "function",
  route: "scanner/run-baseline-next",
  handler: runBaselineNextHandler,
});

app.http("queueStatus", {
  methods: ["GET"],
  authLevel: "function",
  route: "scanner/queue-status",
  handler: queueStatusHandler,
});

app.http("consentComplete", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "scanner/admin-consent-complete",
  handler: consentCompleteHandler,
});

app.http("discoverSites", {
  methods: ["POST"],
  authLevel: "function",
  route: "scanner/discover-sites",
  handler: discoverSitesHandler,
});

app.http("countTenantFiles", {
  methods: ["POST"],
  authLevel: "function",
  route: "scanner/count-files",
  handler: countTenantFilesHandler,
});

app.http("buildCandidateManifest", {
  methods: ["POST"],
  authLevel: "function",
  route: "scanner/build-candidate-manifest",
  handler: buildCandidateManifestHandler,
});

app.http("reviewWaveOne", {
  methods: ["POST"],
  authLevel: "function",
  route: "scanner/review-wave-1",
  handler: reviewWaveOneHandler,
});
