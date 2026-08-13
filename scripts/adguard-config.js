#!/usr/bin/env node

import { isIP } from "node:net";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parse, parseDocument } from "yaml";
import { loadRouterResources } from "./lib/router-resources.js";

export function buildAdguardRewrites(resources, rewriteIp) {
  if (isIP(rewriteIp) === 0) {
    throw new Error(`ADGUARD_REWRITE_IP must be an IP address: ${JSON.stringify(rewriteIp)}`);
  }

  const rewrites = new Map();

  for (const resource of resources) {
    if (resource.route !== "dns") {
      continue;
    }

    if (resource.kind === "domain") {
      rewrites.set(resource.value, makeRewrite(resource.value, rewriteIp));
      continue;
    }

    if (resource.kind === "domain_suffix") {
      rewrites.set(resource.value, makeRewrite(resource.value, rewriteIp));
      rewrites.set(`*.${resource.value}`, makeRewrite(`*.${resource.value}`, rewriteIp));
    }
  }

  return [...rewrites.values()].sort((left, right) => left.domain.localeCompare(right.domain));
}

export function patchAdguardConfig(sourceYaml, {
  rewrites,
  querylogInterval,
  webPort,
  dnsPort,
  upstreamDns,
  bootstrapDns,
  upstreamMode
}) {
  if (!/^[1-9]\d*(?:h|d)$/u.test(querylogInterval)) {
    throw new Error(
      `ADGUARD_QUERYLOG_INTERVAL must be a positive number of hours or days: ${JSON.stringify(querylogInterval)}`
    );
  }

  if (!/^\d+$/u.test(webPort) || Number(webPort) < 1 || Number(webPort) > 65535) {
    throw new Error(`ADGUARD_WEB_PORT must be an integer from 1 to 65535: ${JSON.stringify(webPort)}`);
  }

  if (!/^\d+$/u.test(dnsPort) || Number(dnsPort) < 1 || Number(dnsPort) > 65535) {
    throw new Error(`ADGUARD_DNS_PORT must be an integer from 1 to 65535: ${JSON.stringify(dnsPort)}`);
  }

  const document = parseDocument(sourceYaml);

  if (document.errors.length > 0) {
    throw new Error(`Invalid AdGuard Home YAML: ${document.errors[0].message}`);
  }

  const currentConfig = document.toJS();

  if (
    !isRecord(currentConfig?.dns) ||
    !isRecord(currentConfig?.filtering) ||
    !isRecord(currentConfig?.querylog) ||
    !isRecord(currentConfig?.http)
  ) {
    throw new Error("AdGuard Home config must contain dns, filtering, querylog, and http mappings");
  }

  const currentWebAddress = currentConfig.http.address;

  if (typeof currentWebAddress !== "string" || !currentWebAddress.includes(":")) {
    throw new Error(`AdGuard Home http.address must include a port: ${JSON.stringify(currentWebAddress)}`);
  }

  document.setIn(["dns", "upstream_dns"], upstreamDns);
  document.setIn(["dns", "bootstrap_dns"], bootstrapDns);
  document.setIn(["dns", "upstream_mode"], upstreamMode);
  document.setIn(["dns", "port"], Number(dnsPort));
  document.setIn(["filtering", "rewrites"], rewrites);
  document.setIn(["querylog", "interval"], querylogInterval);
  document.setIn(["http", "address"], replaceAddressPort(currentWebAddress, webPort));

  const patchedYaml = document.toString();
  parse(patchedYaml);
  return patchedYaml;
}

export async function generateAdguardConfig({
  sourcePath,
  singBoxConfigPath,
  ruleSetsDirectoryPath,
  rewriteIp,
  querylogInterval,
  webPort,
  dnsPort,
  upstreamDns,
  bootstrapDns,
  upstreamMode,
  outputPath
}) {
  const resources = await loadRouterResources(singBoxConfigPath, ruleSetsDirectoryPath);
  const rewrites = buildAdguardRewrites(resources, rewriteIp);
  const patchedYaml = patchAdguardConfig(await readFile(sourcePath, "utf8"), {
    rewrites,
    querylogInterval,
    webPort,
    dnsPort,
    upstreamDns,
    bootstrapDns,
    upstreamMode
  });
  await writeFile(outputPath, patchedYaml, { encoding: "utf8", mode: 0o600 });
  console.log(`Patched AdGuard Home config: ${resources.length} router resources, ${rewrites.length} rewrites`);
}

async function main() {
  const [
    sourcePath,
    singBoxConfigPath,
    ruleSetsDirectoryPath,
    rewriteIp,
    querylogInterval,
    webPort,
    dnsPort,
    upstreamDnsJson,
    bootstrapDnsJson,
    upstreamMode,
    outputPath
  ] = process.argv.slice(2);

  if (
    !sourcePath ||
    !singBoxConfigPath ||
    !ruleSetsDirectoryPath ||
    !rewriteIp ||
    !querylogInterval ||
    !webPort ||
    !dnsPort ||
    !upstreamDnsJson ||
    !bootstrapDnsJson ||
    !upstreamMode ||
    !outputPath
  ) {
    throw new Error(
      "Usage: adguard-config.js <source-yaml> <sing-box-config> <rule-sets-directory> <rewrite-ip> <querylog-interval> <web-port> <dns-port> <upstream-dns-json> <bootstrap-dns-json> <upstream-mode> <output-yaml>"
    );
  }

  await generateAdguardConfig({
    sourcePath,
    singBoxConfigPath,
    ruleSetsDirectoryPath,
    rewriteIp,
    querylogInterval,
    webPort,
    dnsPort,
    upstreamDns: JSON.parse(upstreamDnsJson),
    bootstrapDns: JSON.parse(bootstrapDnsJson),
    upstreamMode,
    outputPath
  });
}

function makeRewrite(domain, answer) {
  return { domain, answer, enabled: true };
}

function replaceAddressPort(address, port) {
  return `${address.slice(0, address.lastIndexOf(":"))}:${port}`;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(`openwrt: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
