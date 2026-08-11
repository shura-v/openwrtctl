import { buildRemoteDisableCommand } from "./lib/nfqws2-lifecycle.js";
import { createRemote } from "./lib/remote.js";

main().catch(reportFailure);

async function main() {
  const remote = await createRemote();
  await remote.exec(buildRemoteDisableCommand());
  console.log("Disabled managed nfqws2; installation and config are preserved.");
}

function reportFailure(error) {
  console.error(`openwrt: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
