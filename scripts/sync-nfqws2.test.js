import assert from "node:assert/strict";
import test from "node:test";
import { prepareNfqws2Resources } from "./sync-nfqws2.js";

test("rejects sync-nfqws2 when its service section is omitted", async () => {
  await assert.rejects(
    prepareNfqws2Resources({ config: {}, configPath: "/config/config.yaml" }),
    /sync-nfqws2 requires an nfqws2 section/u
  );
});
