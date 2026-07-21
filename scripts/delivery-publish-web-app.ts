import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { loadCustomerDeliveryManifest } from "../src/delivery/manifest";

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`Expected ${name} <value>`);
  return value;
}

const manifest = loadCustomerDeliveryManifest(argument("--manifest"));
const hosting = manifest.webHosting;
if (!hosting) throw new Error("Delivery manifest does not contain webHosting configuration");
const archive = resolve("outputs/report-web-app.zip");
if (!existsSync(archive)) throw new Error("Run npm run package:azure-web before publishing");

const result = spawnSync("az", [
  "webapp", "deploy",
  "--subscription", manifest.subscriptionId,
  "--resource-group", manifest.resourceGroupName,
  "--name", hosting.appServiceName,
  "--src-path", archive,
  "--type", "zip",
  "--async", "true",
  "--clean", "true",
  "--restart", "true",
  "--track-status", "false",
  "--only-show-errors",
  "--output", "none",
], { stdio: "inherit" });
if (result.error) throw result.error;
if (result.status !== 0) process.exitCode = result.status ?? 1;
else process.stdout.write(`${JSON.stringify({ status: "published", appServiceName: hosting.appServiceName })}\n`);
