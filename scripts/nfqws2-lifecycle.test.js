import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRemoteDisableCommand,
  buildRemoteUninstallCommand,
  buildRemoteUpdateCommand,
  updateNfqws2Release
} from "./lib/nfqws2-lifecycle.js";
import {
  createNfqws2Release,
  NFQWS2_RELEASE
} from "./lib/nfqws2-release.js";

test("updates only a managed nfqws2 installation and preserves its config", () => {
  const command = buildRemoteUpdateCommand("/root/tmp/zapret2.tar.gz");
  const markerIndex = command.indexOf('"$target/.openwrt-router-tools-version"');
  const preserveIndex = command.indexOf('cp "$target/config" "$source_dir/config"');
  const validateIndex = command.indexOf('"$source_dir/nfq2/nfqws2" --dry-run');
  const replaceIndex = command.indexOf('mv "$target" "$previous"');

  assert.ok(markerIndex >= 0 && markerIndex < preserveIndex);
  assert.ok(preserveIndex < validateIndex && validateIndex < replaceIndex);
  assert.match(command, new RegExp(NFQWS2_RELEASE.archiveSha256, "u"));
  assert.match(command, new RegExp(NFQWS2_RELEASE.binarySha256ByTarget.arm64, "u"));
  assert.match(command, /zapret-auto\.lua/u);
  assert.match(command, /quic_initial_www_google_com\.bin/u);
  assert.match(command, /--dry-run --qnum=300 --user=root/u);
  assert.match(command, /previous version restored/u);
  assert.doesNotMatch(command, /github\.com|\bcurl\b/u);
});

test("uploads and removes the selected archive after a successful update", async () => {
  const calls = [];
  const remote = {
    config: { openwrt: { remoteTmpDir: "/root/tmp" } },
    push: async (source, destination) => calls.push(["push", source, destination]),
    exec: async (command) => calls.push(["exec", command])
  };

  await updateNfqws2Release(remote, "/local/zapret2.tar.gz");

  assert.deepEqual(calls[0], [
    "push",
    "/local/zapret2.tar.gz",
    "/root/tmp/zapret2-release.tar.gz"
  ]);
  assert.match(calls[1][1], /nfqws2 update failed/u);
  assert.deepEqual(calls[2], [
    "exec",
    "rm -f '/root/tmp/zapret2-release.tar.gz'"
  ]);
});

test("updates to an explicitly selected release", () => {
  const release = {
    ...createNfqws2Release("1.0.3"),
    archiveSha256: "c".repeat(64),
    binarySha256ByTarget: { arm64: "d".repeat(64) }
  };
  const command = buildRemoteUpdateCommand(
    "/root/tmp/zapret2-release.tar.gz",
    release
  );

  assert.match(command, /zapret2-v1\.0\.3/u);
  assert.match(command, new RegExp("c".repeat(64), "u"));
  assert.match(command, new RegExp("d".repeat(64), "u"));
  assert.match(command, /'1\.0\.3' >.*openwrt-router-tools-version/u);
});

test("uninstalls only a marked nfqws2 target and clears its nftables table", () => {
  const command = buildRemoteUninstallCommand("/root/tmp");
  const markerIndex = command.indexOf('"$target/.openwrt-router-tools-version"');
  const stopIndex = command.indexOf("/etc/init.d/zapret2 stop");
  const removeIndex = command.indexOf('rm -rf "$target"');
  const configRemoveIndex = command.indexOf("rm -rf /etc/nfqws2");
  const guardEndIndex = command.indexOf("\nfi\n", removeIndex);

  assert.ok(markerIndex >= 0 && markerIndex < stopIndex);
  assert.ok(stopIndex < removeIndex);
  assert.ok(guardEndIndex < configRemoveIndex);
  assert.match(command, /readlink \/etc\/init\.d\/zapret2/u);
  assert.match(command, /readlink \/etc\/hotplug\.d\/iface\/90-zapret2/u);
  assert.match(command, /nft delete table inet zapret2/u);
  assert.match(command, /zapret2-release\.tar\.gz/u);
  assert.match(command, /zapret2-install/u);
  assert.match(command, /zapret2-update/u);
  assert.doesNotMatch(command, /flow_offloading|10-block-quic/u);
});

test("disables managed nfqws2 without removing its installation", () => {
  const command = buildRemoteDisableCommand();

  assert.match(command, /\.openwrt-router-tools-version/u);
  assert.match(command, /\/etc\/init\.d\/zapret2 stop/u);
  assert.match(command, /\/etc\/init\.d\/zapret2 disable/u);
  assert.match(command, /NFQWS2_ENABLE=0/u);
  assert.match(command, /nft delete table inet zapret2/u);
  assert.doesNotMatch(command, /rm -rf|rm -f|apk del/u);
});
