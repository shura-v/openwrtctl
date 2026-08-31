import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { parse } from "yaml";
import { buildConfigureDnsmasqCommand } from "./lib/adguard-lifecycle.js";
import {
  applyAdguardConfig,
  applyAdguardConfigTransaction,
  prepareAdguardArtifact
} from "./sync-adguard.js";

const SOURCE_CONFIG = `
dns:
  port: 1053
  upstream_dns: [old]
  bootstrap_dns: [old]
  upstream_mode: parallel
  ratelimit: 20
  ratelimit_subnet_len_ipv4: 16
  ratelimit_subnet_len_ipv6: 48
  ratelimit_whitelist: [old]
  edns_client_subnet:
    enabled: true
    use_custom: true
    custom_ip: 192.0.2.2
  cache_size: 1234
  cache_ttl_min: 10
  cache_ttl_max: 20
  cache_optimistic: false
filtering:
  rewrites:
    - domain: old.example
      answer: 192.0.2.10
user_rules: [old]
querylog:
  interval: 90d
http:
  address: 0.0.0.0:3000
`;

const NORMALIZED_ADGUARD_CONFIG = {
  querylogInterval: "6h",
  webPort: 8080,
  dns: {
    port: 5353,
    upstreamDns: ["tls://dns.example"],
    bootstrapDns: [],
    upstreamMode: "load_balance",
    rateLimit: 0,
    rateLimitSubnetLenIpv4: 24,
    rateLimitSubnetLenIpv6: 56,
    rateLimitWhitelist: [],
    ednsClientSubnet: {
      enabled: false,
      useCustom: false,
      customIp: ""
    },
    cacheSize: 4_194_304,
    cacheTtlMin: 30,
    cacheTtlMax: 60,
    cacheOptimistic: true
  }
};

test("rejects sync-adguard when its service section is omitted", async () => {
  await assert.rejects(
    prepareAdguardArtifact({ config: {}, configPath: "/config/config.yaml" }),
    /sync-adguard requires an adguard section/u
  );
});

test("prepares the configured AdGuard artifact mode", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "sync-adguard-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const configPath = path.join(directory, "config.yaml");
  const userRulesPath = path.join(directory, "user-rules.yaml");
  await writeFile(userRulesPath, "- '$dnsrewrite=192.0.2.10'\n");

  const artifact = await prepareAdguardArtifact({
    config: { adguard: { userRules: { path: userRulesPath } } },
    configPath
  });

  assert.equal(artifact.mode, "userRules");
  assert.deepEqual(artifact.validated, ["$dnsrewrite=192.0.2.10"]);
});

test("prepares rewrite mode without changing existing behavior", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "sync-adguard-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const configPath = path.join(directory, "config.yaml");
  const rewritesPath = path.join(directory, "rewrites.yaml");
  await writeFile(rewritesPath, "- domain: example.test\n  answer: 192.0.2.10\n");

  const artifact = await prepareAdguardArtifact({
    config: { adguard: { rewrites: { path: rewritesPath } } },
    configPath
  });

  assert.equal(artifact.mode, "rewrites");
  assert.deepEqual(artifact.validated, [
    { domain: "example.test", answer: "192.0.2.10", enabled: true }
  ]);
});

test("prepares settings-only mode without accessing a local artifact", async () => {
  const artifact = await prepareAdguardArtifact({
    config: { adguard: {} },
    configPath: "/missing/config.yaml"
  });

  assert.deepEqual(artifact, { mode: "settingsOnly", validated: [] });
});

test("rejects conflicting AdGuard artifact modes before preparation", async () => {
  await assert.rejects(
    prepareAdguardArtifact({
      config: {
        adguard: {
          rewrites: { path: "/missing/rewrites.yaml" },
          userRules: { path: "/missing/user-rules.yaml" }
        }
      },
      configPath: "/missing/config.yaml"
    }),
    /at most one of adguard\.rewrites or adguard\.userRules/u
  );
});

test("validates a complete settings-only candidate before remote apply", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "sync-adguard-"));
  const liveConfigPath = path.join(directory, "live.yaml");
  const calls = [];
  let candidate;
  context.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(liveConfigPath, SOURCE_CONFIG);

  const remote = {
    localDirectory: directory,
    config: {
      openwrt: { remoteTmpDir: "/root/tmp" },
      adguard: NORMALIZED_ADGUARD_CONFIG
    },
    pull: async (_source, destination) => copyFile(liveConfigPath, destination),
    push: async (source, destination) => {
      calls.push(["push", destination]);
      candidate = parse(await readFile(source, "utf8"));
    },
    exec: async (command) => {
      calls.push(["exec", command]);
      if (command === "AdGuardHome --check-config -c '/root/tmp/adguardhome.yaml'") {
        throw new Error("candidate rejected");
      }
    }
  };

  await assert.rejects(
    applyAdguardConfig(remote, { mode: "settingsOnly", validated: [] }),
    /candidate rejected/u
  );

  assert.equal(candidate.dns.ratelimit, 0);
  assert.equal(candidate.dns.ratelimit_subnet_len_ipv4, 24);
  assert.equal(candidate.dns.ratelimit_subnet_len_ipv6, 56);
  assert.deepEqual(candidate.dns.ratelimit_whitelist, []);
  assert.deepEqual(candidate.dns.edns_client_subnet, {
    enabled: false,
    use_custom: false,
    custom_ip: ""
  });
  assert.equal(candidate.dns.cache_size, 4_194_304);
  assert.equal(candidate.dns.cache_ttl_min, 30);
  assert.equal(candidate.dns.cache_ttl_max, 60);
  assert.equal(candidate.dns.cache_optimistic, true);
  assert.deepEqual(candidate.filtering.rewrites, []);
  assert.deepEqual(candidate.user_rules, []);
  assert.equal(calls.filter(([type]) => type === "push").length, 1);
  assert.equal(calls.some(([, command]) => /adguardhome restart|uci set/u.test(command)), false);
});

