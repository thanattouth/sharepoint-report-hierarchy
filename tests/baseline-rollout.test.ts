import assert from "node:assert/strict";
import test from "node:test";
import type { GovernedSharePointSite, SensitivityScanRun } from "../src/domain/types";
import {
  evaluateBaselineWave,
  excludeBaselineCandidates,
  selectBaselineWave,
  skipBaselineSite,
} from "../src/scanner/scheduled/baseline-rollout";
import type { SiteStore } from "../src/stores/contracts";
import type { ScanRunStore } from "../src/stores/contracts";
import { baselineRunId } from "../src/scanner/scheduled/job";

function site(id: string, wave: number): GovernedSharePointSite {
  return {
    id,
    name: id,
    hostname: "contoso.sharepoint.com",
    path: `/sites/${id}`,
    active: true,
    scanEnabled: true,
    scanLibraryIds: [`drive-${id}`],
    baselineWave: wave,
    baselineState: "approved",
  };
}

function run(siteId: string, overrides: Partial<SensitivityScanRun> = {}): SensitivityScanRun {
  return {
    id: `baseline-${siteId}`,
    trigger: "manual",
    status: "succeeded",
    targetSiteIds: [siteId],
    scannedCount: 1,
    changedCount: 1,
    sensitiveCount: 0,
    noLabelCount: 1,
    lockedCount: 0,
    throttledCount: 0,
    unsupportedCount: 0,
    failedCount: 0,
    ...overrides,
  };
}

test("baseline wave selection requires exact library IDs and enforces a ten-Site ceiling", () => {
  assert.deepEqual(selectBaselineWave({
    sites: [site("b", 1), site("a", 1), site("later", 2)],
    wave: 1,
    maxSites: 2,
  }).map((target) => target.id), ["a", "b"]);
  assert.throws(() => selectBaselineWave({
    sites: [{ ...site("unsafe", 1), scanLibraryIds: undefined }],
    wave: 1,
    maxSites: 1,
  }), /no exact scan-library allowlist/);
  assert.throws(() => selectBaselineWave({
    sites: Array.from({ length: 11 }, (_, index) => site(`site-${index}`, 1)),
    wave: 1,
    maxSites: 10,
  }), /Site ceiling/);
});

test("baseline wave decision stops on failures or throttling and reviews partial outcomes", () => {
  assert.deepEqual(evaluateBaselineWave({
    expectedSiteIds: ["a", "b"],
    runs: [run("a"), run("b")],
  }), { decision: "proceed", reasons: [] });
  assert.deepEqual(evaluateBaselineWave({
    expectedSiteIds: ["a"],
    runs: [run("a", { status: "partial", unsupportedCount: 1 })],
  }), { decision: "review", reasons: ["partial-items"] });
  assert.deepEqual(evaluateBaselineWave({
    expectedSiteIds: ["a", "b"],
    runs: [run("a", { throttledCount: 1 })],
  }), { decision: "stop", reasons: ["missing-run", "throttled-items"] });
});

class MemorySiteStore implements SiteStore {
  values = new Map<string, GovernedSharePointSite>();
  async get(siteId: string) { return structuredClone(this.values.get(siteId) ?? null); }
  async listActive() { return structuredClone([...this.values.values()].filter((value) => value.active)); }
  async listScanEnabled() { return structuredClone([...this.values.values()].filter((value) => value.active && value.scanEnabled)); }
  async listByBaselineWave(wave: number) { return structuredClone([...this.values.values()].filter((value) => value.baselineWave === wave)); }
  async save(value: GovernedSharePointSite) { this.values.set(value.id, structuredClone(value)); }
}

test("baseline exclusion keeps candidates disabled, clears Wave 1 and is idempotent", async () => {
  const store = new MemorySiteStore();
  store.values.set("a", { ...site("a", 1), active: false, scanEnabled: false });
  store.values.set("b", { ...site("b", 1), active: false, scanEnabled: false });
  const now = () => new Date("2026-07-16T15:00:00.000Z");

  assert.deepEqual(await excludeBaselineCandidates({
    siteStore: store,
    siteIds: ["a", "b"],
    reason: "operator-review",
    now,
  }), { requestedCount: 2, excludedCount: 2, alreadyExcludedCount: 0 });
  assert.equal(store.values.get("a")?.baselineWave, undefined);
  assert.equal(store.values.get("a")?.baselineState, "excluded");
  assert.equal(store.values.get("a")?.baselineExclusionReason, "operator-review");
  assert.equal(store.values.get("a")?.active, false);
  assert.equal(store.values.get("a")?.scanEnabled, false);
  assert.deepEqual(await excludeBaselineCandidates({
    siteStore: store,
    siteIds: ["a", "b"],
    reason: "operator-review",
    now,
  }), { requestedCount: 2, excludedCount: 0, alreadyExcludedCount: 2 });
});

test("baseline exclusion fails preflight without writes when any target is unsafe", async () => {
  const store = new MemorySiteStore();
  store.values.set("safe", { ...site("safe", 1), active: false, scanEnabled: false });
  store.values.set("unsafe", { ...site("unsafe", 1), scanEnabled: true });
  await assert.rejects(
    () => excludeBaselineCandidates({
      siteStore: store,
      siteIds: ["safe", "unsafe"],
      reason: "operator-review",
    }),
    /not a disabled Wave 1 candidate/,
  );
  assert.equal(store.values.get("safe")?.baselineWave, 1);
});

class MemoryRunStore implements ScanRunStore {
  values = new Map<string, SensitivityScanRun>();
  async get(runId: string) { return structuredClone(this.values.get(runId) ?? null); }
  async listRecent() { return structuredClone([...this.values.values()]); }
  async save(value: SensitivityScanRun) { this.values.set(value.id, structuredClone(value)); }
}

test("baseline skip is explicit, audited, disables future scans and is idempotent", async () => {
  const siteStore = new MemorySiteStore();
  const scanRunStore = new MemoryRunStore();
  siteStore.values.set("problem", site("problem", 1));
  const expectedRunId = baselineRunId({
    wave: 1,
    siteId: "problem",
  });
  scanRunStore.values.set(expectedRunId, run("problem", {
    id: expectedRunId,
    status: "partial",
    unsupportedCount: 2,
  }));
  const now = () => new Date("2026-07-16T20:00:00.000Z");
  assert.deepEqual(await skipBaselineSite({
    siteStore,
    scanRunStore,
    siteId: "problem",
    wave: 1,
    reason: "operator-approved-skip",
    now,
  }), { skippedCount: 1, alreadySkippedCount: 0 });
  assert.equal(siteStore.values.get("problem")?.active, false);
  assert.equal(siteStore.values.get("problem")?.scanEnabled, false);
  assert.equal(siteStore.values.get("problem")?.baselineState, "skipped");
  assert.equal(siteStore.values.get("problem")?.baselineSkippedAt, "2026-07-16T20:00:00.000Z");
  assert.deepEqual(await skipBaselineSite({
    siteStore,
    scanRunStore,
    siteId: "problem",
    wave: 1,
    reason: "operator-approved-skip",
    now,
  }), { skippedCount: 0, alreadySkippedCount: 1 });
});
