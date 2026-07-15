import { mapWithConcurrency } from "../bounded-concurrency";
import type { GraphPilotConfig } from "./config";
import { GraphClient, GraphRequestError } from "./graph-client";
import type {
  ExtractSensitivityLabelsResponse,
  GraphCollection,
  GraphDeltaResponse,
  GraphDrive,
  GraphDriveItem,
} from "./types";

export type BoundedPilotOutcome = {
  driveId: string;
  libraryName: string;
  itemId: string;
  fileName: string;
  filePath: string;
  status: "success" | "no-label" | "locked" | "throttled" | "unsupported" | "failed";
  labels: Array<{
    id: string;
    displayName?: string;
    assignmentMethod?: string;
  }>;
  graphStatus?: number;
  graphCode?: string;
  graphRequestId?: string;
};

export type BoundedPilotLibraryResult = {
  driveId: string;
  libraryName: string;
  metadataItemsRead: number;
  deltaPagesRead: number;
  selectedFileCount: number;
  truncated: boolean;
  outcomes: BoundedPilotOutcome[];
};

export type BoundedPilotOptions = {
  graph: GraphClient;
  config: GraphPilotConfig;
  libraryNames: readonly string[];
  maxFilesPerLibrary: number;
  maxDeltaPagesPerLibrary: number;
};

const MAX_FILES_PER_LIBRARY = 20;
const MAX_DELTA_PAGES_PER_LIBRARY = 10;

function encoded(value: string) {
  return encodeURIComponent(value);
}

function filePath(item: GraphDriveItem) {
  const parentPath = item.parentReference?.path?.split("root:").at(-1)?.replace(/\/$/, "") ?? "";
  return `${parentPath}/${item.name ?? item.id}`.replace(/\/+/g, "/");
}

function failureStatus(error: GraphRequestError): BoundedPilotOutcome["status"] {
  if (error.status === 423) return "locked";
  if (error.status === 429) return "throttled";
  if (error.status === 415 || /unsupported|invalidfile|not.?supported/i.test(error.code)) {
    return "unsupported";
  }
  return "failed";
}

function assertBounds(options: BoundedPilotOptions) {
  if (options.libraryNames.length === 0 || new Set(options.libraryNames).size !== options.libraryNames.length) {
    throw new Error("Bounded pilot requires distinct library names");
  }
  if (!Number.isInteger(options.maxFilesPerLibrary)
    || options.maxFilesPerLibrary < 1
    || options.maxFilesPerLibrary > MAX_FILES_PER_LIBRARY) {
    throw new Error(`maxFilesPerLibrary must be an integer from 1 to ${MAX_FILES_PER_LIBRARY}`);
  }
  if (!Number.isInteger(options.maxDeltaPagesPerLibrary)
    || options.maxDeltaPagesPerLibrary < 1
    || options.maxDeltaPagesPerLibrary > MAX_DELTA_PAGES_PER_LIBRARY) {
    throw new Error(
      `maxDeltaPagesPerLibrary must be an integer from 1 to ${MAX_DELTA_PAGES_PER_LIBRARY}`,
    );
  }
}

async function listAllowedDrives(options: BoundedPilotOptions) {
  const requested = new Set(options.libraryNames);
  const found = new Map<string, GraphDrive>();
  let next: string | undefined = `/sites/${encoded(options.config.allowedSiteId)}/drives?$select=id,name,driveType`;
  while (next) {
    const page: GraphCollection<GraphDrive> = await options.graph.request(next);
    for (const drive of page.value) {
      if (requested.has(drive.name)) found.set(drive.name, drive);
    }
    next = page["@odata.nextLink"];
  }
  const missing = options.libraryNames.filter((name) => !found.has(name));
  if (missing.length) throw new Error(`Bounded pilot libraries not found: ${missing.join(", ")}`);
  return options.libraryNames.map((name) => found.get(name)!);
}

async function extract(
  graph: GraphClient,
  config: GraphPilotConfig,
  drive: GraphDrive,
  item: GraphDriveItem,
): Promise<BoundedPilotOutcome> {
  const base = {
    driveId: drive.id,
    libraryName: drive.name,
    itemId: item.id,
    fileName: item.name ?? item.id,
    filePath: filePath(item),
    labels: [],
  } satisfies Omit<BoundedPilotOutcome, "status">;
  try {
    const response = await graph.request<ExtractSensitivityLabelsResponse>(
      `/drives/${encoded(drive.id)}/items/${encoded(item.id)}/extractSensitivityLabels`,
      { method: "POST" },
    );
    const labels = (response.value?.labels ?? []).flatMap((label) =>
      label.sensitivityLabelId
        ? [{
            id: label.sensitivityLabelId,
            displayName: config.reportableLabelNames.get(label.sensitivityLabelId),
            assignmentMethod: label.assignmentMethod,
          }]
        : [],
    );
    return { ...base, status: labels.length ? "success" : "no-label", labels };
  } catch (error) {
    if (!(error instanceof GraphRequestError)) throw error;
    return {
      ...base,
      status: failureStatus(error),
      graphStatus: error.status,
      graphCode: error.code,
      graphRequestId: error.requestId,
    };
  }
}

async function runLibrary(options: BoundedPilotOptions, drive: GraphDrive) {
  const files: GraphDriveItem[] = [];
  let metadataItemsRead = 0;
  let deltaPagesRead = 0;
  let next: string | undefined = `/drives/${encoded(drive.id)}/root/delta?$select=id,name,file,folder,parentReference&$top=${options.maxFilesPerLibrary}`;

  while (next && files.length < options.maxFilesPerLibrary
    && deltaPagesRead < options.maxDeltaPagesPerLibrary) {
    const page: GraphDeltaResponse = await options.graph.request(next);
    deltaPagesRead += 1;
    metadataItemsRead += page.value.length;
    for (const item of page.value) {
      if (item.file && !item.deleted && files.length < options.maxFilesPerLibrary) files.push(item);
    }
    next = page["@odata.nextLink"];
  }

  const outcomes = await mapWithConcurrency(
    files,
    options.config.maxConcurrency,
    (item) => extract(options.graph, options.config, drive, item),
  );
  return {
    driveId: drive.id,
    libraryName: drive.name,
    metadataItemsRead,
    deltaPagesRead,
    selectedFileCount: files.length,
    truncated: Boolean(next),
    outcomes,
  } satisfies BoundedPilotLibraryResult;
}

export async function runBoundedPilot(options: BoundedPilotOptions) {
  assertBounds(options);
  const drives = await listAllowedDrives(options);
  const results: BoundedPilotLibraryResult[] = [];
  for (const drive of drives) results.push(await runLibrary(options, drive));
  return results;
}
