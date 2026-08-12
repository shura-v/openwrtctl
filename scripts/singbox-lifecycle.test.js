import assert from "node:assert/strict";
import test from "node:test";
import {
  applyRemoteSingBoxConfig,
  buildDisableSingBoxCommand,
  buildInstallSingBoxCommand,
  buildUninstallSingBoxCommand,
  buildUpdateSingBoxCommand,
  SINGBOX_CONFIG_PATH,
  SINGBOX_MARKER_PATH
} from "./lib/singbox-lifecycle.js";

test("disables managed sing-box without removing its config", () => {
  const command = buildDisableSingBoxCommand();
  const disableIndex = command.indexOf("/etc/init.d/sing-box disable");
  const stopIndex = command.indexOf("/etc/init.d/sing-box stop");

  assert.match(command, new RegExp(SINGBOX_MARKER_PATH.replaceAll("/", "\\/"), "u"));
  assert.match(command, /sing-box\.main\.enabled='0'/u);
  assert.ok(disableIndex >= 0 && disableIndex < stopIndex);
  assert.doesNotMatch(command, /\/etc\/init\.d\/sing-box stop \|\| true/u);
  assert.doesNotMatch(command, /apk del|rm -rf|sing-box restart/u);
});

test("installs the full package and keeps sing-box disabled until sync", () => {
  const command = buildInstallSingBoxCommand();

  assert.match(command, /apk add sing-box/u);
  assert.doesNotMatch(command, /sing-box-tiny/u);
  assert.match(command, new RegExp(SINGBOX_MARKER_PATH.replaceAll("/", "\\/"), "u"));
  assert.match(command, /sing-box\.main\.user='root'/u);
  assert.match(command, /sing-box\.main\.enabled='0'/u);
  assert.match(command, /\/etc\/init\.d\/sing-box disable/u);
  assert.doesNotMatch(command, /\/etc\/init\.d\/sing-box (?:enable|start|restart)/u);
});

test("updates only a managed full package and validates its config", () => {
  const command = buildUpdateSingBoxCommand();
  const upgradeIndex = command.indexOf("apk upgrade sing-box");
  const checkIndex = command.indexOf(
    `/usr/bin/sing-box check -c '${SINGBOX_CONFIG_PATH}'`
  );
  const restartIndex = command.indexOf("/etc/init.d/sing-box restart");

  assert.match(command, /apk info -e sing-box/u);
  assert.match(command, new RegExp(SINGBOX_MARKER_PATH.replaceAll("/", "\\/"), "u"));
  assert.ok(upgradeIndex >= 0 && upgradeIndex < checkIndex);
  assert.ok(checkIndex < restartIndex);
  assert.match(command, /sing-box\.main\.user='root'/u);
});

test("uninstalls only a managed package and clears its staged config", () => {
  const command = buildUninstallSingBoxCommand("/root/tmp");
  const markerIndex = command.indexOf(`test -f '${SINGBOX_MARKER_PATH}'`);
  const removeIndex = command.indexOf("apk del --purge sing-box");

  assert.ok(markerIndex >= 0 && markerIndex < removeIndex);
  assert.match(command, /\/etc\/init\.d\/sing-box disable/u);
  assert.match(command, /\/etc\/init\.d\/sing-box stop/u);
  assert.match(command, /rm -rf \/etc\/sing-box/u);
  assert.match(command, /\/root\/tmp\/sing-box\.json/u);
  assert.doesNotMatch(command, /firewall|flow_offloading|block-quic/u);
});

test("validates the staged config before enabling and restarting sing-box", async () => {
  const calls = [];
  const remote = {
    exec: async (command) => calls.push(command)
  };

  await applyRemoteSingBoxConfig(remote, "/root/tmp/sing-box.json");

  assert.equal(calls.length, 1);
  const command = calls[0];
  const checkIndex = command.indexOf('/usr/bin/sing-box check -c "$candidate"');
  const moveIndex = command.indexOf(`mv -f "$candidate" '${SINGBOX_CONFIG_PATH}'`);
  const enableIndex = command.indexOf("uci set sing-box.main.enabled='1'");
  const restartIndex = command.indexOf("/etc/init.d/sing-box restart");

  assert.ok(checkIndex >= 0 && checkIndex < moveIndex);
  assert.ok(moveIndex < enableIndex && enableIndex < restartIndex);
  assert.match(command, /managed config remains installed for diagnostics/u);
});
