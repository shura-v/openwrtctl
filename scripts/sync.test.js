import assert from "node:assert/strict";
import test from "node:test";
import { syncAll } from "./sync.js";

test("prepares every artifact before the first service apply", async () => {
  const calls = [];
  const remote = {
    config: { adguard: {}, singbox: {}, nfqws2: {} },
    configPath: "/config/config.yaml"
  };
  const artifacts = {
    adguard: { validated: [] },
    singbox: { snapshot: Buffer.from("{}") },
    nfqws2: { validated: { userList: [], ipsetList: [] } }
  };

  await syncAll({
    remote,
    prepareAdguard: async (value) => {
      assert.equal(value, remote);
      calls.push("prepare-adguard");
      return artifacts.adguard;
    },
    prepareSingbox: async (value) => {
      assert.equal(value, remote);
      calls.push("prepare-singbox");
      return artifacts.singbox;
    },
    prepareNfqws2: async (value) => {
      assert.equal(value, remote);
      calls.push("prepare-nfqws2");
      return artifacts.nfqws2;
    },
    applyAdguard: async (value, artifact) => {
      assert.equal(value, remote);
      assert.equal(artifact, artifacts.adguard);
      calls.push("apply-adguard");
    },
    applySingbox: async (value, artifact) => {
      assert.equal(value, remote);
      assert.equal(artifact, artifacts.singbox);
      calls.push("apply-singbox");
    },
    applyNfqws2: async (value, artifact) => {
      assert.equal(value, remote);
      assert.equal(artifact, artifacts.nfqws2);
      calls.push("apply-nfqws2");
    }
  });

  assert.deepEqual(calls, [
    "prepare-adguard",
    "prepare-singbox",
    "prepare-nfqws2",
    "apply-adguard",
    "apply-singbox",
    "apply-nfqws2"
  ]);
});

test("a failure in the third producer causes zero remote mutation calls", async () => {
  const mutations = [];

  await assert.rejects(
    syncAll({
      remote: { config: { adguard: {}, singbox: {}, nfqws2: {} } },
      prepareAdguard: async () => ({ validated: [] }),
      prepareSingbox: async () => ({ snapshot: Buffer.from("{}") }),
      prepareNfqws2: async () => {
        throw new Error("nfqws2 producer failed");
      },
      applyAdguard: async () => mutations.push("adguard"),
      applySingbox: async () => mutations.push("singbox"),
      applyNfqws2: async () => mutations.push("nfqws2")
    }),
    /nfqws2 producer failed/u
  );

  assert.deepEqual(mutations, []);
});

test("a sing-box-only sync skips omitted services", async () => {
  const calls = [];
  const artifact = { snapshot: "{}" };

  await syncAll({
    remote: { config: { singbox: {} } },
    prepareAdguard: async () => assert.fail("AdGuard prepare must be skipped"),
    prepareSingbox: async () => {
      calls.push("prepare-singbox");
      return artifact;
    },
    prepareNfqws2: async () => assert.fail("nfqws2 prepare must be skipped"),
    applyAdguard: async () => assert.fail("AdGuard apply must be skipped"),
    applySingbox: async (_remote, value) => {
      assert.equal(value, artifact);
      calls.push("apply-singbox");
    },
    applyNfqws2: async () => assert.fail("nfqws2 apply must be skipped")
  });

  assert.deepEqual(calls, ["prepare-singbox", "apply-singbox"]);
});

test("a mixed sync preserves configured service order and prepare-all boundary", async () => {
  const calls = [];

  await syncAll({
    remote: { config: { adguard: {}, nfqws2: {} } },
    prepareAdguard: async () => {
      calls.push("prepare-adguard");
      return { validated: [] };
    },
    prepareSingbox: async () => assert.fail("sing-box prepare must be skipped"),
    prepareNfqws2: async () => {
      calls.push("prepare-nfqws2");
      return { validated: { userList: [], ipsetList: [] } };
    },
    applyAdguard: async () => calls.push("apply-adguard"),
    applySingbox: async () => assert.fail("sing-box apply must be skipped"),
    applyNfqws2: async () => calls.push("apply-nfqws2")
  });

  assert.deepEqual(calls, [
    "prepare-adguard",
    "prepare-nfqws2",
    "apply-adguard",
    "apply-nfqws2"
  ]);
});

test("sync rejects a config with no configured services before preparation", async () => {
  const calls = [];

  await assert.rejects(
    syncAll({
      remote: { config: {} },
      prepareAdguard: async () => calls.push("prepare-adguard"),
      prepareSingbox: async () => calls.push("prepare-singbox"),
      prepareNfqws2: async () => calls.push("prepare-nfqws2"),
      applyAdguard: async () => calls.push("apply-adguard"),
      applySingbox: async () => calls.push("apply-singbox"),
      applyNfqws2: async () => calls.push("apply-nfqws2")
    }),
    /sync requires at least one configured service section/u
  );

  assert.deepEqual(calls, []);
});
