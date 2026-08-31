import assert from "node:assert/strict";
import test from "node:test";
import { uninstallAdguard } from "./uninstall-adguard.js";

test("rejects uninstall-adguard when its service section is omitted", async () => {
  const calls = [];

  await assert.rejects(
    uninstallAdguard({
      config: { openwrt: { remoteTmpDir: "/root/tmp" } },
      exec: async (command) => calls.push(command)
    }),
    /uninstall-adguard requires an adguard section/u
  );

  assert.deepEqual(calls, []);
});

test("uses the nested AdGuard DNS port during uninstall", async () => {
  const calls = [];

  await uninstallAdguard({
    config: {
      openwrt: { remoteTmpDir: "/root/tmp" },
      adguard: { dns: { port: 5353 } }
    },
    exec: async (command) => calls.push(command)
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0], /managed_server='127\.0\.0\.1#5353'/u);
});
