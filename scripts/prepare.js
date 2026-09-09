import { createRemote } from "./lib/remote.js";

main().catch(reportFailure);

async function main() {
  const remote = await createRemote();

  await remote.exec(`
set -eu

apk update
apk add rsync curl ncat kmod-nfnetlink-queue kmod-nft-queue

uci set firewall.@defaults[0].flow_offloading="0"
uci set firewall.@defaults[0].flow_offloading_hw="0"
uci commit firewall

fw4 check
/etc/init.d/firewall restart
mkdir -p '${remote.config.openwrt.remoteTmpDir}'
`);
}

function reportFailure(error) {
  console.error(`openwrt: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
