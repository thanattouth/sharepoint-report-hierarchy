import type {
  DeletedInventoryIdentity,
  GovernedSharePointSite,
  ScanStatus,
  SensitivityInventoryItem,
  SensitivityScanRun,
} from "../../domain/types";
import type {
  DeltaStateStore,
  InventoryStore,
  ScanRunStore,
} from "../../stores/contracts";
import { mapWithConcurrency } from "../bounded-concurrency";
import type {
  ScanExecutionRequest,
  SensitivityScanExecutor,
} from "../contracts";
import type { GraphPilotConfig } from "./config";
import { GraphClient, GraphRequestError } from "./graph-client";
import type {
  ExtractSensitivityLabelsResponse,
  GraphCollection,
  GraphDeltaResponse,
  GraphDrive,
  GraphDriveItem,
} from "./types";

type PilotScannerDependencies = {
  graph: GraphClient;
  inventoryStore: InventoryStore;
  scanRunStore: ScanRunStore;
  deltaStateStore: DeltaStateStore;
  config: GraphPilotConfig;
  now?: () => Date;
};

function encoded(value: string) {
  return encodeURIComponent(value);
}

function safeErrorSummary(error: unknown) {
  return error instanceof GraphRequestError
    ? `Microsoft Graph ${error.code} (${error.status})`
    : "Scanner execution failed";
}

function scanStatusFor(error: GraphRequestError): ScanStatus {
  if (error.status === 423) return "locked";
  if (error.status === 429) return "throttled";
  if (error.status === 415 || /unsupported|invalidfile|not.?supported/i.test(error.code)) {
    return "unsupported";
  }
  return "failed";
}

function filePath(item: GraphDriveItem) {
  const parentPath = item.parentReference?.path?.split("root:").at(-1)?.replace(/\/$/, "") ?? "";
  return `${parentPath}/${item.name ?? item.id}`.replace(/\/+/g, "/");
}

export class MicrosoftGraphPilotScanner implements SensitivityScanExecutor {
  private readonly now: () => Date;

  constructor(private readonly dependencies: PilotScannerDependencies) {
    this.now = dependencies.now ?? (() => new Date());
  }

  async execute(request: ScanExecutionRequest): Promise<SensitivityScanRun> {
    this.assertAllowedTarget(request.target);
    const startedAt = this.now().toISOString();
    const run: SensitivityScanRun = {
      id: request.runId,
      trigger: request.trigger,
      status: "running",
      startedAt,
      targetSiteIds: [request.target.id],
      scannedCount: 0,
      changedCount: 0,
      secretCount: 0,
      noLabelCount: 0,
      lockedCount: 0,
      throttledCount: 0,
      unsupportedCount: 0,
      failedCount: 0,
    };
    await this.dependencies.scanRunStore.save(run);

    try {
      const drives = await this.listSiteDrives(request.target.id);
      for (const drive of drives) {
        await this.scanDrive(request.target, drive, run);
      }
      run.status = run.failedCount + run.throttledCount > 0 ? "partial" : "succeeded";
    } catch (error) {
      run.status = "failed";
      run.errorSummary = safeErrorSummary(error);
    }

    run.finishedAt = this.now().toISOString();
    await this.dependencies.scanRunStore.save(run);
    return run;
  }

  private assertAllowedTarget(target: GovernedSharePointSite) {
    if (!target.active || !target.scanEnabled || target.id !== this.dependencies.config.allowedSiteId) {
      throw new Error("The requested Site is not the active P4 allowlisted target");
    }
  }

  private async listSiteDrives(siteId: string) {
    const drives: GraphDrive[] = [];
    let next: string | undefined = `/sites/${encoded(siteId)}/drives?$select=id,name,webUrl,driveType`;
    while (next) {
      const page: GraphCollection<GraphDrive> = await this.dependencies.graph.request(next);
      drives.push(...page.value);
      next = page["@odata.nextLink"];
    }
    return drives;
  }

