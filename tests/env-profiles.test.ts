import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import test from "node:test";
import {
  allowedKeysForProfile,
  ENV_FILE_SCOPES,
  unknownManagedEnvKeys,
  validateScopedEnvKeys,
  type EnvFileName,
} from "../src/configuration/env-profiles";

test("every scoped env example contains only known keys owned by that file", () => {
  for (const localFile of Object.keys(ENV_FILE_SCOPES) as EnvFileName[]) {
    const example = localFile.replace(/\.local$/, ".example");
    const keys = Object.keys(parseEnv(readFileSync(example, "utf8")));
    assert.deepEqual(unknownManagedEnvKeys(keys), [], example);
    assert.deepEqual(validateScopedEnvKeys(localFile, keys), [], example);
  }
});

test("Report and Configuration Admin profiles cannot inherit scanner credentials", () => {
  for (const profile of ["p6-report", "p7-configuration"] as const) {
    const allowed = allowedKeysForProfile(profile);
    assert.equal(allowed.has("SCANNER_CLIENT_SECRET"), false);
    assert.equal(allowed.has("SCANNER_CLIENT_ID"), false);
  }
  assert.equal(allowedKeysForProfile("p6-report").has("REPORT_API_FUNCTION_KEY"), false);
  assert.equal(allowedKeysForProfile("p7-configuration").has("REPORT_API_FUNCTION_KEY"), false);
});

test("env validation detects cross-scope and misspelled managed keys", () => {
  assert.deepEqual(
    validateScopedEnvKeys(".env.report-api.local", ["SCANNER_CLIENT_SECRET"]),
    ["SCANNER_CLIENT_SECRET"],
  );
  assert.deepEqual(unknownManagedEnvKeys(["REPORT_API_FUNCTON_KEY"]), [
    "REPORT_API_FUNCTON_KEY",
  ]);
});
