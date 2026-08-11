import { buildInstallSingBoxCommand } from "./lib/singbox-lifecycle.js";
import { createRemote } from "./lib/remote.js";

main().catch(reportFailure);

async function main() {
  const remote = await createRemote();
  await remote.exec(buildInstallSingBoxCommand());
  console.log("Installed sing-box; the service is disabled until sync-singbox.");
}

function reportFailure(error) {
  console.error(`openwrt: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
