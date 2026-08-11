import { buildUninstallSingBoxCommand } from "./lib/singbox-lifecycle.js";
import { createRemote } from "./lib/remote.js";

main().catch(reportFailure);

async function main() {
  const remote = await createRemote();
  await remote.exec(
    buildUninstallSingBoxCommand(remote.config.openwrt.remoteTmpDir)
  );
  console.log("Uninstalled managed sing-box.");
}

function reportFailure(error) {
  console.error(`openwrt: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
