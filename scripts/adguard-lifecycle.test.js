import assert from "node:assert/strict";
import test from "node:test";
import {
  buildConfigureDnsmasqCommand,
  buildUninstallAdguardCommand
} from "./lib/adguard-lifecycle.js";

test("routes standard dnsmasq upstream through AdGuard Home", () => {
  const command = buildConfigureDnsmasqCommand("/root/tmp", 5353);
  const adguardReadyIndex = command.indexOf(
    "wait_for_tcp_service adguardhome '5353'"
  );
  const backupIndex = command.indexOf('cp /etc/config/dhcp "$backup"');

  assert.ok(adguardReadyIndex >= 0 && adguardReadyIndex < backupIndex);
  assert.match(command, /attempts=10/u);
  assert.match(command, /ncat -z -w 1 127\.0\.0\.1 "\$port"/u);
  assert.match(command, /uci set dhcp\.@dnsmasq\[0\]\.noresolv='1'/u);
  assert.match(
    command,
    /uci add_list dhcp\.@dnsmasq\[0\]\.server="\$managed_server"/u
  );
  assert.match(command, /dnsmasq has custom upstream settings/u);
  assert.match(command, /cp "\$backup" \/etc\/config\/dhcp/u);
  assert.match(command, /\/etc\/init\.d\/dnsmasq restart/u);
  assert.match(command, /wait_for_tcp_service dnsmasq '53'/u);
});

test("restores standard router DNS before uninstalling AdGuard Home", () => {
  const command = buildUninstallAdguardCommand("/root/tmp", 5353);
  const dnsmasqRestartIndex = command.lastIndexOf("/etc/init.d/dnsmasq restart");
  const stopIndex = command.indexOf("/etc/init.d/adguardhome stop");
  const removeIndex = command.indexOf("apk del --purge adguardhome");

  assert.ok(dnsmasqRestartIndex >= 0 && dnsmasqRestartIndex < stopIndex);
  assert.ok(stopIndex >= 0 && stopIndex < removeIndex);
  assert.match(
    command,
    /uci set dhcp\.@dnsmasq\[0\]\.resolvfile='\/tmp\/resolv\.conf\.d\/resolv\.conf\.auto'/u
  );
  assert.match(command, /refusing to remove AdGuard Home/u);
  assert.match(command, /wait_for_tcp_service dnsmasq '53'/u);
  assert.match(command, /rm -rf \/etc\/adguardhome/u);
  assert.match(command, /rm -f '\/root\/tmp\/adguardhome\.yaml'/u);
  assert.doesNotMatch(command, /flow_offloading|10-block-quic/u);
});

test("validates the managed AdGuard Home DNS port", () => {
  assert.throws(
    () => buildConfigureDnsmasqCommand("/root/tmp", "5353; reboot"),
    /DNS port must be an integer/u
  );
  assert.throws(
    () => buildUninstallAdguardCommand("/root/tmp", 65_536),
    /DNS port must be an integer/u
  );
});
