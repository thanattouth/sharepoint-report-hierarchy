import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const outputDirectory = join(root, "outputs");
const archive = join(outputDirectory, "report-web-app.zip");
const standalone = join(root, ".next/standalone");
const staging = mkdtempSync(join(tmpdir(), "sp-report-web-package-"));

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
}

try {
  run("npm", ["run", "build:azure-web"], root);
  if (!existsSync(join(standalone, "server.js"))) throw new Error("Next.js standalone server.js was not generated");
  cpSync(standalone, staging, { recursive: true });
  mkdirSync(join(staging, ".next"), { recursive: true });
  cpSync(join(root, ".next/static"), join(staging, ".next/static"), { recursive: true });
  cpSync(join(root, "public"), join(staging, "public"), { recursive: true });
  mkdirSync(outputDirectory, { recursive: true });
  rmSync(archive, { force: true });
  run("zip", ["-q", "-r", archive, "."], staging);
  process.stdout.write(`${JSON.stringify({
    status: "packaged",
    archive: "outputs/report-web-app.zip",
    bytes: statSync(archive).size,
  })}\n`);
} finally {
  rmSync(staging, { recursive: true, force: true });
}
