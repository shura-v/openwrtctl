#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadRouterResources } from "./lib/router-resources.js";

const RESOURCE_KINDS = ["domain", "domain_suffix", "ip_cidr"];
export const TUN_INCLUDE_INTERFACE = ["br-lan"];
export const TUN_ROUTE_EXCLUDE_ADDRESS = [
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "fc00::/7",
  "fe80::/10"
];

export function patchSingBoxConfig(sourceConfig, resources) {
  if (!isRecord(sourceConfig)) {
    throw new Error("Generated sing-box config must be an object");
  }

  if (!Array.isArray(sourceConfig.inbounds)) {
    throw new Error("Generated sing-box config has no inbounds array");
  }

  const tunInbounds = sourceConfig.inbounds.filter((inbound) => inbound?.type === "tun");
  if (tunInbounds.length !== 1) {
    throw new Error("Generated sing-box config must contain exactly one TUN inbound");
  }

  if (!Array.isArray(sourceConfig.outbounds)) {
    throw new Error("Generated sing-box config has no outbounds array");
  }

  for (const tag of ["proxy", "direct"]) {
    if (!sourceConfig.outbounds.some((outbound) => outbound?.tag === tag)) {
      throw new Error(`Generated sing-box config has no ${tag} outbound`);
    }
  }

  if (!isRecord(sourceConfig.route) || !Array.isArray(sourceConfig.route.rules)) {
    throw new Error("Generated sing-box config has no route.rules array");
  }

  const proxyRules = buildProxyRules(resources);
  const rules = replaceGeneratedProxyRules(
    sourceConfig.route.rules.filter((rule) => rule?.action !== "hijack-dns"),
    proxyRules
  );

  return {
    ...sourceConfig,
    inbounds: sourceConfig.inbounds.map((inbound) =>
      inbound === tunInbounds[0]
        ? {
            ...inbound,
            auto_route: true,
            auto_redirect: true,
            include_interface: TUN_INCLUDE_INTERFACE,
            route_exclude_address: TUN_ROUTE_EXCLUDE_ADDRESS,
            strict_route: false
          }
        : inbound
    ),
    route: {
      ...sourceConfig.route,
      auto_detect_interface: true,
      final: "direct",
      rules
    }
  };
}

export async function generateSingBoxConfig({
  sourcePath,
  ruleSetsDirectoryPath,
  outputPath
}) {
  const sourceConfig = JSON.parse(await readFile(sourcePath, "utf8"));
  const resources = await loadRouterResources(sourcePath, ruleSetsDirectoryPath);
  const patchedConfig = patchSingBoxConfig(sourceConfig, resources);
  const proxyResourceCount = resources.filter((resource) => resource.route === "proxy").length;

  await writeFile(outputPath, `${JSON.stringify(patchedConfig, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  console.log(
    `Generated sing-box config: ${proxyResourceCount} of ${resources.length} router resources use proxy`
  );
}

function buildProxyRules(resources) {
  const valuesByKind = new Map(RESOURCE_KINDS.map((kind) => [kind, new Set()]));

  for (const resource of resources) {
    if (resource.route === "proxy") {
      valuesByKind.get(resource.kind)?.add(resource.value);
    }
  }

  return RESOURCE_KINDS.flatMap((kind) => {
    const values = [...valuesByKind.get(kind)].sort((left, right) =>
      left.localeCompare(right)
    );

    return values.length === 0
      ? []
      : [{ action: "route", outbound: "proxy", [kind]: values }];
  });
}

function replaceGeneratedProxyRules(rules, proxyRules) {
  const result = [];
  let inserted = false;

  for (const rule of rules) {
    if (rule?.action === "route" && rule.outbound === "proxy") {
      if (!inserted) {
        result.push(...proxyRules);
        inserted = true;
      }
      continue;
    }

    result.push(rule);
  }

  if (!inserted) {
    result.push(...proxyRules);
  }

  return result;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function main() {
  const [sourcePath, ruleSetsDirectoryPath, outputPath] = process.argv.slice(2);

  if (!sourcePath || !ruleSetsDirectoryPath || !outputPath) {
    throw new Error(
      "Usage: singbox-config.js <generated-config> <rule-sets-directory> <output-json>"
    );
  }

  await generateSingBoxConfig({ sourcePath, ruleSetsDirectoryPath, outputPath });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(`openwrt: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
