import { access, chmod, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";
import { $ } from "zx";
import { generateNfqws2Bundle } from "./nfqws2-config.js";
import { applyRemoteNfqws2Bundle } from "./lib/nfqws2-remote-config.js";
import { resolvePackageBin } from "./lib/package-bin.js";
import { createRemote } from "./lib/remote.js";

main().catch(reportFailure);

async function main() {
  const remote = await createRemote();
  const workDirectory = path.join(remote.localDirectory, ".work/nfqws2");
  const sourceConfigPath = path.join(workDirectory, "current.conf");
  const singboxConfigPath = path.join(workDirectory, "singbox-router.json");
  const patchedConfigPath = path.join(workDirectory, "patched.conf");
  const userListPath = path.join(workDirectory, "user.list");
  const ipsetListPath = path.join(workDirectory, "ipset.list");
  const ruleSetsDirectory = remote.config.singboxctl.ruleSetsDirectory;
  const singboxctlPath = resolvePackageBin("singboxctl");
  const stagedConfigPath = `${remote.config.openwrt.remoteTmpDir}/nfqws2.conf`;
  const stagedUserListPath = `${remote.config.openwrt.remoteTmpDir}/nfqws2-user.list`;
  const stagedIpsetListPath = `${remote.config.openwrt.remoteTmpDir}/nfqws2-ipset.list`;
  const run = $({ verbose: true, stdio: "inherit" });

  await requirePath(singboxctlPath, constants.X_OK, "local singboxctl dependency");
  await requirePath(ruleSetsDirectory, constants.R_OK, "rule sets directory");
  await mkdir(workDirectory, { recursive: true });
  await chmod(workDirectory, 0o700);

  try {
    await remote.pull("/opt/zapret2/config", sourceConfigPath);
    await run`${singboxctlPath} generate ${remote.config.singboxctl.profile} ${singboxConfigPath}`;
    await generateNfqws2Bundle({
      sourceConfigPath,
      nfqws2: remote.config.nfqws2,
      singBoxConfigPath: singboxConfigPath,
      ruleSetsDirectoryPath: ruleSetsDirectory,
      remoteTmpDirectory: remote.config.openwrt.remoteTmpDir,
      outputConfigPath: patchedConfigPath,
      outputUserListPath: userListPath,
      outputIpsetListPath: ipsetListPath
    });
    await run`sh -n ${patchedConfigPath}`;
    await remote.push(patchedConfigPath, stagedConfigPath);
    await remote.push(userListPath, stagedUserListPath);
    await remote.push(ipsetListPath, stagedIpsetListPath);
    await applyRemoteNfqws2Bundle(remote, {
      stagedConfigPath,
      stagedUserListPath,
      stagedIpsetListPath,
      userListPath: "/etc/nfqws2/lists/user.list",
      ipsetListPath: "/etc/nfqws2/lists/ipset.list"
    });
  } finally {
    await Promise.all(
      [sourceConfigPath, singboxConfigPath, patchedConfigPath, userListPath, ipsetListPath].map(
        (filePath) => rm(filePath, { force: true })
      )
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
