import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const packages = [
  { script: "p5:scanner:package", archive: "outputs/scheduled-scanner.zip" },
  { script: "p6:api:package", archive: "outputs/report-cache-api.zip" },
  { script: "p7:admin:package", archive: "outputs/configuration-admin-api.zip" },
];

for (const item of packages) {
  const result = spawnSync("npm", ["run", item.script], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${item.script} failed`);
  const archive = resolve(item.archive);
  if (!existsSync(archive) || statSync(archive).size === 0) {
    throw new Error(`${item.archive} was not created`);
  }
}

process.stdout.write(`${JSON.stringify({
  event: "customer-delivery-workloads-packaged",
  archives: packages.map(({ archive }) => archive),
})}\n`);
