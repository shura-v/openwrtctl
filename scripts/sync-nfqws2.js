import { chmod, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { $ } from "zx";
import { prepareLocalArtifact } from "./lib/local-artifact.js";
import { applyRemoteNfqws2Bundle } from "./lib/nfqws2-remote-config.js";
import { createRemote } from "./lib/remote.js";
import { generateNfqws2Bundle, parseNfqws2Resources } from "./nfqws2-config.js";

export async function prepareNfqws2Resources({ config, configPath }) {
  if (!config.nfqws2) {
    throw new Error("sync-nfqws2 requires an nfqws2 section in the project config");
  }

  return prepareLocalArtifact(config.nfqws2.resources, {
    configPath,
    fieldName: "nfqws2.resources",
    label: "nfqws2 resources",
    validate: parseNfqws2Resources
  });
}

export async function applyNfqws2Config(remote, { validated: resources }) {
  const workDirectory = path.join(remote.localDirectory, ".work/nfqws2");
  const sourceConfigPath = path.join(workDirectory, "current.conf");
  const patchedConfigPath = path.join(workDirectory, "patched.conf");
  const userListPath = path.join(workDirectory, "user.list");
  const ipsetListPath = path.join(workDirectory, "ipset.list");
  const stagedConfigPath = `${remote.config.openwrt.remoteTmpDir}/nfqws2.conf`;
  const stagedUserListPath = `${remote.config.openwrt.remoteTmpDir}/nfqws2-user.list`;
  const stagedIpsetListPath = `${remote.config.openwrt.remoteTmpDir}/nfqws2-ipset.list`;
  const run = $({ verbose: true, stdio: "inherit" });

  await mkdir(workDirectory, { recursive: true });
  await chmod(workDirectory, 0o700);

  try {
    await remote.pull("/opt/zapret2/config", sourceConfigPath);
    await generateNfqws2Bundle({
      sourceConfigPath,
      nfqws2: remote.config.nfqws2,
      resources,
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
      [sourceConfigPath, patchedConfigPath, userListPath, ipsetListPath].map((filePath) =>
        rm(filePath, { force: true })
      )
    );
  }
}

export async function main() {
  const remote = await createRemote();
  const artifact = await prepareNfqws2Resources(remote);
  await applyNfqws2Config(remote, artifact);
}

function reportFailure(error) {
  console.error(`openwrt: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(reportFailure);
}
