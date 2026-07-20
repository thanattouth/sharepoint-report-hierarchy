import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const service = join(root, "services/scheduled-scanner");
const outputDirectory = join(root, "outputs");
const archive = join(outputDirectory, "scheduled-scanner.zip");
const staging = mkdtempSync(join(tmpdir(), "sp-scheduled-scanner-package-"));

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
}

try {
  run("npm", ["run", "build"], service);
  mkdirSync(join(staging, "dist"), { recursive: true });
  cpSync(join(service, "dist/index.js"), join(staging, "dist/index.js"));
  cpSync(join(service, "host.json"), join(staging, "host.json"));
  cpSync(join(service, "package.json"), join(staging, "package.json"));
  cpSync(join(service, "package-lock.json"), join(staging, "package-lock.json"));
  run("npm", ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], staging);
  mkdirSync(outputDirectory, { recursive: true });
  rmSync(archive, { force: true });
  run("zip", ["-q", "-r", archive, "."], staging);
  process.stdout.write(`${JSON.stringify({
    status: "packaged",
    archive: "outputs/scheduled-scanner.zip",
    bytes: statSync(archive).size,
  })}\n`);
} finally {
  rmSync(staging, { recursive: true, force: true });
}
