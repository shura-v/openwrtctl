import { constants } from "node:fs";
import { access, chmod, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { $ } from "zx";
import { applyRemoteSingBoxConfig } from "./lib/singbox-lifecycle.js";
import { resolvePackageBin } from "./lib/package-bin.js";
import { createRemote } from "./lib/remote.js";
import { generateSingBoxConfig } from "./singbox-config.js";

main().catch(reportFailure);

async function main() {
  const remote = await createRemote();
  const workDirectory = path.join(remote.localDirectory, ".work/singbox");
  const generatedConfigPath = path.join(workDirectory, "generated.json");
  const patchedConfigPath = path.join(workDirectory, "patched.json");
  const ruleSetsDirectory = remote.config.singboxctl.ruleSetsDirectory;
  const singboxctlPath = resolvePackageBin("singboxctl");
  const stagedConfigPath = `${remote.config.openwrt.remoteTmpDir}/sing-box.json`;
  const run = $({ verbose: true, stdio: "inherit" });

  await requirePath(singboxctlPath, constants.X_OK, "local singboxctl dependency");
  await requirePath(ruleSetsDirectory, constants.R_OK, "rule sets directory");
  await mkdir(workDirectory, { recursive: true });
  await chmod(workDirectory, 0o700);

  try {
    await run`${singboxctlPath} generate ${remote.config.singboxctl.profile} ${generatedConfigPath}`;
    await chmod(generatedConfigPath, 0o600);
    await generateSingBoxConfig({
      sourcePath: generatedConfigPath,
      ruleSetsDirectoryPath: ruleSetsDirectory,
      outputPath: patchedConfigPath
    });
    await remote.push(patchedConfigPath, stagedConfigPath);
    await remote.exec(`/usr/bin/sing-box check -c '${stagedConfigPath}'`);
    await applyRemoteSingBoxConfig(remote, stagedConfigPath);
  } finally {
    await Promise.all(
      [generatedConfigPath, patchedConfigPath].map((filePath) =>
        rm(filePath, { force: true })
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