  private async scanDrive(
    site: GovernedSharePointSite,
    drive: GraphDrive,
    run: SensitivityScanRun,
  ) {
    const state = await this.dependencies.deltaStateStore.get(drive.id);
    let next: string | undefined = state?.cursor
      ?? `/drives/${encoded(drive.id)}/root/delta?$select=id,name,webUrl,lastModifiedDateTime,parentReference,file,folder,deleted`;
    let deltaLink: string | undefined;
    const latestOutcomes = new Map<string, { kind: "deleted" } | {
      kind: "file";
      status: ScanStatus;
      isSecret: boolean;
    }>();

    while (next) {
      const page: GraphDeltaResponse = await this.dependencies.graph.request(next);
      const latestInPage = new Map<string, GraphDriveItem>();
      for (const item of page.value) latestInPage.set(item.id, item);
      const changed = [...latestInPage.values()].filter((item) => item.file || item.deleted);
      const files = changed.filter((item) => item.file && !item.deleted);
      const deletedAt = this.now().toISOString();
      const deletions: DeletedInventoryIdentity[] = changed
        .filter((item) => item.deleted)
        .map((item) => ({
          tenantId: this.dependencies.config.tenantId,
          siteId: site.id,
          driveId: drive.id,
          itemId: item.id,
          deletedAt,
        }));
      const upserts = await mapWithConcurrency(
        files,
        this.dependencies.config.maxConcurrency,
        (item) => this.extractItem(site, drive, item),
      );

      await this.dependencies.inventoryStore.applyChanges({ upserts, deletions });
      for (const item of deletions) latestOutcomes.set(item.itemId, { kind: "deleted" });
      for (const item of upserts) {
        latestOutcomes.set(item.itemId, {
          kind: "file",
          status: item.scanStatus,
          isSecret: item.sensitivityLabels.some((label) => this.dependencies.config.secretLabelIds.has(label.id)),
        });
      }
      next = page["@odata.nextLink"];
      deltaLink = page["@odata.deltaLink"] ?? deltaLink;
    }
    if (!deltaLink) throw new Error("Microsoft Graph delta response did not include a deltaLink");
    await this.dependencies.deltaStateStore.save({
      driveId: drive.id,
      cursor: deltaLink,
      updatedAt: this.now().toISOString(),
    });

    run.changedCount += latestOutcomes.size;
    for (const outcome of latestOutcomes.values()) {
      if (outcome.kind === "deleted") continue;
      run.scannedCount += 1;
      if (outcome.isSecret) run.secretCount += 1;
      if (outcome.status === "no-label") run.noLabelCount += 1;
      if (outcome.status === "locked") run.lockedCount += 1;
      if (outcome.status === "throttled") run.throttledCount += 1;
      if (outcome.status === "unsupported") run.unsupportedCount += 1;
      if (outcome.status === "failed") run.failedCount += 1;
    }
  }

  private async extractItem(
    site: GovernedSharePointSite,
    drive: GraphDrive,
    item: GraphDriveItem,
  ): Promise<SensitivityInventoryItem> {
    const scannedAt = this.now().toISOString();
    const base: SensitivityInventoryItem = {
      tenantId: this.dependencies.config.tenantId,
      siteId: site.id,
      driveId: drive.id,
      itemId: item.id,
      siteName: site.name,
      siteWebUrl: `https://${site.hostname}${site.path}`,
      libraryName: drive.name,
      fileName: item.name ?? item.id,
      filePath: filePath(item),
      fileWebUrl: item.webUrl,
      modifiedAt: item.lastModifiedDateTime,
      sensitivityLabels: [],
      scanStatus: "no-label",
      scannedAt,
    };

    try {
      const response = await this.dependencies.graph.request<ExtractSensitivityLabelsResponse>(
        `/drives/${encoded(drive.id)}/items/${encoded(item.id)}/extractSensitivityLabels`,
        { method: "POST" },
      );
      const labels = (response.value?.labels ?? [])
        .filter((label): label is Required<Pick<typeof label, "sensitivityLabelId">> & typeof label => Boolean(label.sensitivityLabelId))
        .map((label) => ({
          id: label.sensitivityLabelId,
          assignmentMethod: label.assignmentMethod,
          tenantId: label.tenantId,
        }));
      return { ...base, sensitivityLabels: labels, scanStatus: labels.length ? "success" : "no-label" };
    } catch (error) {
      if (!(error instanceof GraphRequestError)) throw error;
      return {
        ...base,
        scanStatus: scanStatusFor(error),
        errorCode: error.code,
        errorMessage: error.message.slice(0, 500),
        graphRequestId: error.requestId,
      };
    }
  }
}
