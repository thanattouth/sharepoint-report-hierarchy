import type {
  GovernedSharePointSite,
  SensitivityScanRun,
} from "../../domain/types";
import type { ScanRunStore, SiteStore } from "../../stores/contracts";
import { baselineRunId } from "./job";

export type BaselineWaveDecision = {
  decision: "proceed" | "review" | "stop";
  reasons: string[];
};

export async function skipBaselineSite(input: {
  siteStore: SiteStore;
  scanRunStore: ScanRunStore;
  siteId: string;
  wave: number;
  reason: string;
  now?: () => Date;
}) {
  if (!input.siteId.trim()) throw new Error("Baseline skip Site ID is required");
  if (!Number.isInteger(input.wave) || input.wave < 1) {
    throw new Error("Baseline skip wave must be a positive integer");
  }
  if (!input.reason.trim() || input.reason.length > 100) {
    throw new Error("Baseline skip reason must contain 1 to 100 characters");
  }
  const site = await input.siteStore.get(input.siteId);
  if (!site || site.baselineWave !== input.wave) {
    throw new Error("Baseline skip Site is missing from the requested wave");
  }
  if (site.baselineState === "skipped" && !site.active && !site.scanEnabled) {
    return { skippedCount: 0, alreadySkippedCount: 1 };
  }
  if (!site.active || !site.scanEnabled || site.baselineState !== "approved") {
    throw new Error("Baseline skip target is not an active approved Site");
  }
  const run = await input.scanRunStore.get(baselineRunId({ wave: input.wave, siteId: site.id }));
  if (!run || run.targetSiteIds.length !== 1 || run.targetSiteIds[0] !== site.id) {
    throw new Error("Baseline skip target has no matching deterministic run");
  }
  const hasReviewableOutcome = run.status === "partial"
    || run.status === "failed"
    || run.status === "cancelled"
    || run.lockedCount > 0
    || run.throttledCount > 0
    || run.unsupportedCount > 0
    || run.failedCount > 0;
  if (!hasReviewableOutcome) {
    throw new Error("Baseline skip requires a terminal problem or review outcome");
  }
  await input.siteStore.save({
    ...site,
    active: false,
    scanEnabled: false,
    baselineState: "skipped",
    baselineSkipReason: input.reason.trim(),
    baselineSkippedAt: (input.now ?? (() => new Date()))().toISOString(),
  });
  return { skippedCount: 1, alreadySkippedCount: 0 };
}

export async function excludeBaselineCandidates(input: {
  siteStore: SiteStore;
  siteIds: string[];
  reason: string;
  now?: () => Date;
}) {
  if (input.siteIds.length < 1
    || input.siteIds.length > 10
    || new Set(input.siteIds).size !== input.siteIds.length
    || input.siteIds.some((siteId) => !siteId.trim())) {
    throw new Error("Baseline exclusion requires 1 to 10 unique non-empty Site IDs");
  }
  if (!input.reason.trim() || input.reason.length > 100) {
    throw new Error("Baseline exclusion reason must contain 1 to 100 characters");
  }
  const records = await Promise.all(input.siteIds.map(async (siteId) => ({
    siteId,
    site: await input.siteStore.get(siteId),
  })));
  let alreadyExcludedCount = 0;
  const toExclude: GovernedSharePointSite[] = [];
  for (const record of records) {
    const site = record.site;
    if (!site) throw new Error("Baseline exclusion Site is missing from the registry");
    if (site.baselineState === "excluded"
      && site.baselineWave === undefined
      && !site.active
      && !site.scanEnabled) {
      alreadyExcludedCount += 1;
      continue;
    }
    if (site.active || site.scanEnabled || site.baselineWave !== 1) {
      throw new Error("Baseline exclusion target is not a disabled Wave 1 candidate");
    }
    const candidate = { ...site };
    delete candidate.baselineWave;
    toExclude.push({
      ...candidate,
      baselineState: "excluded",
      baselineExclusionReason: input.reason.trim(),
      baselineExcludedAt: (input.now ?? (() => new Date()))().toISOString(),
    });
  }
  for (const site of toExclude) await input.siteStore.save(site);
  return {
    requestedCount: input.siteIds.length,
    excludedCount: toExclude.length,
    alreadyExcludedCount,
  };
}

