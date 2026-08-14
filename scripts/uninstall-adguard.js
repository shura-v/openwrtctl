import { buildUninstallAdguardCommand } from "./lib/adguard-lifecycle.js";
import { createRemote } from "./lib/remote.js";

main().catch(reportFailure);

async function main() {
  const remote = await createRemote();
  await remote.exec(
    buildUninstallAdguardCommand(
      remote.config.openwrt.remoteTmpDir,
      remote.config.adguard.dnsPort
    )
  );
  console.log("Uninstalled AdGuard Home and removed its managed dnsmasq upstream.");
}

function reportFailure(error) {
  console.error(`openwrt: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
