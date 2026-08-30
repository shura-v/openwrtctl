#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parse, parseDocument } from "yaml";
import { parseAdguardSettings } from "./lib/adguard-settings.js";

export function parseAdguardRewrites(sourceYaml) {
  const document = parseDocument(decodeYaml(sourceYaml, "AdGuard rewrites artifact"));

  if (document.errors.length > 0) {
    throw new Error(`Invalid AdGuard rewrites YAML: ${document.errors[0].message}`);
  }

  const rewrites = document.toJS();

  if (!Array.isArray(rewrites)) {
    throw new Error("AdGuard rewrites artifact must be a top-level YAML sequence");
  }

  const answersByDomain = new Map();
  const normalizedRewrites = [];

  for (const [index, rewrite] of rewrites.entries()) {
    const fieldName = `AdGuard rewrites[${index}]`;

    if (!isRecord(rewrite)) {
      throw new Error(`${fieldName} must be a mapping`);
    }

    validateRewriteValue(rewrite.domain, `${fieldName}.domain`);
    validateRewriteValue(rewrite.answer, `${fieldName}.answer`);

    if (rewrite.enabled !== undefined && typeof rewrite.enabled !== "boolean") {
      throw new Error(`${fieldName}.enabled must be a boolean`);
    }

    const previousAnswer = answersByDomain.get(rewrite.domain);

    if (previousAnswer !== undefined && previousAnswer !== rewrite.answer) {
      throw new Error(
        `AdGuard rewrites artifact has conflicting answers for domain ${JSON.stringify(rewrite.domain)}`
      );
    }

    answersByDomain.set(rewrite.domain, rewrite.answer);
    normalizedRewrites.push({
      ...rewrite,
      enabled: rewrite.enabled ?? true
    });
  }

  return normalizedRewrites;
}

export function parseAdguardUserRules(sourceYaml) {
  const document = parseDocument(decodeYaml(sourceYaml, "AdGuard user rules artifact"));

  if (document.errors.length > 0) {
    throw new Error(`Invalid AdGuard user rules YAML: ${document.errors[0].message}`);
  }

  const userRules = document.toJS();

  if (!Array.isArray(userRules)) {
    throw new Error("AdGuard user rules artifact must be a top-level YAML sequence");
  }

  for (const [index, userRule] of userRules.entries()) {
    validateRewriteValue(userRule, `AdGuard user rules[${index}]`);
  }

  return userRules;
}

export function patchAdguardConfig(sourceYaml, settingsAndRules) {
  const {
    rewrites,
    userRules,
    ...settingsInput
  } = settingsAndRules;
  const artifactFields = [
    rewrites !== undefined && "rewrites",
    userRules !== undefined && "userRules"
  ].filter(Boolean);

  if (artifactFields.length > 1) {
    throw new Error("AdGuard config patch accepts at most one of rewrites or userRules");
  }

  const {
    querylogInterval,
    webPort,
    dns: {
      port,
      upstreamDns,
      bootstrapDns,
      upstreamMode,
      rateLimit,
      rateLimitSubnetLenIpv4,
      rateLimitSubnetLenIpv6,
      rateLimitWhitelist,
      ednsClientSubnet,
      cacheSize,
      cacheTtlMin,
      cacheTtlMax,
      cacheOptimistic
    }
  } = parseAdguardSettings(settingsInput, {
    cliNames: true,
    includeValue: true
  });

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
  document.setIn(["dns", "port"], port);
  document.setIn(["dns", "ratelimit"], rateLimit);
  document.setIn(["dns", "ratelimit_subnet_len_ipv4"], rateLimitSubnetLenIpv4);
  document.setIn(["dns", "ratelimit_subnet_len_ipv6"], rateLimitSubnetLenIpv6);
  document.setIn(["dns", "ratelimit_whitelist"], rateLimitWhitelist);
  document.setIn(["dns", "edns_client_subnet"], {
    enabled: ednsClientSubnet.enabled,
    use_custom: ednsClientSubnet.useCustom,
    custom_ip: ednsClientSubnet.customIp
  });
  document.setIn(["dns", "cache_size"], cacheSize);
  document.setIn(["dns", "cache_ttl_min"], cacheTtlMin);
  document.setIn(["dns", "cache_ttl_max"], cacheTtlMax);
  document.setIn(["dns", "cache_optimistic"], cacheOptimistic);
  document.setIn(["filtering", "rewrites"], rewrites ?? []);
  document.setIn(["user_rules"], userRules ?? []);
  document.setIn(["querylog", "interval"], querylogInterval);
  document.setIn(["http", "address"], replaceAddressPort(currentWebAddress, webPort));

  const patchedYaml = document.toString();
  parse(patchedYaml);
  return patchedYaml;
}

export async function generateAdguardConfig({
  sourcePath,
  rewrites,
  userRules,
  querylogInterval,
  webPort,
  dns,
  outputPath
}) {
  const patchedYaml = patchAdguardConfig(await readFile(sourcePath, "utf8"), {
    rewrites,
    userRules,
    querylogInterval,
    webPort,
    dns
  });
  await writeFile(outputPath, patchedYaml, { encoding: "utf8", mode: 0o600 });
  const artifactSummary = rewrites !== undefined
    ? `${rewrites.length} rewrites`
    : userRules !== undefined
      ? `${userRules.length} user rules`
      : "settings only";
  console.log(`Patched AdGuard Home config: ${artifactSummary}`);
}

async function main() {
  const [
    sourcePath,
    rewritesPath,
    querylogInterval,
    webPort,
    dnsJson,
    outputPath
  ] = process.argv.slice(2);

  if (
    !sourcePath ||
    !rewritesPath ||
    !querylogInterval ||
    !webPort ||
    !dnsJson ||
    !outputPath
  ) {
    throw new Error(
      "Usage: adguard-config.js <source-yaml> <rewrites-yaml-or-> <querylog-interval> <web-port> <dns-json> <output-yaml>"
    );
  }

  const rules = rewritesPath === "-"
    ? {}
    : { rewrites: parseAdguardRewrites(await readFile(rewritesPath, "utf8")) };

  await generateAdguardConfig({
    sourcePath,
    ...rules,
    querylogInterval,
    webPort: parseCliNumber(webPort),
    dns: parseCliJson(dnsJson, "ADGUARD_DNS"),
    outputPath
  });
}

function parseCliNumber(value) {
  if (value === undefined) {
    return undefined;
  }

  return /^-?\d+(?:\.\d+)?$/u.test(value) ? Number(value) : Number.NaN;
}

function parseCliJson(value, fieldName) {
  if (value === undefined) {
    return undefined;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(
      `${fieldName} must be valid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function validateRewriteValue(value, fieldName) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value ||
    /[\r\n\0]/u.test(value)
  ) {
    throw new Error(`${fieldName} must be a non-empty single-line string`);
  }
}

function decodeYaml(value, artifactName) {
  if (typeof value === "string") {
    return value;
  }

  if (value instanceof Uint8Array) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(value);
    } catch {
      throw new Error(`${artifactName} must contain valid UTF-8`);
    }
  }

  throw new Error(`${artifactName} must be a string or byte snapshot`);
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
