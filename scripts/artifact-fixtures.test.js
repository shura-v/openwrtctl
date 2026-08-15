import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseAdguardRewrites } from "./adguard-config.js";
import { parseNfqws2Resources } from "./nfqws2-config.js";

const fixturesDirectory = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures/artifacts"
);

test("canonical sing-box artifacts cover valid and invalid JSON", async () => {
  const [valid, invalid] = await Promise.all([
    readFixture("singbox-valid.json"),
    readFixture("singbox-invalid.json")
  ]);

  assert.equal(typeof JSON.parse(valid), "object");
  assert.throws(() => JSON.parse(invalid), SyntaxError);
});

test("canonical AdGuard rewrite artifacts cover valid and conflicting values", async () => {
  const [valid, invalid] = await Promise.all([
    readFixture("adguard-rewrites-valid.yaml"),
    readFixture("adguard-rewrites-invalid.yaml")
  ]);

  assert.deepEqual(parseAdguardRewrites(valid), [
    { domain: "example.ru", answer: "192.0.2.10", enabled: true },
    { domain: "*.example.su", answer: "192.0.2.11", enabled: true }
  ]);
  assert.throws(() => parseAdguardRewrites(invalid), /conflicting answers/u);
});

test("canonical nfqws2 resource artifacts cover valid and multiline values", async () => {
  const [valid, invalid] = await Promise.all([
    readFixture("nfqws2-resources-valid.yaml"),
    readFixture("nfqws2-resources-invalid.yaml")
  ]);

  assert.deepEqual(parseNfqws2Resources(valid), {
    userList: ["example.com", "example.net"],
    ipsetList: ["192.0.2.0/24", "2001:db8::/32"]
  });
  assert.throws(() => parseNfqws2Resources(invalid), /resources\.userList\[1\]/u);
});

function readFixture(fileName) {
  return readFile(path.join(fixturesDirectory, fileName), "utf8");
}
