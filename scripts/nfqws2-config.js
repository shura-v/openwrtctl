import { readFile, writeFile } from "node:fs/promises";
import { loadRouterResources } from "./lib/router-resources.js";

export const NFQWS2_USER_LIST_PATH = "/etc/nfqws2/lists/user.list";
export const NFQWS2_IPSET_LIST_PATH = "/etc/nfqws2/lists/ipset.list";

export function buildNfqws2Lists(resources) {
  const domains = new Set();
  const ipsets = new Set();

  for (const resource of resources) {
    if (resource.kind === "domain") {
      domains.add(`^${resource.value}`);
      continue;
    }

    if (resource.kind === "domain_suffix") {
      domains.add(resource.value);
      continue;
    }

    if (resource.kind === "ip_cidr") {
      ipsets.add(resource.value);
    }
  }

  return {
    domains: [...domains].sort((left, right) => left.localeCompare(right)),
    ipsets: [...ipsets].sort((left, right) => left.localeCompare(right))
  };
}

export function patchNfqws2Config(
  sourceConfig,
  nfqws2,
  { remoteTmpDirectory, hasDomains, hasIpsets }
) {
  if (typeof hasDomains !== "boolean" || typeof hasIpsets !== "boolean") {
    throw new Error("nfqws2 list presence must be specified");
  }

  const strategy = buildManagedStrategy(nfqws2, { hasDomains, hasIpsets });
  const tcpPorts = hasDomains || hasIpsets ? nfqws2.filter.tcp.join(",") : "";
  const udpPorts = nfqws2.filter.udp.join(",");
  let config = replaceSingleLineAssignment(sourceConfig, "NFQWS2_ENABLE", "1");
  config = replaceSingleLineAssignment(
    config,
    "NFQWS2_PORTS_TCP",
    tcpPorts
  );
  config = replaceSingleLineAssignment(config, "NFQWS2_PORTS_UDP", udpPorts);
  config = setOrAppendAssignment(config, "NFQWS2_PORTS_UDP_KEEPALIVE", "");
  config = replaceSingleLineAssignment(config, "NFQWS2_UDP_PKT_OUT", "5");
  config = replaceSingleLineAssignment(config, "NFQWS2_UDP_PKT_IN", "3");
  config = replaceSingleLineAssignment(config, "MODE_FILTER", "none");
  config = replaceSingleLineAssignment(config, "DISABLE_IPV6", "0");
  config = replaceSingleLineAssignment(config, "INIT_APPLY_FW", "1");
  config = replaceSingleLineAssignment(config, "FILTER_TTL_EXPIRED_ICMP", "0");
  config = replaceMultilineAssignment(config, "NFQWS2_OPT", strategy);
  config = setOrAppendAssignment(config, "TMPDIR", remoteTmpDirectory);
  config = setOrAppendAssignment(config, "FWTYPE", "nftables");
  config = setOrAppendAssignment(config, "GETLIST", "");

  if (/--filter-l7=[^\n]*quic/u.test(config)) {
    throw new Error("Managed nfqws2 config must not intercept QUIC");
  }

  return config;
}

export async function generateNfqws2Bundle({
  sourceConfigPath,
  nfqws2,
  singBoxConfigPath,
  ruleSetsDirectoryPath,
  remoteTmpDirectory,
  outputConfigPath,
  outputUserListPath,
  outputIpsetListPath
}) {
  const [sourceConfig, resources] = await Promise.all([
    readFile(sourceConfigPath, "utf8"),
    loadRouterResources(singBoxConfigPath, ruleSetsDirectoryPath)
  ]);
  const lists = buildNfqws2Lists(resources);
  const patchedConfig = patchNfqws2Config(sourceConfig, nfqws2, {
    remoteTmpDirectory,
    hasDomains: lists.domains.length > 0,
    hasIpsets: lists.ipsets.length > 0
  });

  await Promise.all([
    writeFile(outputConfigPath, patchedConfig, { encoding: "utf8", mode: 0o600 }),
    writeList(outputUserListPath, lists.domains),
    writeList(outputIpsetListPath, lists.ipsets)
  ]);

  console.log(
    `Generated nfqws2 bundle: ${lists.domains.length} domains, ${lists.ipsets.length} IPv4/IPv6 networks`
  );
}

function buildManagedStrategy(nfqws2, { hasDomains, hasIpsets }) {
  const { filter, filterL7, strategy } = nfqws2;
  const tcpL7 = validateFilterValues(filterL7?.tcp, "nfqws2.filterL7.tcp");
  const udpL7 = validateFilterValues(filterL7?.udp, "nfqws2.filterL7.udp");
  const tcp = validateFilterValues(filter?.tcp, "nfqws2.filter.tcp");
  const udp = validateFilterValues(filter?.udp, "nfqws2.filter.udp");
  const tcpStrategy = [
    ...validateStrategyLines(strategy?.https, "nfqws2.strategy.https"),
    ...validateStrategyLines(strategy?.http, "nfqws2.strategy.http")
  ];
  const udpStrategy = validateStrategyLines(strategy?.udp, "nfqws2.strategy.udp");
  const tcpFilter = `--filter-tcp=${tcp.join(",")} --filter-l7=${tcpL7.join(",")}`;
  const profiles = [];

  if (hasIpsets) {
    profiles.push([tcpFilter, `--ipset=${NFQWS2_IPSET_LIST_PATH}`, ...tcpStrategy].join("\n"));
  }

  if (hasDomains) {
    profiles.push([tcpFilter, `--hostlist=${NFQWS2_USER_LIST_PATH}`, ...tcpStrategy].join("\n"));
  }

  profiles.push([
    `--filter-udp=${udp.join(",")} --filter-l7=${udpL7.join(",")}`,
    ...udpStrategy
  ].join("\n"));

  return profiles.join("\n--new\n");
}

function validateFilterValues(values, fieldName) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(`${fieldName} must not be empty`);
  }

  return values.map(String);
}

function validateStrategyLines(value, fieldName) {
  if (typeof value !== "string") {
    throw new Error(`${fieldName} must be a string`);
  }

  const lines = value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  if (lines.length === 0) {
    throw new Error(`${fieldName} must not be empty`);
  }

  if (lines.some((line) => /--new|--filter-(?:tcp|udp|l7)/u.test(line))) {
    throw new Error(`${fieldName} must contain only strategy arguments`);
  }

  if (lines.some((line) => /["`$\\]/u.test(line))) {
    throw new Error(`${fieldName} contains shell control characters`);
  }

  return lines;
}

function replaceSingleLineAssignment(config, name, value) {
  const pattern = new RegExp(`^${name}=.*$`, "mu");

  if (!pattern.test(config)) {
    throw new Error(`nfqws2 config has no ${name} assignment`);
  }

  return config.replace(pattern, `${name}=${value}`);
}

function replaceMultilineAssignment(config, name, value) {
  const pattern = new RegExp(`^${name}="[\\s\\S]*?"\\s*$`, "mu");

  if (!pattern.test(config)) {
    throw new Error(`nfqws2 config has no ${name} assignment`);
  }

  return config.replace(pattern, `${name}="\n${value}\n"`);
}

function setOrAppendAssignment(config, name, value) {
  const pattern = new RegExp(`^${name}=.*$`, "mu");

  if (pattern.test(config)) {
    return config.replace(pattern, `${name}=${value}`);
  }

  return `${config.trimEnd()}\n${name}=${value}\n`;
}

async function writeList(outputPath, values) {
  await writeFile(outputPath, `${values.join("\n")}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
}
