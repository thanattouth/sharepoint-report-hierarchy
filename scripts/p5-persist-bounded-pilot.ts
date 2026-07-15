import { randomUUID } from "node:crypto";
import { buildSiteSensitivitySummary } from "../src/domain/site-summary";
import type {
  ScanStatus,
  SensitivityInventoryItem,
  SensitivityScanRun,
} from "../src/domain/types";
import {
  AzureIdentityGraphTokenProvider,
  createAzureCredential,
} from "../src/scanner/graph/auth";
import {
  runBoundedPilot,
  type BoundedPilotLibraryResult,
  type BoundedPilotOutcome,
} from "../src/scanner/graph/bounded-pilot";
import { loadGraphPilotConfig } from "../src/scanner/graph/config";
import { GraphClient } from "../src/scanner/graph/graph-client";
import { probeGraphPilotAccess } from "../src/scanner/graph/probe";
import { createAzureTableCredential } from "../src/stores/azure-table/auth";
import { loadAzureTableStoreConfig } from "../src/stores/azure-table/config";
import { createAzureTableStores } from "../src/stores/azure-table/stores";

function positiveInteger(value: string | undefined, fallback: number, maximum: number, name: string) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`${name} must be an integer from 1 to ${maximum}`);
  }
  return parsed;
}

function count(outcomes: BoundedPilotOutcome[], status: ScanStatus) {
  return outcomes.filter((outcome) => outcome.status === status).length;
}

function inventoryItem(input: {
  tenantId: string;
  siteId: string;
  siteName: string;
  siteWebUrl?: string;
  scannedAt: string;
  outcome: BoundedPilotOutcome;
}): SensitivityInventoryItem {
  const { outcome } = input;
  return {
    tenantId: input.tenantId,
    siteId: input.siteId,
    driveId: outcome.driveId,
    itemId: outcome.itemId,
    siteName: input.siteName,
    siteWebUrl: input.siteWebUrl,
    libraryName: outcome.libraryName,
    fileName: outcome.fileName,
    filePath: outcome.filePath,
    fileWebUrl: outcome.fileWebUrl,
    modifiedAt: outcome.modifiedAt,
    sensitivityLabels: outcome.labels,
    scanStatus: outcome.status,
    scannedAt: input.scannedAt,
    errorCode: outcome.graphCode,
    errorMessage: outcome.graphMessage,
    graphRequestId: outcome.graphRequestId,
  };
}

const graphConfig = loadGraphPilotConfig(process.env);
const tableConfig = loadAzureTableStoreConfig(process.env);
const libraryNames = (process.env.P4_PILOT_LIBRARY_NAMES ?? "")
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);
const maxFilesPerLibrary = positiveInteger(
  process.env.P4_PILOT_MAX_FILES_PER_LIBRARY,
  20,
  20,
  "P4_PILOT_MAX_FILES_PER_LIBRARY",
);
const maxDeltaPagesPerLibrary = positiveInteger(
  process.env.P4_PILOT_MAX_DELTA_PAGES_PER_LIBRARY,
  10,
  10,
  "P4_PILOT_MAX_DELTA_PAGES_PER_LIBRARY",
);

const graphCredential = createAzureCredential(graphConfig.auth);
const tableCredential = createAzureTableCredential(tableConfig.auth);
const graph = new GraphClient({
  tokenProvider: new AzureIdentityGraphTokenProvider(graphCredential),
  maxRetries: graphConfig.maxRetries,
});
const { inventoryStore, scanRunStore, siteSummaryStore } = createAzureTableStores({
  config: tableConfig,
  credential: tableCredential,
  tenantId: graphConfig.tenantId,
});
const runId = `bounded-${randomUUID()}`;
const startedAt = new Date().toISOString();
const running: SensitivityScanRun = {
  id: runId,
  trigger: "manual",
  status: "running",
  startedAt,
  targetSiteIds: [graphConfig.allowedSiteId],
  scannedCount: 0,
  changedCount: 0,
  sensitiveCount: 0,
  noLabelCount: 0,
  lockedCount: 0,
  throttledCount: 0,
  unsupportedCount: 0,
  failedCount: 0,
};

