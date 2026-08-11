import os from "node:os";
import path from "node:path";
import { restoreOpenwrt } from "./lib/openwrt-backup.js";
import { createRemote } from "./lib/remote.js";

main().catch(reportFailure);

async function main() {
  const [archiveArgument, ...extraArguments] = process.argv.slice(2);

  if (!archiveArgument || extraArguments.length > 0) {
    throw new Error("Usage: npm run restore -- <backup.tar.gz>");
  }

  const archivePath = resolveUserPath(archiveArgument);
  const remote = await createRemote();
  await restoreOpenwrt({
    remote,
    archivePath,
    remoteTmpDirectory: remote.config.openwrt.remoteTmpDir
  });

  console.log(`Restored OpenWrt configuration from: ${archivePath}`);
  console.log("Reboot the router to activate the restored configuration.");
}

function resolveUserPath(value) {
  if (value === "~") {
    return os.homedir();
  }

  if (value.startsWith("~/")) {
    return path.join(os.homedir(), value.slice(2));
  }

  return path.resolve(value);
}

function reportFailure(error) {
  console.error(`openwrt: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