test("uses the nested DNS port for readiness and dnsmasq", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "sync-adguard-"));
  const liveConfigPath = path.join(directory, "live.yaml");
  const calls = [];
  context.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(liveConfigPath, SOURCE_CONFIG);

  const remote = {
    localDirectory: directory,
    config: {
      openwrt: { remoteTmpDir: "/root/tmp" },
      adguard: NORMALIZED_ADGUARD_CONFIG
    },
    pull: async (_source, destination) => copyFile(liveConfigPath, destination),
    push: async (source, destination) => calls.push(["push", source, destination]),
    exec: async (command) => calls.push(["exec", command])
  };

  await applyAdguardConfig(remote, { mode: "settingsOnly", validated: [] });

  const configureCall = calls.find(
    ([type, command]) => type === "exec" && /uci set dhcp\.@dnsmasq/u.test(command)
  );
  assert.ok(configureCall);
  assert.match(configureCall[1], /managed_server='127\.0\.0\.1#5353'/u);
  assert.match(configureCall[1], /wait_for_tcp_service adguardhome '5353'/u);
});

test("restores the AdGuard config when restart fails", async () => {
  const calls = [];
  let execCount = 0;
  const remote = {
    push: async (source, destination) => calls.push(["push", source, destination]),
    exec: async (command) => {
      calls.push(["exec", command]);
      execCount += 1;

      if (execCount === 1) {
        throw new Error("AdGuard Home restart failed");
      }
    }
  };

  await assert.rejects(
    applyAdguardConfigTransaction({
      remote,
      backupPath: "/local/.backups/adguard/previous.yaml",
      remoteStagedConfigPath: "/root/tmp/adguardhome.yaml",
      adguardConfigPath: "/etc/adguardhome/adguardhome.yaml",
      configureDnsmasqCommand: buildConfigureDnsmasqCommand("/root/tmp", 5353)
    }),
    /previous\.yaml was restored: AdGuard Home restart failed/u
  );

  assert.deepEqual(calls[1], [
    "push",
    "/local/.backups/adguard/previous.yaml",
    "/root/tmp/adguardhome.yaml"
  ]);
  assert.match(calls[2][1], /AdGuardHome --check-config/u);
  assert.match(calls[3][1], /\/etc\/init\.d\/adguardhome restart/u);
  assert.equal(calls.some(([, command]) => /uci set dhcp/u.test(command)), false);
});

test("restores the AdGuard config when readiness fails after restart", async () => {
  const calls = [];
  let execCount = 0;
  const remote = {
    push: async (source, destination) => calls.push(["push", source, destination]),
    exec: async (command) => {
      calls.push(["exec", command]);
      execCount += 1;

      if (execCount === 2) {
        throw new Error("AdGuard Home readiness failed");
      }
    }
  };

  await assert.rejects(
    applyAdguardConfigTransaction({
      remote,
      backupPath: "/local/.backups/adguard/previous.yaml",
      remoteStagedConfigPath: "/root/tmp/adguardhome.yaml",
      adguardConfigPath: "/etc/adguardhome/adguardhome.yaml",
      configureDnsmasqCommand: buildConfigureDnsmasqCommand("/root/tmp", 5353)
    }),
    /previous\.yaml was restored: AdGuard Home readiness failed/u
  );

  assert.match(calls[0][1], /\/etc\/init\.d\/adguardhome restart/u);
  assert.equal(calls[1][0], "exec");
  assert.match(calls[1][1], /wait_for_tcp_service adguardhome '5353'/u);
  assert.ok(
    calls[1][1].indexOf("wait_for_tcp_service adguardhome '5353'") <
      calls[1][1].indexOf("uci set dhcp.@dnsmasq[0].noresolv='1'")
  );
  assert.deepEqual(calls[2], [
    "push",
    "/local/.backups/adguard/previous.yaml",
    "/root/tmp/adguardhome.yaml"
  ]);
  assert.match(calls[3][1], /AdGuardHome --check-config/u);
  assert.match(calls[4][1], /\/etc\/init\.d\/adguardhome restart/u);
});
