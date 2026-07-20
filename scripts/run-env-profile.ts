import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { parseEnv } from "node:util";
import {
  allowedKeysForProfile,
  ENV_PROFILES,
  isEnvProfileName,
  KNOWN_ENV_KEYS,
  LEGACY_ENV_FILE,
  validateScopedEnvKeys,
  unknownManagedEnvKeys,
  type EnvFileName,
} from "../src/configuration/env-profiles";

const separator = process.argv.indexOf("--");
const profileInput = process.argv[2];
if (!profileInput || !isEnvProfileName(profileInput)) {
  throw new Error(`Unknown env profile: ${profileInput || "<missing>"}`);
}
if (separator < 0 || separator === process.argv.length - 1) {
  throw new Error("Expected -- followed by a script and optional arguments");
}

const scopedFiles = ENV_PROFILES[profileInput].filter((file) => existsSync(file));
const usingLegacyFallback = scopedFiles.length === 0 && existsSync(LEGACY_ENV_FILE);
const sourceFiles = usingLegacyFallback ? [LEGACY_ENV_FILE] : scopedFiles;
if (sourceFiles.length === 0) {
  throw new Error(
    `No local env files found for ${profileInput}; copy the matching .env.*.example files`,
  );
}

const allowedKeys = allowedKeysForProfile(profileInput);
const loaded: Record<string, string> = {};
for (const file of sourceFiles) {
  const parsed = parseEnv(readFileSync(file, "utf8"));
  const unknown = unknownManagedEnvKeys(Object.keys(parsed));
  if (unknown.length > 0) {
    throw new Error(`${file} contains unknown managed keys: ${unknown.join(", ")}`);
  }
  if (!usingLegacyFallback) {
    const misplaced = validateScopedEnvKeys(file as EnvFileName, Object.keys(parsed));
    if (misplaced.length > 0) {
      throw new Error(`${file} contains keys owned by another scope: ${misplaced.join(", ")}`);
    }
  }
  for (const [key, value] of Object.entries(parsed)) {
    if (allowedKeys.has(key) && value !== undefined) loaded[key] = value;
  }
}

const explicit = Object.fromEntries(
  [...allowedKeys]
    .filter((key) => process.env[key] !== undefined)
    .map((key) => [key, process.env[key] as string]),
);
const childEnv = { ...process.env };
for (const key of KNOWN_ENV_KEYS) delete childEnv[key];
Object.assign(childEnv, loaded, explicit);

process.stderr.write(`${JSON.stringify({
  event: "env-profile-loaded",
  profile: profileInput,
  files: sourceFiles,
  keyCount: Object.keys({ ...loaded, ...explicit }).length,
  legacyFallback: usingLegacyFallback,
})}\n`);
if (usingLegacyFallback) {
  process.stderr.write(
    `Deprecated: split ${LEGACY_ENV_FILE} into the scoped .env.*.local files before P7 admin provisioning.\n`,
  );
}

const command = process.argv.slice(separator + 1);
const result = spawnSync(
  process.execPath,
  ["--import", "tsx", ...command],
  { cwd: process.cwd(), env: childEnv, stdio: "inherit" },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
