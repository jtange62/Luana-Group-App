import { mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const source = process.env.LUANA_R2_REMOTE || "r2:luana-lessons";
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const destination = resolve("backups", stamp, "r2");
mkdirSync(destination, { recursive: true });

const check = spawnSync("rclone", ["version"], { stdio: "ignore" });
if (check.status !== 0) {
  console.error("rclone is required. Configure the R2 remote described in BACKUP_RECOVERY.md first.");
  process.exit(1);
}

const result = spawnSync("rclone", ["copy", source, destination, "--metadata", "--progress"], {
  stdio: "inherit",
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
console.log(`R2 backup written to ${destination}`);
