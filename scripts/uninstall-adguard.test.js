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
