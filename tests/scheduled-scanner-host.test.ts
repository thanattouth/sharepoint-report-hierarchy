import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("scheduled scanner host registers the Azure Functions Queue extension bundle", async () => {
  const host = JSON.parse(await readFile(
    new URL("../services/scheduled-scanner/host.json", import.meta.url),
    "utf8",
  )) as {
    extensionBundle?: { id?: string; version?: string };
    extensions?: { queues?: { batchSize?: number; maxDequeueCount?: number; messageEncoding?: string } };
  };

  assert.equal(host.extensionBundle?.id, "Microsoft.Azure.Functions.ExtensionBundle");
  assert.equal(host.extensionBundle?.version, "[4.0.0, 5.0.0)");
  assert.equal(host.extensions?.queues?.batchSize, 1);
  assert.equal(host.extensions?.queues?.maxDequeueCount, 3);
  assert.equal(host.extensions?.queues?.messageEncoding, "none");
});
