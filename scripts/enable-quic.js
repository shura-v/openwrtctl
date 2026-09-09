import { enableQuic } from "./lib/quic.js";
import { createRemote } from "./lib/remote.js";

main().catch(reportFailure);

async function main() {
  const remote = await createRemote();
  await enableQuic(remote);
  console.log("Enabled QUIC: removed the managed UDP/443 block.");
}

function reportFailure(error) {
  console.error(`openwrt: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
