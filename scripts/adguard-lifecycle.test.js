import assert from "node:assert/strict";
import test from "node:test";
import { buildUninstallAdguardCommand } from "./lib/adguard-lifecycle.js";

test("uninstalls AdGuard Home after restoring dnsmasq on port 53", () => {
  const command = buildUninstallAdguardCommand("/root/tmp");
  const stopIndex = command.indexOf("/etc/init.d/adguardhome stop");
  const dnsmasqIndex = command.indexOf('uci set dhcp.@dnsmasq[0].port="53"');
  const removeIndex = command.indexOf("apk del --purge adguardhome");

  assert.ok(stopIndex >= 0 && stopIndex < dnsmasqIndex);
  assert.ok(dnsmasqIndex < removeIndex);
  assert.match(command, /rm -rf \/etc\/adguardhome/u);
  assert.match(command, /rm -f '\/root\/tmp\/adguardhome\.yaml'/u);
  assert.doesNotMatch(command, /flow_offloading|10-block-quic/u);
});
