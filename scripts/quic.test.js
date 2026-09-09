import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { disableQuic, enableQuic, REMOTE_BLOCK_QUIC_RULES_PATH } from "./lib/quic.js";
import { PROJECT_DIRECTORY } from "./lib/remote.js";

test("disables QUIC by uploading the LAN and router rules before applying firewall", async () => {
  const calls = [];
  await disableQuic({
    exec: async (command) => calls.push(["exec", command]),
    push: async (...paths) => calls.push(["push", ...paths])
  });

  assert.equal(calls.length, 3);
  assert.match(calls[0][1], /mkdir -p \/etc\/nftables\.d/u);
  assert.deepEqual(calls[1], [
    "push",
    path.join(PROJECT_DIRECTORY, "files/block-quic.nft"),
    REMOTE_BLOCK_QUIC_RULES_PATH
  ]);
  assert.match(calls[2][1], /uci -q delete firewall\.block_quic \|\| true/u);
  assert.match(calls[2][1], /fw4 check\n\/etc\/init\.d\/firewall restart/u);
  assert.doesNotMatch(calls.map((call) => call[1]).join("\n"), /flow_offloading|apk /u);

  const rules = await readFile(calls[1][1], "utf8");
  assert.match(
    rules,
    /hook prerouting priority raw - 1;[\s\S]*iifname \$lan_devices udp dport 443[\s\S]*reject/u
  );
  assert.match(
    rules,
    /hook output priority raw - 1;[\s\S]*udp dport 443[\s\S]*reject/u
  );
  assert.doesNotMatch(rules, /\bwan\b/u);
});

test("enables QUIC by removing both current and legacy managed blocks", async () => {
  const calls = [];
  await enableQuic({ exec: async (command) => calls.push(command) });

  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes(`rm -f '${REMOTE_BLOCK_QUIC_RULES_PATH}'`));
  assert.match(calls[0], /uci -q delete firewall\.block_quic \|\| true/u);
  assert.match(calls[0], /fw4 check\n\/etc\/init\.d\/firewall restart/u);
  assert.doesNotMatch(calls[0], /flow_offloading|apk |rm -rf/u);
});

test("does not apply firewall changes after a failed QUIC rules upload", async () => {
  const calls = [];
  await assert.rejects(disableQuic({
    exec: async (command) => calls.push(command),
    push: async () => { throw new Error("upload failed"); }
  }), /upload failed/u);

  assert.equal(calls.length, 1);
  assert.doesNotMatch(calls[0], /uci |firewall restart/u);
});

test("propagates firewall failures from both manual QUIC commands", async () => {
  for (const action of [disableQuic, enableQuic]) {
    await assert.rejects(action({
      exec: async (command) => {
        if (command.includes("fw4 check")) throw new Error("firewall check failed");
      },
      push: async () => {}
    }), /firewall check failed/u);
  }
});
