import { chmod, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateAdguardConfig, parseAdguardRewrites } from "./adguard-config.js";
import { createLocalAdguardBackup } from "./lib/adguard-backup.js";
import { buildConfigureDnsmasqCommand } from "./lib/adguard-lifecycle.js";
import { applyRemoteConfig, restoreRemoteConfig } from "./lib/adguard-remote-config.js";
import { prepareLocalArtifact } from "./lib/local-artifact.js";
import { createRemote } from "./lib/remote.js";

export async function prepareAdguardRewrites({ config, configPath }) {
  if (!config.adguard) {
    throw new Error("sync-adguard requires an adguard section in the project config");
  }

  return prepareLocalArtifact(config.adguard.rewrites, {
    configPath,
    fieldName: "adguard.rewrites",
    label: "AdGuard rewrites",
    validate: parseAdguardRewrites
  });
}

export async function applyAdguardConfig(remote, { validated: rewrites }) {
  const adguardConfigPath = "/etc/adguardhome/adguardhome.yaml";
  const workDirectory = path.join(remote.localDirectory, ".work/adguard");
  const sourceConfigPath = path.join(workDirectory, "current.yaml");
  const patchedConfigPath = path.join(workDirectory, "patched.yaml");
  const backupsRoot = path.join(remote.localDirectory, ".backups");
  const remoteStagedConfigPath = `${remote.config.openwrt.remoteTmpDir}/adguardhome.yaml`;

  await mkdir(workDirectory, { recursive: true });
  await chmod(workDirectory, 0o700);

  try {
    await remote.exec(`mkdir -p '${remote.config.openwrt.remoteTmpDir}'`);
    await remote.pull(adguardConfigPath, sourceConfigPath);
    const backupPath = await createLocalAdguardBackup(sourceConfigPath, backupsRoot);
    console.log(`Saved local AdGuard Home backup: ${backupPath}`);
    await generateAdguardConfig({
      sourcePath: sourceConfigPath,
      rewrites,
      querylogInterval: remote.config.adguard.querylogInterval,
      webPort: String(remote.config.adguard.webPort),
      dnsPort: String(remote.config.adguard.dnsPort),
      upstreamDns: remote.config.adguard.upstreamDns,
      bootstrapDns: remote.config.adguard.bootstrapDns,
      upstreamMode: remote.config.adguard.upstreamMode,
      outputPath: patchedConfigPath
    });
    await remote.push(patchedConfigPath, remoteStagedConfigPath);
    await remote.exec(`AdGuardHome --check-config -c '${remoteStagedConfigPath}'`);

    await applyAdguardConfigTransaction({
      remote,
      backupPath,
      remoteStagedConfigPath,
      adguardConfigPath,
      configureDnsmasqCommand: buildConfigureDnsmasqCommand(
        remote.config.openwrt.remoteTmpDir,
        remote.config.adguard.dnsPort
      )
    });
  } finally {
    await Promise.all(
      [sourceConfigPath, patchedConfigPath].map((filePath) => rm(filePath, { force: true }))
    );
  }
}

export async function main() {
  const remote = await createRemote();
  const artifact = await prepareAdguardRewrites(remote);
  await applyAdguardConfig(remote, artifact);
}

export async function applyAdguardConfigTransaction({
  remote,
  backupPath,
  remoteStagedConfigPath,
  adguardConfigPath,
  configureDnsmasqCommand
}) {
  try {
    await applyRemoteConfig(remote, remoteStagedConfigPath, adguardConfigPath);
    await remote.exec(configureDnsmasqCommand);
  } catch (applyError) {
    await restoreRemoteConfig(
      remote,
      backupPath,
      remoteStagedConfigPath,
      adguardConfigPath,
      applyError
    );
  }
}

function reportFailure(error) {
  console.error(`openwrt: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(reportFailure);
}
