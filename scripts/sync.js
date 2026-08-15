#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { createRemote } from "./lib/remote.js";
import { applyAdguardConfig, prepareAdguardRewrites } from "./sync-adguard.js";
import { applyNfqws2Config, prepareNfqws2Resources } from "./sync-nfqws2.js";
import { applySingboxConfig, prepareSingboxConfig } from "./sync-singbox.js";

export async function syncAll({
  remote,
  prepareAdguard = prepareAdguardRewrites,
  prepareSingbox = prepareSingboxConfig,
  prepareNfqws2 = prepareNfqws2Resources,
  applyAdguard = applyAdguardConfig,
  applySingbox = applySingboxConfig,
  applyNfqws2 = applyNfqws2Config
}) {
  const services = [
    remote.config.adguard && { prepare: prepareAdguard, apply: applyAdguard },
    remote.config.singbox && { prepare: prepareSingbox, apply: applySingbox },
    remote.config.nfqws2 && { prepare: prepareNfqws2, apply: applyNfqws2 }
  ].filter(Boolean);

  if (services.length === 0) {
    throw new Error(
      "sync requires at least one configured service section: adguard, singbox, or nfqws2"
    );
  }

  const prepared = [];

  for (const service of services) {
    prepared.push({ ...service, artifact: await service.prepare(remote) });
  }

  for (const service of prepared) {
    await service.apply(remote, service.artifact);
  }
}

export async function main() {
  await syncAll({ remote: await createRemote() });
}

function reportFailure(error) {
  console.error(`openwrt: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(reportFailure);
}
