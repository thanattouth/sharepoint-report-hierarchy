import type {
  DeltaStateStore,
  InventoryStore,
  ScanRunStore,
} from "../../stores/contracts";
import { createGraphTokenProvider } from "./auth";
import { loadGraphPilotConfig } from "./config";
import { GraphClient, type GraphLogger } from "./graph-client";
import { MicrosoftGraphPilotScanner } from "./pilot-scanner";

export function createMicrosoftGraphPilotScanner(input: {
  env: Record<string, string | undefined>;
  inventoryStore: InventoryStore;
  scanRunStore: ScanRunStore;
  deltaStateStore: DeltaStateStore;
  logger?: GraphLogger;
  fetch?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => Date;
}) {
  const config = loadGraphPilotConfig(input.env);
  const graph = new GraphClient({
    tokenProvider: createGraphTokenProvider(config.auth),
    fetch: input.fetch,
    sleep: input.sleep,
    logger: input.logger,
    maxRetries: config.maxRetries,
  });
  return new MicrosoftGraphPilotScanner({
    graph,
    inventoryStore: input.inventoryStore,
    scanRunStore: input.scanRunStore,
    deltaStateStore: input.deltaStateStore,
    config,
    now: input.now,
  });
}
