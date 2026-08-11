import assert from "node:assert/strict";
import test from "node:test";
import { applyRemoteConfig, restoreRemoteConfig } from "./lib/adguard-remote-config.js";

test("atomically replaces the remote AdGuard Home config", async () => {
  const commands = [];
  const remote = {
    exec: async (command) => commands.push(command)
  };

  await applyRemoteConfig(remote, "/root/tmp/adguardhome.yaml", "/etc/adguardhome/adguardhome.yaml");

  assert.equal(commands.length, 1);
  assert.match(commands[0], /cp '\/root\/tmp\/adguardhome\.yaml' "\$candidate"/u);
  assert.match(
    commands[0],
    /mv -f "\$candidate" '\/etc\/adguardhome\/adguardhome\.yaml'/u
  );
  assert.doesNotMatch(commands[0], /> '\/etc\/adguardhome\/adguardhome\.yaml'/u);
});

test("restores a local backup after a failed remote apply", async () => {
  const calls = [];
  const remote = {
    push: async (source, destination) => calls.push(["push", source, destination]),
    exec: async (command) => calls.push(["exec", command])
  };

  await assert.rejects(
    restoreRemoteConfig(
      remote,
      "/local/.backups/adguard/previous.yaml",
      "/root/tmp/adguardhome.yaml",
      "/etc/adguardhome/adguardhome.yaml",
      new Error("restart failed")
    ),
    /previous\.yaml was restored: restart failed/u
  );
  assert.deepEqual(calls[0], [
    "push",
    "/local/.backups/adguard/previous.yaml",
    "/root/tmp/adguardhome.yaml"
  ]);
  assert.match(calls[2][1], /mv -f "\$candidate"/u);
});
