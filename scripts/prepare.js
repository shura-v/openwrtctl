import path from "node:path";
import { createRemote, PROJECT_DIRECTORY } from "./lib/remote.js";

const blockQuicRulesPath = path.join(PROJECT_DIRECTORY, "files/block-quic.nft");
const remoteBlockQuicRulesPath = "/etc/nftables.d/10-block-quic.nft";

main().catch(reportFailure);

async function main() {
  const remote = await createRemote();

  await remote.exec(`
set -eu

apk update
apk add rsync curl kmod-nfnetlink-queue kmod-nft-queue

uci set firewall.@defaults[0].flow_offloading="0"
uci set firewall.@defaults[0].flow_offloading_hw="0"
uci -q delete firewall.block_quic || true
uci commit firewall
mkdir -p /etc/nftables.d
chmod 0755 /etc/nftables.d
`);
  await remote.push(blockQuicRulesPath, remoteBlockQuicRulesPath);
  await remote.exec(`
set -eu

fw4 check
/etc/init.d/firewall restart
mkdir -p '${remote.config.openwrt.remoteTmpDir}'
`);
}

function reportFailure(error) {
  console.error(`openwrt: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
