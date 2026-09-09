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

test("preserves the manual QUIC setting", async () => {
  const prepareScript = await readFile(
    path.join(PROJECT_DIRECTORY, "scripts/prepare.js"),
    "utf8"
  );

  assert.doesNotMatch(prepareScript, /quic|nftables\.d|remote\.push/iu);
});

test("installs ncat for nfqws2 blockcheck port tests", async () => {
  const prepareScript = await readFile(
    path.join(PROJECT_DIRECTORY, "scripts/prepare.js"),
    "utf8"
  );

  assert.match(prepareScript, /apk add[^\n]*\bncat\b/u);
});
