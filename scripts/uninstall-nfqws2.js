import { buildRemoteUninstallCommand } from "./lib/nfqws2-lifecycle.js";
import { createRemote } from "./lib/remote.js";

main().catch(reportFailure);

async function main() {
  const remote = await createRemote();
  await remote.exec(
    buildRemoteUninstallCommand(remote.config.openwrt.remoteTmpDir)
  );
  console.log("Uninstalled nfqws2 and removed its managed configuration.");
}

function reportFailure(error) {
  console.error(`openwrt: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
