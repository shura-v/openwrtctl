import assert from "node:assert/strict";
import test from "node:test";
import { buildUninstallAdguardCommand } from "./lib/adguard-lifecycle.js";

test("uninstalls AdGuard Home without reconfiguring the router DNS service", () => {
  const command = buildUninstallAdguardCommand("/root/tmp");
  const stopIndex = command.indexOf("/etc/init.d/adguardhome stop");
  const removeIndex = command.indexOf("apk del --purge adguardhome");

  assert.ok(stopIndex >= 0 && stopIndex < removeIndex);
  assert.match(command, /rm -rf \/etc\/adguardhome/u);
  assert.match(command, /rm -f '\/root\/tmp\/adguardhome\.yaml'/u);
  assert.doesNotMatch(command, /dnsmasq|dhcp\.@dnsmasq/u);
  assert.doesNotMatch(command, /flow_offloading|10-block-quic/u);
});
