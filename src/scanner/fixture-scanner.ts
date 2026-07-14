import { resolveHierarchyScope } from "../domain/hierarchy";
import type { AppCapability, SensitivityScanRun } from "../domain/types";
import { FixtureHierarchyStore } from "../stores/fixture-store";
import type { QueueScanRequest, SensitivityScanner } from "./contracts";

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
  const [nodes, assignments] = await Promise.all([store.getNodes(), store.getAssignments()]);
  const scope = resolveHierarchyScope(input.userUpn, nodes, assignments);
  if (scope.allowedSiteIds.length === 0) throw new Error("No active hierarchy assignment");
  return new FixtureScanner().queue({
    trigger: "manual",
    requestedBy: input.userUpn,
    targets: scope.allowedSiteIds.map((siteId) => ({ siteId })),
  });
}
