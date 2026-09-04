import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareLocalArtifact } from "./lib/local-artifact.js";
import { createRemote } from "./lib/remote.js";
import { applyRemoteSingBoxConfig } from "./lib/singbox-lifecycle.js";

export function validateSingboxConfigSnapshot(snapshot) {
  let source;

  if (typeof snapshot === "string") {
    source = snapshot;
  } else {
    try {
      source = new TextDecoder("utf-8", { fatal: true }).decode(snapshot);
    } catch {
      throw new Error("sing-box config artifact must contain valid UTF-8");
    }
  }

  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(
      `Invalid sing-box config JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function prepareSingboxConfig({ config, configPath }) {
  if (!config.singbox) {
    throw new Error("sync-singbox requires a singbox section in the project config");
  }

  return prepareLocalArtifact(config.singbox.config, {
    configPath,
    fieldName: "singbox.config",
    label: "sing-box config",
    validate: validateSingboxConfigSnapshot
  });
}

export async function applySingboxConfig(remote, { snapshot }) {
  const workDirectory = path.join(remote.localDirectory, ".work/singbox");
  const snapshotPath = path.join(workDirectory, "snapshot.json");
  const stagedConfigPath = `${remote.config.openwrt.remoteTmpDir}/sing-box.json`;

  await mkdir(workDirectory, { recursive: true });
  await chmod(workDirectory, 0o700);

  try {
    await writeFile(snapshotPath, snapshot, { mode: 0o600 });
    await remote.exec(`mkdir -p '${remote.config.openwrt.remoteTmpDir}'`);
    await remote.push(snapshotPath, stagedConfigPath);
    await remote.exec(`/usr/bin/sing-box check -c '${stagedConfigPath}'`);
    await applyRemoteSingBoxConfig(remote, stagedConfigPath);
  } finally {
    await rm(snapshotPath, { force: true });
  }
}

export async function main() {
  const remote = await createRemote();
  const artifact = await prepareSingboxConfig(remote);
  await applySingboxConfig(remote, artifact);
}

function reportFailure(error) {
  console.error(`openwrt: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(reportFailure);
}
