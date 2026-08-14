#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { $ } from "zx";
import { CONFIG_PATH, USER_HOME } from "../scripts/lib/config-path.js";

const rootDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

const COMMANDS = new Map([
  ["init", ["init.js"]],
  ["doctor", ["doctor.js"]],
  ["backup", ["backup.js"]],
  ["prepare", ["prepare.js"]],
  ["prepare-router", ["prepare.js"]],
  ["restore", ["restore.js"]],
  ["install-adguard", ["install-adguard.js"]],
  ["uninstall-adguard", ["uninstall-adguard.js"]],
  ["install-singbox", ["install-singbox.js"]],
  ["disable-singbox", ["disable-singbox.js"]],
  ["update-singbox", ["update-singbox.js"]],
  ["uninstall-singbox", ["uninstall-singbox.js"]],
  ["install-nfqws2", ["install-nfqws2.js"]],
  ["disable-nfqws2", ["disable-nfqws2.js"]],
  ["update-nfqws2", ["update-nfqws2.js"]],
  ["uninstall-nfqws2", ["uninstall-nfqws2.js"]],
  ["test-nfqws2", ["test-nfqws2.js"]],
  ["test-nfqws2-results", ["test-nfqws2-results.js"]],
  ["sync-adguard", ["sync-adguard.js"]],
  ["sync-singbox", ["sync-singbox.js"]],
  ["sync-nfqws2", ["sync-nfqws2.js"]],
  ["sync", ["sync-adguard.js", "sync-singbox.js", "sync-nfqws2.js"]]
]);

main().catch((error) => {
  console.error(`openwrtctl: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

async function main() {
  const arguments_ = process.argv.slice(2);

  if (arguments_.includes("--help") || arguments_.includes("-h")) {
    printHelp();
    return;
  }

  const configPath = takeConfigPath(arguments_);
  const command = arguments_.shift();
  const scripts = COMMANDS.get(command);

  if (!scripts) {
    printHelp();
    throw new Error(command ? `unknown command: ${command}` : "command is required");
  }

  const run = $({
    env: {
      ...process.env,
      OPENWRT_CONFIG_FILE: configPath
    },
    stdio: "inherit"
  });

  for (const script of scripts) {
    await run`${process.execPath} ${path.join(rootDirectory, "scripts", script)} ${arguments_}`;
  }
}

function takeConfigPath(arguments_) {
  let configuredPath = process.env.OPENWRT_CONFIG_FILE;

  if (arguments_[0] === "--config") {
    arguments_.shift();
    configuredPath = arguments_.shift();
  } else if (arguments_[0]?.startsWith("--config=")) {
    configuredPath = arguments_.shift().slice("--config=".length);
  }

  if (!configuredPath) {
    return CONFIG_PATH;
  }

  if (configuredPath === "~") {
    return USER_HOME;
  }

  if (configuredPath.startsWith("~/")) {
    return path.join(USER_HOME, configuredPath.slice(2));
  }

  return path.resolve(configuredPath);
}

function printHelp() {
  console.log(`Usage: openwrtctl [--config <path>] <command> [arguments]

Commands:
  init                doctor              backup              restore             prepare-router
  install-adguard     uninstall-adguard     sync-adguard
  install-singbox     disable-singbox       update-singbox        uninstall-singbox     sync-singbox
  install-nfqws2      disable-nfqws2        update-nfqws2         uninstall-nfqws2      sync-nfqws2
  test-nfqws2         test-nfqws2-results
  sync
`);
}
