import { buildDisableSingBoxCommand } from "./lib/singbox-lifecycle.js";
import { createRemote } from "./lib/remote.js";

main().catch(reportFailure);

async function main() {
  const remote = await createRemote();
  await remote.exec(buildDisableSingBoxCommand());
  console.log("Disabled managed sing-box; package and config are preserved.");
}

function reportFailure(error) {
  console.error(`openwrt: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
