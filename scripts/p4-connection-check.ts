import { createGraphTokenProvider } from "../src/scanner/graph/auth";
import { loadGraphPilotConfig } from "../src/scanner/graph/config";
import { GraphClient } from "../src/scanner/graph/graph-client";
import { probeGraphPilotAccess } from "../src/scanner/graph/probe";

const config = loadGraphPilotConfig(process.env);
const graph = new GraphClient({
  tokenProvider: createGraphTokenProvider(config.auth),
  maxRetries: config.maxRetries,
});
const result = await probeGraphPilotAccess(graph, config);

process.stdout.write(`${JSON.stringify({
  status: "connected",
  siteId: result.siteId,
  displayName: result.displayName,
  webUrl: result.webUrl,
  documentLibraryCount: result.documentLibraryCount,
}, null, 2)}\n`);
