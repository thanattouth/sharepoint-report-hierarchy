import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";
import {
  ENV_FILE_SCOPES,
  KNOWN_ENV_KEYS,
  LEGACY_ENV_FILE,
  unknownManagedEnvKeys,
  type EnvFileName,
} from "../src/configuration/env-profiles";

const apply = process.argv.includes("--apply");
if (!existsSync(LEGACY_ENV_FILE)) throw new Error(`${LEGACY_ENV_FILE} does not exist`);
const legacy = parseEnv(readFileSync(LEGACY_ENV_FILE, "utf8"));
const unknown = unknownManagedEnvKeys(Object.keys(legacy));
if (unknown.length > 0) {
  throw new Error(`${LEGACY_ENV_FILE} contains unknown managed keys: ${unknown.join(", ")}`);
}

const plan = (Object.entries(ENV_FILE_SCOPES) as Array<[EnvFileName, readonly string[]]>)
  .map(([file, keys]) => ({
    file,
    keys: keys.filter((key) => legacy[key] !== undefined),
    exists: existsSync(file),
  }))
  .filter((entry) => entry.keys.length > 0);
const existing = plan.filter((entry) => entry.exists);
if (apply && existing.length > 0) {
  throw new Error(`Refusing to overwrite existing scoped env files: ${existing.map((item) => item.file).join(", ")}`);
}

if (apply) {
  for (const entry of plan) {
    const lines = [
      "# Migrated from .env.p4.local. Review against the matching .example before use.",
      ...entry.keys.map((key) => `${key}=${legacy[key] ?? ""}`),
      "",
    ];
    writeFileSync(entry.file, lines.join("\n"), { encoding: "utf8", mode: 0o600, flag: "wx" });
  }
}

const legacyManagedCount = Object.keys(legacy).filter((key) => KNOWN_ENV_KEYS.has(key)).length;
process.stdout.write(`${JSON.stringify({
  mode: apply ? "apply" : "dry-run",
  legacyFile: LEGACY_ENV_FILE,
  legacyManagedKeyCount: legacyManagedCount,
  files: plan.map((entry) => ({ file: entry.file, keyCount: entry.keys.length, exists: entry.exists })),
  status: apply ? "split-completed-legacy-retained" : "ready",
}, null, 2)}\n`);
