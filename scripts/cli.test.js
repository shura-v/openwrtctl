import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { PROJECT_DIRECTORY } from "./lib/remote.js";

const execFileAsync = promisify(execFile);

test("exposes the complete openwrtctl command surface", async () => {
  const { stdout } = await execFileAsync(process.execPath, [
    path.join(PROJECT_DIRECTORY, "bin/openwrtctl.js"),
    "--help"
  ]);

  for (const command of [
    "init",
    "doctor",
    "prepare-router",
    "backup",
    "restore",
    "install-adguard",
    "disable-singbox",
    "disable-nfqws2",
    "sync-singbox",
    "update-nfqws2",
    "test-nfqws2",
    "test-nfqws2-results",
    "sync"
  ]) {
    assert.match(stdout, new RegExp(`\\b${command}\\b`, "u"));
  }
});
