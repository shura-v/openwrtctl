import { backupOpenwrt } from "./lib/openwrt-backup.js";
import { createRemote } from "./lib/remote.js";

main().catch(reportFailure);

async function main() {
  const remote = await createRemote();
  const { localPath } = await backupOpenwrt({
    remote,
    remoteTmpDirectory: remote.config.openwrt.remoteTmpDir,
    destinationDirectory: remote.config.backup.directory
  });

  console.log(`Saved OpenWrt backup: ${localPath}`);
}

function reportFailure(error) {
  console.error(`openwrt: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
