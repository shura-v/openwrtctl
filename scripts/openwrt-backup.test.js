import assert from "node:assert/strict";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  backupOpenwrt,
  restoreOpenwrt,
  validateArchiveEntries
} from "./lib/openwrt-backup.js";

test("creates, validates, downloads, and removes an OpenWrt backup", async (context) => {
  const destinationDirectory = await mkdtemp(path.join(tmpdir(), "openwrt-backup-"));
  context.after(() => rm(destinationDirectory, { recursive: true, force: true }));
  const calls = [];
  const remote = {
    exec: async (command) => calls.push(["exec", command]),
    pull: async (remotePath, localPath) => {
      calls.push(["pull", remotePath, localPath]);
      await writeFile(localPath, "backup", "utf8");
    }
  };

  const result = await backupOpenwrt({
    remote,
    remoteTmpDirectory: "/root/tmp",
    destinationDirectory,
    now: new Date("2026-08-11T01:02:03.456Z")
  });

  const expectedName = "openwrt-backup-2026-08-11T01-02-03-456Z.tar.gz";
  assert.equal(result.localPath, path.join(destinationDirectory, expectedName));
  assert.equal(result.remotePath, `/root/tmp/${expectedName}`);
  assert.deepEqual(calls, [
    ["exec", `sysupgrade -b '/root/tmp/${expectedName}'`],
    ["exec", `tar -tzf '/root/tmp/${expectedName}' >/dev/null`],
    ["pull", `/root/tmp/${expectedName}`, path.join(destinationDirectory, expectedName)],
    ["exec", `rm -f '/root/tmp/${expectedName}'`]
  ]);
  assert.equal((await stat(result.localPath)).mode & 0o777, 0o600);
});

test("keeps the remote backup when downloading fails", async (context) => {
  const destinationDirectory = await mkdtemp(path.join(tmpdir(), "openwrt-backup-failure-"));
  context.after(() => rm(destinationDirectory, { recursive: true, force: true }));
  const commands = [];
  const remote = {
    exec: async (command) => commands.push(command),
    pull: async () => {
      throw new Error("rsync failed");
    }
  };

  await assert.rejects(
    backupOpenwrt({
      remote,
      remoteTmpDirectory: "/root/tmp",
      destinationDirectory,
      now: new Date("2026-08-11T01:02:03.456Z")
    }),
    /backup remains on the router at \/root\/tmp\/openwrt-backup/u
  );
  assert.equal(commands.some((command) => command.startsWith("rm -f")), false);
});

test("uploads, validates, and restores an explicit OpenWrt backup", async () => {
  const calls = [];
  const remote = {
    push: async (source, destination) => calls.push(["push", source, destination]),
    exec: async (command) => calls.push(["exec", command])
  };

  const result = await restoreOpenwrt({
    remote,
    archivePath: "/local/openwrt-backup.tar.gz",
    remoteTmpDirectory: "/root/tmp",
    now: new Date("2026-08-11T01:02:03.456Z"),
    validateArchive: async (archivePath) => calls.push(["validate", archivePath])
  });

  const remotePath = "/root/tmp/openwrt-restore-2026-08-11T01-02-03-456Z.tar.gz";
  assert.deepEqual(result, {
    archivePath: "/local/openwrt-backup.tar.gz",
    remotePath
  });
  assert.deepEqual(calls, [
    ["validate", "/local/openwrt-backup.tar.gz"],
    ["push", "/local/openwrt-backup.tar.gz", remotePath],
    ["exec", `tar -tzf '${remotePath}' >/dev/null`],
    ["exec", `sysupgrade -r '${remotePath}'`],
    ["exec", `rm -f '${remotePath}'`]
  ]);
});

test("rejects unsafe paths in a restore archive", () => {
  assert.throws(
    () => validateArchiveEntries(["etc/config/network", "../etc/shadow"]),
    /unsafe path/u
  );
  assert.throws(() => validateArchiveEntries(["/etc/shadow"]), /unsafe path/u);
});
