import { access, chmod, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";
import { fileURLToPath } from "node:url";
import { $ } from "zx";
import { generateAdguardConfig } from "./adguard-config.js";
import { createLocalAdguardBackup } from "./lib/adguard-backup.js";
import { buildConfigureDnsmasqCommand } from "./lib/adguard-lifecycle.js";
import { applyRemoteConfig, restoreRemoteConfig } from "./lib/adguard-remote-config.js";
import { resolvePackageBin } from "./lib/package-bin.js";
import { createRemote } from "./lib/remote.js";

async function main() {
  const remote = await createRemote();
  const adguardConfigPath = "/etc/adguardhome/adguardhome.yaml";
  const ruleSetsDirectory = remote.config.singboxctl.ruleSetsDirectory;
  const workDirectory = path.join(remote.localDirectory, ".work/adguard");
  const sourceConfigPath = path.join(workDirectory, "current.yaml");
  const singboxConfigPath = path.join(workDirectory, "singbox-router.json");
  const patchedConfigPath = path.join(workDirectory, "patched.yaml");
  const backupsRoot = path.join(remote.localDirectory, ".backups");
  const remoteStagedConfigPath = `${remote.config.openwrt.remoteTmpDir}/adguardhome.yaml`;
  const singboxctlPath = resolvePackageBin("singboxctl");
  const run = $({ verbose: true, stdio: "inherit" });

  await requirePath(singboxctlPath, constants.X_OK, "local singboxctl dependency");
  await requirePath(ruleSetsDirectory, constants.R_OK, "rule sets directory");
  await mkdir(workDirectory, { recursive: true });
  await chmod(workDirectory, 0o700);

  try {
    await remote.exec(`mkdir -p '${remote.config.openwrt.remoteTmpDir}'`);
    await remote.pull(adguardConfigPath, sourceConfigPath);
    const backupPath = await createLocalAdguardBackup(sourceConfigPath, backupsRoot);
    console.log(`Saved local AdGuard Home backup: ${backupPath}`);
    await run`${singboxctlPath} generate ${remote.config.singboxctl.profile} ${singboxConfigPath}`;
    await generateAdguardConfig({
      sourcePath: sourceConfigPath,
      singBoxConfigPath: singboxConfigPath,
      ruleSetsDirectoryPath: ruleSetsDirectory,
      rewriteIp: remote.config.adguard.rewriteIp,
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
      [sourceConfigPath, singboxConfigPath, patchedConfigPath].map((filePath) =>
        rm(filePath, { force: true })
      )
    );
  }
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

async function requirePath(filePath, mode, label) {
  try {
    await access(filePath, mode);
  } catch {
    throw new Error(`${label} is missing: ${filePath}; run npm install`);
  }
}

function reportFailure(error) {
  console.error(`openwrt: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(reportFailure);
}
