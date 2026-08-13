import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { PROJECT_DIRECTORY } from "./lib/remote.js";

test("does not reconfigure the router DNS service", async () => {
  const prepareScript = await readFile(
    path.join(PROJECT_DIRECTORY, "scripts/prepare.js"),
    "utf8"
  );

  assert.doesNotMatch(prepareScript, /dnsmasq|dhcp\.@dnsmasq/u);
});

test("blocks QUIC before sing-box routing and from router output", async () => {
  const rules = await readFile(
    path.join(PROJECT_DIRECTORY, "files/block-quic.nft"),
    "utf8"
  );

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
