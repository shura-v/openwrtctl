import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { initConfig } from "./init.js";
import { CONFIG_PATH } from "./lib/config-path.js";

test("uses the initialized config as the default CLI config", () => {
  assert.equal(CONFIG_PATH, path.join(os.homedir(), ".config/openwrtctl/config.yaml"));
});

test("creates a private config from the template without overwriting it", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "openwrtctl-init-"));
  const configDirectory = path.join(directory, ".config/openwrtctl");
  const configPath = path.join(configDirectory, "config.yaml");
  const templatePath = path.join(directory, "config.example.yaml");
  await writeFile(templatePath, "openwrt:\n", "utf8");

  const first = await initConfig({ configDirectory, configPath, templatePath });
  assert.equal(first.created, true);
  assert.equal(await readFile(configPath, "utf8"), "openwrt:\n");
  assert.equal((await stat(configPath)).mode & 0o777, 0o600);

  await writeFile(configPath, "preserved\n", "utf8");
  const second = await initConfig({ configDirectory, configPath, templatePath });
  assert.equal(second.created, false);
  assert.equal(await readFile(configPath, "utf8"), "preserved\n");

  context.after(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(directory, { recursive: true, force: true });
  });
});
