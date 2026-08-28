import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parse } from "yaml";

export async function loadProjectConfig(configPath) {
  try {
    return parseProjectConfig(await readFile(configPath, "utf8"), configPath);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      throw new Error(`missing ${configPath}; run openwrtctl init`);
    }

    throw error;
  }
}

export function parseProjectConfig(sourceYaml, sourcePath = "config.yaml") {
  let source;

  try {
    source = parse(sourceYaml);
  } catch (error) {
    throw new Error(`Invalid YAML in ${sourcePath}: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (isRecord(source?.adguard) && Object.hasOwn(source.adguard, "rewriteIp")) {
    throw new Error(`${sourcePath}: adguard.rewriteIp is not supported; use adguard.rewrites.path`);
  }

  if (isRecord(source)) {
    rejectUnknownFields(
      source,
      ["openwrt", "adguard", "nfqws2", "singbox", "backup"],
      sourcePath
    );
  }

  if (
    !isRecord(source?.openwrt) ||
    !isRecord(source?.backup)
  ) {
    throw new Error(
      `${sourcePath} must contain openwrt and backup mappings`
    );
  }

  const config = {
    openwrt: validateOpenwrt(source.openwrt, sourcePath),
    backup: validateBackup(source.backup, sourcePath)
  };

  for (const [serviceName, validateService] of [
    ["adguard", validateAdguard],
    ["singbox", validateSingbox],
    ["nfqws2", validateNfqws2]
  ]) {
    if (!Object.hasOwn(source, serviceName)) {
      continue;
    }

    if (!isRecord(source[serviceName])) {
      throw new Error(`${sourcePath}: ${serviceName} must be a mapping`);
    }

    config[serviceName] = validateService(source[serviceName], sourcePath);
  }

  return config;
}

function validateOpenwrt(openwrt, sourcePath) {
  const endpoint = openwrt.endpoint;
  const sshPort = openwrt.sshPort;
  const remoteTmpDir = openwrt.remoteTmpDir;

  if (typeof endpoint !== "string" || !/^[\w.-]+@[\w.-]+$/u.test(endpoint)) {
    throw new Error(`${sourcePath}: openwrt.endpoint must have the form user@host`);
  }

  validatePort(sshPort, `${sourcePath}: openwrt.sshPort`);

  if (
    typeof remoteTmpDir !== "string" ||
    !/^\/[\w./-]+$/u.test(remoteTmpDir) ||
    remoteTmpDir.split("/").includes("..")
  ) {
    throw new Error(`${sourcePath}: openwrt.remoteTmpDir must be a normalized absolute path`);
  }

  return { endpoint, sshPort, remoteTmpDir };
}

function validateBackup(backup, sourcePath) {
  const backupDirectory = backup.directory;
  if (typeof backupDirectory !== "string" || backupDirectory.length === 0) {
    throw new Error(`${sourcePath}: backup.directory must be a path`);
  }

  return { directory: resolveConfigPath(backupDirectory, sourcePath) };
}

function validateSingbox(singbox, sourcePath) {
  rejectUnknownFields(singbox, ["config"], `${sourcePath}: singbox`);

  return {
    config: validateArtifactSource(
      singbox.config,
      `${sourcePath}: singbox.config`,
      sourcePath
    )
  };
}

function validateAdguard(adguard, sourcePath) {
  rejectUnknownFields(
    adguard,
    [
      "rewrites",
      "userRules",
      "querylogInterval",
      "webPort",
      "dnsPort",
      "upstreamDns",
      "bootstrapDns",
      "upstreamMode"
    ],
    `${sourcePath}: adguard`
  );

  const querylogInterval = adguard.querylogInterval;
  const webPort = adguard.webPort;
  const dnsPort = adguard.dnsPort;
  const upstreamDns = adguard.upstreamDns;
  const bootstrapDns = adguard.bootstrapDns;
  const hasBootstrapDns = Object.hasOwn(adguard, "bootstrapDns");
  const upstreamMode = adguard.upstreamMode;
  const artifactFields = ["rewrites", "userRules"].filter((field) =>
    Object.hasOwn(adguard, field)
  );

  if (artifactFields.length !== 1) {
    throw new Error(
      `${sourcePath}: adguard must contain exactly one of rewrites or userRules`
    );
  }

  const artifactField = artifactFields[0];
  const artifact = validateArtifactSource(
    adguard[artifactField],
    `${sourcePath}: adguard.${artifactField}`,
    sourcePath
  );

  if (typeof querylogInterval !== "string" || !/^[1-9]\d*(?:h|d)$/u.test(querylogInterval)) {
    throw new Error(`${sourcePath}: adguard.querylogInterval must be a positive number of hours or days`);
  }

  validatePort(webPort, `${sourcePath}: adguard.webPort`);
  validatePort(dnsPort, `${sourcePath}: adguard.dnsPort`);
  const validatedUpstreamDns = validateStringList(
    upstreamDns,
    `${sourcePath}: adguard.upstreamDns`
  );
  const validatedBootstrapDns = hasBootstrapDns
    ? validateStringList(
      bootstrapDns,
      `${sourcePath}: adguard.bootstrapDns`,
      true
    )
    : undefined;

  if (!["load_balance", "parallel", "fastest_addr"].includes(upstreamMode)) {
    throw new Error(
      `${sourcePath}: adguard.upstreamMode must be load_balance, parallel, or fastest_addr`
    );
  }

  return {
    [artifactField]: artifact,
    querylogInterval,
    webPort,
    dnsPort,
    upstreamDns: validatedUpstreamDns,
    ...(hasBootstrapDns ? { bootstrapDns: validatedBootstrapDns } : {}),
    upstreamMode
  };
}

function validateNfqws2(nfqws2, sourcePath) {
  rejectUnknownFields(
    nfqws2,
    ["resources", "filter", "filterL7", "strategy", "test"],
    `${sourcePath}: nfqws2`
  );

  const filter = nfqws2.filter;
  const filterL7 = nfqws2.filterL7;
  const strategy = nfqws2.strategy;
  const nfqws2Test = nfqws2.test;
  const resources = validateArtifactSource(
    nfqws2.resources,
    `${sourcePath}: nfqws2.resources`,
    sourcePath
  );

  if (!isRecord(filter)) {
    throw new Error(`${sourcePath}: nfqws2.filter must be a mapping`);
  }

  if (!isRecord(strategy)) {
    throw new Error(`${sourcePath}: nfqws2.strategy must be a mapping`);
  }

  if (!isRecord(nfqws2Test)) {
    throw new Error(`${sourcePath}: nfqws2.test must be a mapping`);
  }

  const tcpFilter = validatePortFilter(filter.tcp, `${sourcePath}: nfqws2.filter.tcp`);
  const udpFilter = validatePortFilter(filter.udp, `${sourcePath}: nfqws2.filter.udp`, true);
  if (!isRecord(filterL7)) {
    throw new Error(`${sourcePath}: nfqws2.filterL7 must be a mapping`);
  }

  const tcpL7Filter = validateNameList(filterL7.tcp, `${sourcePath}: nfqws2.filterL7.tcp`);
  const udpL7Filter = validateNameList(filterL7.udp, `${sourcePath}: nfqws2.filterL7.udp`);
  const httpStrategy = validateStrategy(strategy.http, `${sourcePath}: nfqws2.strategy.http`);
  const httpsStrategy = validateStrategy(strategy.https, `${sourcePath}: nfqws2.strategy.https`);
  const udpStrategy = validateStrategy(strategy.udp, `${sourcePath}: nfqws2.strategy.udp`);
  const httpsDomains = validateDomainList(
    nfqws2Test.httpsDomains,
    `${sourcePath}: nfqws2.test.httpsDomains`
  );

  return {
    resources,
    filter: {
      tcp: tcpFilter,
      udp: udpFilter
    },
    filterL7: { tcp: tcpL7Filter, udp: udpL7Filter },
    strategy: { http: httpStrategy, https: httpsStrategy, udp: udpStrategy },
    test: { httpsDomains }
  };
}

function validateArtifactSource(value, fieldName, sourcePath) {
  if (value === undefined || value === null) {
    throw new Error(`${fieldName}.path must be a non-empty path`);
  }

  if (!isRecord(value)) {
    throw new Error(`${fieldName} must be a mapping`);
  }

  rejectUnknownFields(value, ["path", "prepare"], fieldName);

  if (typeof value.path !== "string" || value.path.trim().length === 0) {
    throw new Error(`${fieldName}.path must be a non-empty path`);
  }

  const artifact = { path: resolveConfigPath(value.path, sourcePath) };
  if (value.prepare === undefined) {
    return artifact;
  }

  if (!isRecord(value.prepare)) {
    throw new Error(`${fieldName}.prepare must be a mapping`);
  }

  rejectUnknownFields(value.prepare, ["command", "cwd"], `${fieldName}.prepare`);

  if (
    Object.hasOwn(value.prepare, "cwd") &&
    !Object.hasOwn(value.prepare, "command")
  ) {
    throw new Error(`${fieldName}.prepare.cwd requires ${fieldName}.prepare.command`);
  }

  const command = value.prepare.command;
  if (
    !Array.isArray(command) ||
    command.length === 0 ||
    command.some((argument) => typeof argument !== "string") ||
    command[0].trim().length === 0
  ) {
    throw new Error(`${fieldName}.prepare.command must be a non-empty argv list of strings`);
  }

  if (command.some((argument) => argument.includes("{output}") && argument !== "{output}")) {
    throw new Error(`${fieldName}.prepare.command must use {output} as a standalone argument`);
  }

  if (command.filter((argument) => argument === "{output}").length !== 1) {
    throw new Error(`${fieldName}.prepare.command must contain exactly one {output} argument`);
  }

  const cwd = value.prepare.cwd;
  if (cwd !== undefined && (typeof cwd !== "string" || cwd.trim().length === 0)) {
    throw new Error(`${fieldName}.prepare.cwd must be a non-empty path`);
  }

  return {
    ...artifact,
    prepare: {
      command: [...command],
      cwd: resolveConfigPath(cwd ?? ".", sourcePath)
    }
  };
}

function resolveConfigPath(value, sourcePath) {
  if (value === "~") {
    return os.homedir();
  }

  if (value.startsWith("~/")) {
    return path.join(os.homedir(), value.slice(2));
  }

  return path.resolve(path.dirname(path.resolve(sourcePath)), value);
}

function rejectUnknownFields(value, allowedFields, fieldName) {
  const unknownField = Object.keys(value).find((key) => !allowedFields.includes(key));
  if (unknownField !== undefined) {
    throw new Error(`${fieldName}.${unknownField} is not supported`);
  }
}

function validatePortFilter(value, fieldName, allowRanges = false) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${fieldName} must contain port numbers`);
  }

  return value.map((entry) => {
    const normalized = String(entry);
    const match = normalized.match(/^(\d+)(?:-(\d+))?$/u);
    const first = Number(match?.[1]);
    const last = Number(match?.[2] ?? match?.[1]);

    if (!match || first < 1 || last > 65535 || first > last || (!allowRanges && match[2])) {
      throw new Error(`${fieldName} must contain valid port${allowRanges ? " or port-range" : ""} values`);
    }

    return normalized;
  });
}

function validateStringList(value, fieldName, allowEmpty = false) {
  if (
    !Array.isArray(value) ||
    (!allowEmpty && value.length === 0) ||
    value.some((entry) => typeof entry !== "string" || entry.trim().length === 0)
  ) {
    throw new Error(
      `${fieldName} must be ${allowEmpty ? "a list" : "a non-empty list"} of non-empty strings`
    );
  }

  return [...value];
}

function validateNameList(value, fieldName) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((entry) => typeof entry !== "string" || !/^[a-z0-9_]+$/u.test(entry))
  ) {
    throw new Error(`${fieldName} must contain protocol names`);
  }

  return value;
}

function validateDomainList(value, fieldName) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${fieldName} must be a non-empty list of domain names`);
  }

  const domainPattern =
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/iu;

  if (
    value.some(
      (domain) =>
        typeof domain !== "string" || domain.length > 253 || !domainPattern.test(domain)
    )
  ) {
    throw new Error(`${fieldName} must contain valid domain names`);
  }

  return [...value];
}

function validateStrategy(value, fieldName) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }

  return value;
}

function validatePort(value, fieldName) {
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`${fieldName} must be an integer from 1 to 65535`);
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