await scanRunStore.save(running);

try {
  const site = await probeGraphPilotAccess(graph, graphConfig);
  const libraries: BoundedPilotLibraryResult[] = await runBoundedPilot({
    graph,
    config: graphConfig,
    libraryNames,
    maxFilesPerLibrary,
    maxDeltaPagesPerLibrary,
  });
  const outcomes = libraries.flatMap((library) => library.outcomes);
  const finishedAt = new Date().toISOString();
  const items = outcomes.map((outcome) => inventoryItem({
    tenantId: graphConfig.tenantId,
    siteId: graphConfig.allowedSiteId,
    siteName: site.displayName ?? graphConfig.allowedSiteId,
    siteWebUrl: site.webUrl,
    scannedAt: finishedAt,
    outcome,
  }));
  await inventoryStore.applyChanges({ upserts: items, deletions: [] });

  const sensitiveCount = outcomes.filter((outcome) =>
    outcome.labels.some((label) => graphConfig.reportableLabelIds.has(label.id)),
  ).length;
  const terminalFailures = count(outcomes, "locked")
    + count(outcomes, "throttled")
    + count(outcomes, "unsupported")
    + count(outcomes, "failed");
  const completed: SensitivityScanRun = {
    ...running,
    status: terminalFailures ? "partial" : "succeeded",
    finishedAt,
    scannedCount: outcomes.length,
    changedCount: items.length,
    sensitiveCount,
    noLabelCount: count(outcomes, "no-label"),
    lockedCount: count(outcomes, "locked"),
    throttledCount: count(outcomes, "throttled"),
    unsupportedCount: count(outcomes, "unsupported"),
    failedCount: count(outcomes, "failed"),
  };
  const persisted = await inventoryStore.listCurrentBySiteIds([graphConfig.allowedSiteId]);
  const summary = buildSiteSensitivitySummary({
    tenantId: graphConfig.tenantId,
    siteId: graphConfig.allowedSiteId,
    siteName: site.displayName ?? graphConfig.allowedSiteId,
    siteWebUrl: site.webUrl,
    items: persisted,
    reportableLabelIds: graphConfig.reportableLabelIds,
    latestRunId: runId,
    updatedAt: finishedAt,
  });
  await siteSummaryStore.save(summary);
  await scanRunStore.save(completed);

  const labelCounts = new Map<string, number>();
  for (const item of persisted) {
    for (const label of item.sensitivityLabels) {
      labelCounts.set(label.id, (labelCounts.get(label.id) ?? 0) + 1);
    }
  }
  process.stdout.write(`${JSON.stringify({
    status: "persisted",
    runId,
    siteId: graphConfig.allowedSiteId,
    libraries: libraries.map((library) => ({
      name: library.libraryName,
      selectedFileCount: library.selectedFileCount,
      truncated: library.truncated,
    })),
    outcomeCounts: {
      total: outcomes.length,
      sensitive: sensitiveCount,
      noLabel: completed.noLabelCount,
      locked: completed.lockedCount,
      throttled: completed.throttledCount,
      unsupported: completed.unsupportedCount,
      failed: completed.failedCount,
    },
    persistedCurrentCount: persisted.length,
    persistedSummary: {
      inventoryCount: summary.inventoryCount,
      sensitiveCount: summary.sensitiveCount,
      libraryCount: summary.libraryCount,
    },
    labelCounts: Object.fromEntries([...labelCounts].sort(([left], [right]) => left.localeCompare(right))),
  }, null, 2)}\n`);
} catch (error) {
  const failed: SensitivityScanRun = {
    ...running,
    status: "failed",
    finishedAt: new Date().toISOString(),
    failedCount: 1,
    errorSummary: error instanceof Error ? error.message.slice(0, 500) : "Unknown bounded pilot failure",
  };
  await scanRunStore.save(failed);
  throw error;
}
