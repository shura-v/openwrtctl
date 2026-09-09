import { disableQuic } from "./lib/quic.js";
import { createRemote } from "./lib/remote.js";

main().catch(reportFailure);

async function main() {
  const remote = await createRemote();
  await disableQuic(remote);
  console.log("Disabled QUIC: UDP/443 is blocked from LAN and router output.");
}

function reportFailure(error) {
  console.error(`openwrt: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
