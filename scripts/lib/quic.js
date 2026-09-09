import path from "node:path";
import { PROJECT_DIRECTORY } from "./remote.js";

const blockQuicRulesPath = path.join(PROJECT_DIRECTORY, "files/block-quic.nft");
export const REMOTE_BLOCK_QUIC_RULES_PATH = "/etc/nftables.d/10-block-quic.nft";

export async function disableQuic(remote) {
  await remote.exec(`
set -eu

mkdir -p /etc/nftables.d
chmod 0755 /etc/nftables.d
`);
  await remote.push(blockQuicRulesPath, REMOTE_BLOCK_QUIC_RULES_PATH);
  await remote.exec(`
set -eu

uci -q delete firewall.block_quic || true
uci commit firewall
fw4 check
/etc/init.d/firewall restart
`);
}

export async function enableQuic(remote) {
  await remote.exec(`
set -eu

rm -f '${REMOTE_BLOCK_QUIC_RULES_PATH}'
uci -q delete firewall.block_quic || true
uci commit firewall
fw4 check
/etc/init.d/firewall restart
`);
}
