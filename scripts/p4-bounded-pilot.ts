import { createGraphTokenProvider } from "../src/scanner/graph/auth";
import { runBoundedPilot } from "../src/scanner/graph/bounded-pilot";
import { loadGraphPilotConfig } from "../src/scanner/graph/config";
import { GraphClient } from "../src/scanner/graph/graph-client";
import { probeGraphPilotAccess } from "../src/scanner/graph/probe";

function positiveInteger(value: string | undefined, fallback: number, maximum: number, name: string) {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`${name} must be an integer from 1 to ${maximum}`);
  }
  return parsed;
}

const config = loadGraphPilotConfig(process.env);
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
const graph = new GraphClient({
  tokenProvider: createGraphTokenProvider(config.auth),
  maxRetries: config.maxRetries,
});

await probeGraphPilotAccess(graph, config);
const libraries = await runBoundedPilot({
  graph,
  config,
  libraryNames,
  maxFilesPerLibrary,
  maxDeltaPagesPerLibrary,
});

process.stdout.write(`${JSON.stringify({
  status: "completed",
  siteId: config.allowedSiteId,
  bounds: {
    libraryNames,
    maxFilesPerLibrary,
    maxDeltaPagesPerLibrary,
    maxConcurrency: config.maxConcurrency,
  },
  libraries,
}, null, 2)}\n`);
