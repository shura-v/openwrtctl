import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { buildConfigureDnsmasqCommand } from "./lib/adguard-lifecycle.js";
import {
  applyAdguardConfigTransaction,
  prepareAdguardArtifact
} from "./sync-adguard.js";

test("rejects sync-adguard when its service section is omitted", async () => {
  await assert.rejects(
    prepareAdguardArtifact({ config: {}, configPath: "/config/config.yaml" }),
    /sync-adguard requires an adguard section/u
  );
});

test("prepares the configured AdGuard artifact mode", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "sync-adguard-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const configPath = path.join(directory, "config.yaml");
  const userRulesPath = path.join(directory, "user-rules.yaml");
  await writeFile(userRulesPath, "- '$dnsrewrite=192.0.2.10'\n");

  const artifact = await prepareAdguardArtifact({
    config: { adguard: { userRules: { path: userRulesPath } } },
    configPath
  });

  assert.equal(artifact.mode, "userRules");
  assert.deepEqual(artifact.validated, ["$dnsrewrite=192.0.2.10"]);
});

test("restores the AdGuard config when readiness fails after restart", async () => {
  const calls = [];
  let execCount = 0;
  const remote = {
    push: async (source, destination) => calls.push(["push", source, destination]),
    exec: async (command) => {
      calls.push(["exec", command]);
      execCount += 1;

      if (execCount === 2) {
        throw new Error("AdGuard Home readiness failed");
      }
    }
  };

  await assert.rejects(
    applyAdguardConfigTransaction({
      remote,
      backupPath: "/local/.backups/adguard/previous.yaml",
      remoteStagedConfigPath: "/root/tmp/adguardhome.yaml",
      adguardConfigPath: "/etc/adguardhome/adguardhome.yaml",
      configureDnsmasqCommand: buildConfigureDnsmasqCommand("/root/tmp", 5353)
    }),
    /previous\.yaml was restored: AdGuard Home readiness failed/u
  );

  assert.match(calls[0][1], /\/etc\/init\.d\/adguardhome restart/u);
  assert.equal(calls[1][0], "exec");
  assert.match(calls[1][1], /wait_for_tcp_service adguardhome '5353'/u);
  assert.deepEqual(calls[2], [
    "push",
    "/local/.backups/adguard/previous.yaml",
    "/root/tmp/adguardhome.yaml"
  ]);
  assert.match(calls[3][1], /AdGuardHome --check-config/u);
  assert.match(calls[4][1], /\/etc\/init\.d\/adguardhome restart/u);
});
