import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  applySingboxConfig,
  prepareSingboxConfig,
  validateSingboxConfigSnapshot
} from "./sync-singbox.js";

const fixturesDirectory = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures/artifacts"
);

test("rejects sync-singbox when its service section is omitted", async () => {
  await assert.rejects(
    prepareSingboxConfig({ config: {}, configPath: "/config/config.yaml" }),
    /sync-singbox requires a singbox section/u
  );
});

test("validates the canonical sing-box config fixtures", async () => {
  const [valid, invalid] = await Promise.all([
    readFile(path.join(fixturesDirectory, "singbox-valid.json")),
    readFile(path.join(fixturesDirectory, "singbox-invalid.json"))
  ]);

  assert.equal(validateSingboxConfigSnapshot(valid).route.final, "direct");
  assert.equal(validateSingboxConfigSnapshot(valid.toString("utf8")).route.final, "direct");
  assert.throws(() => validateSingboxConfigSnapshot(invalid), /Invalid sing-box config JSON/u);
});

test("uploads the validated sing-box snapshot without rereading its configured path", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "sync-singbox-"));
  const snapshot = await readFile(path.join(fixturesDirectory, "singbox-valid.json"));
  const calls = [];
  context.after(() => rm(directory, { recursive: true, force: true }));

  const artifact = {
    snapshot,
    get path() {
      throw new Error("artifact path was reread");
    }
  };
  const remote = {
    localDirectory: directory,
    config: { openwrt: { remoteTmpDir: "/root/tmp" } },
    push: async (sourcePath, remotePath) => {
      calls.push(["push", await readFile(sourcePath), remotePath]);
    },
    exec: async (command) => calls.push(["exec", command])
  };

  await applySingboxConfig(remote, artifact);

  assert.deepEqual(calls[0], ["exec", "mkdir -p '/root/tmp'"]);
  assert.deepEqual(calls[1], ["push", snapshot, "/root/tmp/sing-box.json"]);
  assert.match(calls[2][1], /sing-box check/u);
  assert.match(calls[3][1], /mv -f "\$candidate" '\/etc\/sing-box\/config\.json'/u);
});
