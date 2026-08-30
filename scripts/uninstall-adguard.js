import { fileURLToPath } from "node:url";
import { buildUninstallAdguardCommand } from "./lib/adguard-lifecycle.js";
import { createRemote } from "./lib/remote.js";

export async function uninstallAdguard(remote) {
  if (!remote.config.adguard) {
    throw new Error("uninstall-adguard requires an adguard section in the project config");
  }

  await remote.exec(
    buildUninstallAdguardCommand(
      remote.config.openwrt.remoteTmpDir,
      remote.config.adguard.dns.port
    )
  );
  console.log("Uninstalled AdGuard Home and removed its managed dnsmasq upstream.");
}

export async function main() {
  await uninstallAdguard(await createRemote());
}

function reportFailure(error) {
  console.error(`openwrt: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(reportFailure);
}
