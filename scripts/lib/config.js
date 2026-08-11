import { readFile } from "node:fs/promises";
import { isIP } from "node:net";
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

  if (
    !isRecord(source?.openwrt) ||
    !isRecord(source?.adguard) ||
    !isRecord(source?.nfqws2) ||
    !isRecord(source?.singboxctl) ||
    !isRecord(source?.backup)
  ) {
    throw new Error(
      `${sourcePath} must contain openwrt, adguard, nfqws2, singboxctl and backup mappings`
    );
  }

  const endpoint = source.openwrt.endpoint;
  const sshPort = source.openwrt.sshPort;
  const remoteTmpDir = source.openwrt.remoteTmpDir;
  const rewriteIp = source.adguard.rewriteIp;
  const querylogInterval = source.adguard.querylogInterval;
  const webPort = source.adguard.webPort;
  const filter = source.nfqws2.filter;
  const filterL7 = source.nfqws2.filterL7;
  const strategy = source.nfqws2.strategy;
  const profile = source.singboxctl.profile;
  const ruleSetsDirectory = source.singboxctl.ruleSetsDirectory;
  const backupDirectory = source.backup.directory;

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

  if (typeof rewriteIp !== "string" || isIP(rewriteIp) === 0) {
    throw new Error(`${sourcePath}: adguard.rewriteIp must be an IP address`);
  }

  if (typeof querylogInterval !== "string" || !/^[1-9]\d*(?:h|d)$/u.test(querylogInterval)) {
    throw new Error(`${sourcePath}: adguard.querylogInterval must be a positive number of hours or days`);
  }

  validatePort(webPort, `${sourcePath}: adguard.webPort`);

  if (typeof profile !== "string" || !/^[\w.-]+$/u.test(profile)) {
    throw new Error(`${sourcePath}: singboxctl.profile must be a profile name`);
  }

  if (typeof ruleSetsDirectory !== "string" || ruleSetsDirectory.length === 0) {
    throw new Error(`${sourcePath}: singboxctl.ruleSetsDirectory must be a path`);
  }

  if (typeof backupDirectory !== "string" || backupDirectory.length === 0) {
    throw new Error(`${sourcePath}: backup.directory must be a path`);
  }

  if (!isRecord(filter)) {
    throw new Error(`${sourcePath}: nfqws2.filter must be a mapping`);
  }

  if (!isRecord(strategy)) {
    throw new Error(`${sourcePath}: nfqws2.strategy must be a mapping`);
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

  return {
    openwrt: { endpoint, sshPort, remoteTmpDir },
    adguard: { rewriteIp, querylogInterval, webPort },
    singboxctl: {
      profile,
      ruleSetsDirectory: resolveConfigPath(ruleSetsDirectory, sourcePath)
    },
    backup: {
      directory: resolveConfigPath(backupDirectory, sourcePath)
    },
    nfqws2: {
      filter: {
        tcp: tcpFilter,
        udp: udpFilter
      },
      filterL7: { tcp: tcpL7Filter, udp: udpL7Filter },
      strategy: { http: httpStrategy, https: httpsStrategy, udp: udpStrategy }
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
