import { mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const scope = process.argv[2];
if (scope !== "--local" && scope !== "--remote") {
  console.error("Choose exactly one source: --local or --remote");
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const directory = resolve("backups", stamp);
const output = resolve(directory, "luana-board.sql");
mkdirSync(directory, { recursive: true });

const executable = process.platform === "win32" ? "npx.cmd" : "npx";
const result = spawnSync(executable, [
  "wrangler", "d1", "export", "luana-board", scope,
  `--output=${output}`, "--skip-confirmation",
], { stdio: "inherit", shell: process.platform === "win32" });

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
console.log(`D1 backup written to ${output}`);
