import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createLocalAdguardBackup } from "./lib/adguard-backup.js";

test("creates a timestamped private AdGuard Home backup", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "openwrt-adguard-backup-"));
  const sourcePath = path.join(directory, "current.yaml");
  const backupsRoot = path.join(directory, ".backups");
  context.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(sourcePath, "dns:\n  port: 53\n", "utf8");

  const backupPath = await createLocalAdguardBackup(
    sourcePath,
    backupsRoot,
    new Date("2026-08-11T01:02:03.456Z")
  );

  assert.equal(
    backupPath,
    path.join(backupsRoot, "adguard", "adguardhome-2026-08-11T01-02-03-456Z.yaml")
  );
  assert.equal(await readFile(backupPath, "utf8"), "dns:\n  port: 53\n");
  assert.equal((await stat(backupPath)).mode & 0o777, 0o600);
});