export async function configureBaselineWaveCandidates(input: {
  siteStore: SiteStore;
  wave: number;
  siteIds: string[];
  exclusionReason: string;
  now?: () => Date;
}) {
  if (!Number.isInteger(input.wave) || input.wave < 1) {
    throw new Error("Baseline configuration wave must be a positive integer");
  }
  if (input.siteIds.length < 1
    || input.siteIds.length > 10
    || new Set(input.siteIds).size !== input.siteIds.length
    || input.siteIds.some((siteId) => !siteId.trim())) {
    throw new Error("Baseline configuration requires 1 to 10 unique non-empty Site IDs");
  }
  if (!input.exclusionReason.trim() || input.exclusionReason.length > 100) {
    throw new Error("Baseline configuration exclusion reason must contain 1 to 100 characters");
  }

  const selected = await Promise.all(input.siteIds.map((siteId) => input.siteStore.get(siteId)));
  if (selected.some((site) => !site)) {
    throw new Error("A selected baseline Site is missing from the registry");
  }
  for (const site of selected as GovernedSharePointSite[]) {
    if (site.active || site.scanEnabled || site.baselineState !== "candidate") {
      throw new Error("A selected baseline Site is not a disabled candidate");
    }
    if (!site.scanLibraryIds?.length
      || site.scanLibraryIds.some((driveId) => !driveId.trim())
      || new Set(site.scanLibraryIds).size !== site.scanLibraryIds.length) {
      throw new Error("A selected baseline Site has no valid exact library allowlist");
    }
  }

  const selectedIds = new Set(input.siteIds);
  const currentWave = await input.siteStore.listByBaselineWave(input.wave);
  const displaced = currentWave.filter((site) => !selectedIds.has(site.id));
  for (const site of displaced) {
    if (site.active || site.scanEnabled || site.baselineState !== "candidate") {
      throw new Error("A displaced baseline Site is not a disabled candidate");
    }
  }

  const occurredAt = (input.now ?? (() => new Date()))().toISOString();
  for (const site of displaced) {
    const updated = { ...site };
    delete updated.baselineWave;
    await input.siteStore.save({
      ...updated,
      baselineState: "excluded",
      baselineExclusionReason: input.exclusionReason.trim(),
      baselineExcludedAt: occurredAt,
    });
  }
  let selectedChangeCount = 0;
  for (const site of selected as GovernedSharePointSite[]) {
    if (site.baselineWave === input.wave) continue;
    await input.siteStore.save({ ...site, baselineWave: input.wave });
    selectedChangeCount += 1;
  }
  return {
    wave: input.wave,
    selectedSiteCount: input.siteIds.length,
    selectedChangeCount,
    displacedSiteCount: displaced.length,
  };
}

export function selectBaselineWave(input: {
  sites: GovernedSharePointSite[];
  wave: number;
  maxSites: number;
}) {
  if (!Number.isInteger(input.wave) || input.wave < 1) {
    throw new Error("Baseline wave must be a positive integer");
  }
  if (!Number.isInteger(input.maxSites) || input.maxSites < 1 || input.maxSites > 10) {
    throw new Error("Baseline maxSites must be an integer from 1 to 10");
  }
  const selected = input.sites
    .filter((site) => site.baselineWave === input.wave)
    .sort((left, right) => left.id.localeCompare(right.id));
  if (selected.length === 0) throw new Error("Baseline wave has no Sites");
  if (selected.length > input.maxSites) throw new Error("Baseline wave exceeds its Site ceiling");
  const siteIds = new Set<string>();
  const driveIds = new Set<string>();
  for (const site of selected) {
    const isRunnable = site.active
      && site.scanEnabled
      && (site.baselineState === "approved" || site.baselineState === "completed");
    const isSkipped = !site.active && !site.scanEnabled && site.baselineState === "skipped";
    if (!isRunnable && !isSkipped) {
      throw new Error("Baseline wave contains a Site outside approved execution states");
    }
    if (siteIds.has(site.id)) throw new Error("Baseline wave contains a duplicate Site");
    siteIds.add(site.id);
    if (!site.scanLibraryIds?.length) {
      throw new Error("Baseline wave Site has no exact scan-library allowlist");
    }
    for (const driveId of site.scanLibraryIds) {
      if (!driveId.trim()) throw new Error("Baseline wave contains an empty drive ID");
      if (driveIds.has(driveId)) throw new Error("Baseline wave contains a duplicate drive ID");
      driveIds.add(driveId);
    }
  }
  return selected;
}

export function evaluateBaselineWave(input: {
  expectedSiteIds: string[];
  runs: SensitivityScanRun[];
}): BaselineWaveDecision {
  const expected = new Set(input.expectedSiteIds);
  if (expected.size === 0 || expected.size !== input.expectedSiteIds.length) {
    throw new Error("Expected baseline Site IDs must be unique and non-empty");
  }
  const runBySite = new Map<string, SensitivityScanRun>();
  for (const run of input.runs) {
    if (run.targetSiteIds.length !== 1 || !expected.has(run.targetSiteIds[0])) continue;
    runBySite.set(run.targetSiteIds[0], run);
  }
  const reasons: string[] = [];
  for (const siteId of expected) {
    const run = runBySite.get(siteId);
    if (!run) reasons.push("missing-run");
    else if (["queued", "running"].includes(run.status)) reasons.push("non-terminal-run");
    else if (["failed", "cancelled"].includes(run.status)) reasons.push("failed-run");
    else if (run.throttledCount > 0) reasons.push("throttled-items");
    else if (run.failedCount > 0) reasons.push("failed-items");
    else if (run.status === "partial" || run.lockedCount > 0 || run.unsupportedCount > 0) {
      reasons.push("partial-items");
    }
  }
  const distinctReasons = [...new Set(reasons)].sort();
  if (distinctReasons.some((reason) => reason !== "partial-items")) {
    return { decision: "stop", reasons: distinctReasons };
  }
  if (distinctReasons.length > 0) return { decision: "review", reasons: distinctReasons };
  return { decision: "proceed", reasons: [] };
}
