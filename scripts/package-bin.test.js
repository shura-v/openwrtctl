import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import test from "node:test";
import { resolvePackageBin } from "./lib/package-bin.js";

test("resolves dependency executables without relying on the caller PATH", async () => {
  const singboxctlPath = resolvePackageBin("singboxctl");

  assert.match(singboxctlPath, /singboxctl\/dist\/index\.js$/u);
  await access(singboxctlPath, constants.X_OK);
});
