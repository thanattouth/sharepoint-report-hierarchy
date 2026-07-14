import { resolveHierarchyScope } from "../domain/hierarchy";
import type { AppCapability, SensitivityScanRun } from "../domain/types";
import { FixtureHierarchyStore } from "../stores/fixture-store";
import {
  scheduledScanTargets,
  type QueueScanRequest,
  type SensitivityScanner,
} from "./contracts";

export class FixtureScanner implements SensitivityScanner {
  async queue(request: QueueScanRequest): Promise<SensitivityScanRun> {
    return {
      id: `QUEUE-${Date.now().toString(36).toUpperCase()}`,
      trigger: request.trigger,
      status: "queued",
      targetSiteIds: request.targets.map((target) => target.siteId),
      scannedCount: 0,
      changedCount: 0,
      secretCount: 0,
      noLabelCount: 0,
      lockedCount: 0,
      unsupportedCount: 0,
      failedCount: 0,
    };
  }
}

export async function queueAuthorizedRunNow(input: {
  userUpn: string;
  capability: AppCapability;
}) {
  if (input.capability !== "ReportAdmin") throw new Error("Run now requires ReportAdmin");
  const store = new FixtureHierarchyStore();
  const [nodes, assignments, sites, siteMappings] = await Promise.all([
    store.getNodes(),
    store.getAssignments(),
    store.getSites(),
    store.getSiteMappings(),
  ]);
  const scope = resolveHierarchyScope(input.userUpn, nodes, assignments, sites, siteMappings);
  if (scope.allowedSiteIds.length === 0) throw new Error("No active hierarchy assignment");
  const scheduledSiteIds = new Set(scheduledScanTargets(sites).map((target) => target.siteId));
  return new FixtureScanner().queue({
    trigger: "manual",
    requestedBy: input.userUpn,
    targets: scope.allowedSiteIds
      .filter((siteId) => scheduledSiteIds.has(siteId))
      .map((siteId) => ({ siteId })),
  });
}
