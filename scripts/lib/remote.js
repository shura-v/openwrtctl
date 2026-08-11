import path from "node:path";
import { fileURLToPath } from "node:url";
import { $, which } from "zx";
import { loadProjectConfig } from "./config.js";

const libDirectory = path.dirname(fileURLToPath(import.meta.url));

export const PROJECT_DIRECTORY = path.resolve(libDirectory, "../..");

export async function createRemote() {
  const configPath = path.resolve(
    process.env.OPENWRT_CONFIG_FILE ?? path.join(process.cwd(), "config.yaml")
  );
  const localDirectory = path.dirname(configPath);
  const config = await loadProjectConfig(configPath);
  const sshArguments = [
    "-p",
    String(config.openwrt.sshPort),
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=10"
  ];
  const rsyncShell = `ssh -p ${config.openwrt.sshPort} -o BatchMode=yes -o ConnectTimeout=10`;
  const run = $({ verbose: true, stdio: "inherit" });
  const check = $({ quiet: true, nothrow: true });

  async function exec(command) {
    await run`ssh ${sshArguments} ${config.openwrt.endpoint} ${command}`;
  }

  async function requireRsync() {
    if ((await which("rsync", { nothrow: true })) === null) {
      throw new Error("local rsync is missing");
    }

    const result = await check`ssh ${sshArguments} ${config.openwrt.endpoint} command -v rsync`;

    if (!result.ok) {
      throw new Error("rsync is missing on the router; run npm run prepare-router");
    }
  }

  async function push(localPath, remotePath) {
    await requireRsync();
    await run`rsync -rlpti -e ${rsyncShell} -- ${localPath} ${`${config.openwrt.endpoint}:${remotePath}`}`;
  }

  async function pull(remotePath, localPath) {
    await requireRsync();
    await run`rsync -rlpti -e ${rsyncShell} -- ${`${config.openwrt.endpoint}:${remotePath}`} ${localPath}`;
  }

  return { config, configPath, exec, localDirectory, pull, push };
}
