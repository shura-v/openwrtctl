import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { parse } from "yaml";
import {
  generateAdguardConfig,
  parseAdguardRewrites,
  parseAdguardUserRules,
  patchAdguardConfig
} from "./adguard-config.js";

const execFileAsync = promisify(execFile);

const SOURCE_CONFIG = `
users:
  - name: admin
    password: preserved-hash
dns:
  port: 1053
  upstream_dns:
    - https://old.example/dns-query
  bootstrap_dns:
    - 192.0.2.53
  upstream_mode: parallel
  ratelimit: 20
  ratelimit_subnet_len_ipv4: 16
  ratelimit_subnet_len_ipv6: 48
  ratelimit_whitelist:
    - 192.0.2.1
  edns_client_subnet:
    enabled: true
    use_custom: true
    custom_ip: 192.0.2.2
  cache_size: 1234
  cache_ttl_min: 10
  cache_ttl_max: 20
  cache_optimistic: false
filtering:
  filtering_enabled: true
  rewrites:
    - domain: old.example
      answer: 192.0.2.20
user_rules:
  - old-rule
querylog:
  interval: 90d
  size_memory: 1000
http:
  address: 0.0.0.0:3000
`;

const REWRITES_YAML = `
- domain: exact.example
  answer: 192.0.2.10
  enabled: true
- domain: "*.suffix.example"
  answer: target.example
- domain: disabled.example
  answer: 192.0.2.11
  enabled: false
`;

const MANAGED_SETTINGS = {
  querylogInterval: "6h",
  webPort: 8080,
  dns: {
    port: 5353,
    upstreamDns: ["tls://dns.example"],
    bootstrapDns: ["192.0.2.54"],
    upstreamMode: "fastest_addr",
    rateLimit: 100,
    rateLimitSubnetLenIpv4: 24,
    rateLimitSubnetLenIpv6: 56,
    rateLimitWhitelist: ["198.51.100.10", "2001:db8::/64"],
    ednsClientSubnet: {
      enabled: true,
      useCustom: true,
      customIp: "198.51.100.20"
    },
    cacheSize: 8_388_608,
    cacheTtlMin: 30,
    cacheTtlMax: 60,
    cacheOptimistic: true
  }
};

test("parses native AdGuard rewrite sequences", () => {
  assert.deepEqual(parseAdguardRewrites(REWRITES_YAML), [
    { domain: "exact.example", answer: "192.0.2.10", enabled: true },
    { domain: "*.suffix.example", answer: "target.example", enabled: true },
    { domain: "disabled.example", answer: "192.0.2.11", enabled: false }
  ]);
  assert.deepEqual(parseAdguardRewrites("[]\n"), []);
  assert.deepEqual(parseAdguardRewrites(Buffer.from("[]\n")), []);
});

test("rejects malformed and conflicting AdGuard rewrites", () => {
  assert.throws(
    () => parseAdguardRewrites("domain: example.com\nanswer: 192.0.2.10\n"),
    /top-level YAML sequence/u
  );
  assert.throws(
    () => parseAdguardRewrites("- domain: example.com\n  answer: 192.0.2.10\n- domain: example.com\n  answer: 192.0.2.11\n"),
    /conflicting answers/u
  );
  assert.throws(
    () => parseAdguardRewrites("- domain: ''\n  answer: 192.0.2.10\n"),
    /rewrites\[0\]\.domain/u
  );
  assert.throws(
    () => parseAdguardRewrites("- domain: example.com\n  answer: 192.0.2.10\n  enabled: yes\n"),
    /rewrites\[0\]\.enabled/u
  );
});

test("parses AdGuard user rule sequences", () => {
  assert.deepEqual(parseAdguardUserRules("- '$dnsrewrite=192.0.2.10'\n"), [
    "$dnsrewrite=192.0.2.10"
  ]);
  assert.deepEqual(parseAdguardUserRules("[]\n"), []);
  assert.throws(
    () => parseAdguardUserRules("rule: value\n"),
    /top-level YAML sequence/u
  );
  assert.throws(
    () => parseAdguardUserRules("- ''\n"),
    /user rules\[0\]/u
  );
  assert.throws(
    () => parseAdguardUserRules("- ' padded '\n"),
    /user rules\[0\]/u
  );
});

test("patches only managed AdGuard Home fields", () => {
  const rewrites = parseAdguardRewrites(REWRITES_YAML);
  const result = parse(
    patchAdguardConfig(SOURCE_CONFIG, {
      rewrites,
      ...MANAGED_SETTINGS
    })
  );

  assert.deepEqual(result.users, [{ name: "admin", password: "preserved-hash" }]);
  assert.equal(result.dns.port, 5353);
  assert.equal(result.dns.cache_size, 8_388_608);
  assert.equal(result.dns.cache_ttl_min, 30);
  assert.equal(result.dns.cache_ttl_max, 60);
  assert.equal(result.dns.cache_optimistic, true);
  assert.equal(result.filtering.filtering_enabled, true);
  assert.equal(result.querylog.interval, "6h");
  assert.equal(result.querylog.size_memory, 1000);
  assert.equal(result.http.address, "0.0.0.0:8080");
  assert.deepEqual(result.dns.upstream_dns, MANAGED_SETTINGS.dns.upstreamDns);
  assert.deepEqual(result.dns.bootstrap_dns, MANAGED_SETTINGS.dns.bootstrapDns);
  assert.equal(result.dns.upstream_mode, "fastest_addr");
  assert.equal(result.dns.ratelimit, 100);
  assert.equal(result.dns.ratelimit_subnet_len_ipv4, 24);
  assert.equal(result.dns.ratelimit_subnet_len_ipv6, 56);
  assert.deepEqual(result.dns.ratelimit_whitelist, MANAGED_SETTINGS.dns.rateLimitWhitelist);
  assert.deepEqual(result.dns.edns_client_subnet, {
    enabled: true,
    use_custom: true,
    custom_ip: "198.51.100.20"
  });
  assert.deepEqual(result.filtering.rewrites, rewrites);
  assert.deepEqual(result.user_rules, []);

  const withoutRewrites = parse(
    patchAdguardConfig(SOURCE_CONFIG, {
      rewrites: parseAdguardRewrites("[]\n"),
      ...MANAGED_SETTINGS
    })
  );
  assert.deepEqual(withoutRewrites.filtering.rewrites, []);
});

test("writes empty AdGuard bootstrap DNS when omitted or explicitly empty", () => {
  const settings = {
    ...MANAGED_SETTINGS,
    dns: { ...MANAGED_SETTINGS.dns },
    rewrites: []
  };
  delete settings.dns.bootstrapDns;
  const defaulted = parse(patchAdguardConfig(SOURCE_CONFIG, settings));
  const cleared = parse(
    patchAdguardConfig(SOURCE_CONFIG, {
      ...settings,
      dns: { ...settings.dns, bootstrapDns: [] }
    })
  );

  assert.deepEqual(defaulted.dns.bootstrap_dns, []);
  assert.deepEqual(cleared.dns.bootstrap_dns, []);
});

test("user rules mode replaces root user_rules and clears filtering.rewrites", () => {
  const userRules = parseAdguardUserRules(`
- "$dnsrewrite=192.0.2.10"
- "@@||example.ru^$dnsrewrite"
`);
  const result = parse(
    patchAdguardConfig(SOURCE_CONFIG, {
      userRules,
      ...MANAGED_SETTINGS
    })
  );

  assert.deepEqual(result.user_rules, userRules);
  assert.deepEqual(result.filtering.rewrites, []);
});

test("settings-only mode clears both managed rule locations", () => {
  const result = parse(patchAdguardConfig(SOURCE_CONFIG, MANAGED_SETTINGS));

  assert.deepEqual(result.filtering.rewrites, []);
  assert.deepEqual(result.user_rules, []);
});

test("rejects conflicting managed AdGuard artifacts", () => {
  assert.throws(
    () => patchAdguardConfig(SOURCE_CONFIG, {
      ...MANAGED_SETTINGS,
      rewrites: [],
      userRules: []
    }),
    /at most one of rewrites or userRules/u
  );
});

test("writes a patched config from an already parsed rewrite snapshot", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "adguard-config-"));
  const sourcePath = path.join(directory, "source.yaml");
  const outputPath = path.join(directory, "patched.yaml");
  context.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(sourcePath, SOURCE_CONFIG);

  await generateAdguardConfig({
    sourcePath,
    rewrites: parseAdguardRewrites(REWRITES_YAML),
    ...MANAGED_SETTINGS,
    outputPath
  });

  assert.deepEqual(parse(await readFile(outputPath, "utf8")).filtering.rewrites, [
    { domain: "exact.example", answer: "192.0.2.10", enabled: true },
    { domain: "*.suffix.example", answer: "target.example", enabled: true },
    { domain: "disabled.example", answer: "192.0.2.11", enabled: false }
  ]);
});

test("writes settings-only config with a stable summary", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "adguard-config-"));
  const sourcePath = path.join(directory, "source.yaml");
  const outputPath = path.join(directory, "patched.yaml");
  const summaries = [];
  const originalLog = console.log;
  context.after(() => {
    console.log = originalLog;
    return rm(directory, { recursive: true, force: true });
  });
  console.log = (message) => summaries.push(message);
  await writeFile(sourcePath, SOURCE_CONFIG);

  await generateAdguardConfig({
    sourcePath,
    ...MANAGED_SETTINGS,
    outputPath
  });

  const result = parse(await readFile(outputPath, "utf8"));
  assert.deepEqual(result.filtering.rewrites, []);
  assert.deepEqual(result.user_rules, []);
  assert.deepEqual(summaries, ["Patched AdGuard Home config: settings only"]);
});

test("direct CLI preserves defaults and supports settings-only mode", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "adguard-config-cli-"));
  const sourcePath = path.join(directory, "source.yaml");
  const outputPath = path.join(directory, "patched.yaml");
  context.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(sourcePath, SOURCE_CONFIG);

  const { stdout } = await execFileAsync(process.execPath, [
    path.join(import.meta.dirname, "adguard-config.js"),
    sourcePath,
    "-",
    "6h",
    "8080",
    JSON.stringify({ port: 5353, upstreamDns: ["tls://dns.example"] }),
    outputPath
  ]);

  const result = parse(await readFile(outputPath, "utf8"));
  assert.equal(result.dns.ratelimit, 0);
  assert.equal(result.dns.ratelimit_subnet_len_ipv4, 24);
  assert.equal(result.dns.ratelimit_subnet_len_ipv6, 56);
  assert.deepEqual(result.dns.ratelimit_whitelist, []);
  assert.deepEqual(result.dns.edns_client_subnet, {
    enabled: false,
    use_custom: false,
    custom_ip: ""
  });
  assert.equal(result.dns.cache_size, 4_194_304);
  assert.equal(result.dns.cache_ttl_min, 0);
  assert.equal(result.dns.cache_ttl_max, 0);
  assert.equal(result.dns.cache_optimistic, false);
  assert.deepEqual(result.filtering.rewrites, []);
  assert.deepEqual(result.user_rules, []);
  assert.match(stdout, /settings only/u);
});

test("direct CLI rejects invalid managed settings before writing YAML", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "adguard-config-cli-invalid-"));
  const sourcePath = path.join(directory, "source.yaml");
  context.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(sourcePath, SOURCE_CONFIG);

  const minimalDns = { port: 5353, upstreamDns: ["tls://dns.example"] };
  for (const [name, invalidDns, expectedError] of [
    ["port", { ...minimalDns, port: 0 }, /ADGUARD_DNS_PORT/u],
    ["rate-limit", { ...minimalDns, rateLimit: "bogus" }, /ADGUARD_RATE_LIMIT/u],
    ["ipv4-prefix", { ...minimalDns, rateLimitSubnetLenIpv4: 99 }, /ADGUARD_RATE_LIMIT_SUBNET_LEN_IPV4/u],
    ["ipv6-prefix", { ...minimalDns, rateLimitSubnetLenIpv6: 999 }, /ADGUARD_RATE_LIMIT_SUBNET_LEN_IPV6/u],
    ["whitelist-shape", { ...minimalDns, rateLimitWhitelist: "not-a-list" }, /ADGUARD_RATE_LIMIT_WHITELIST/u],
    ["edns", { ...minimalDns, ednsClientSubnet: { enabled: "yes" } }, /ADGUARD_EDNS_CLIENT_SUBNET_ENABLED/u],
    ["edns-ip", { ...minimalDns, ednsClientSubnet: { useCustom: true, customIp: "invalid" } }, /ADGUARD_EDNS_CLIENT_SUBNET_CUSTOM_IP/u],
    ["cache-size", { ...minimalDns, cacheSize: -1 }, /ADGUARD_CACHE_SIZE/u],
    ["cache-ttl", { ...minimalDns, cacheTtlMin: 60, cacheTtlMax: 30 }, /ADGUARD_CACHE_TTL_MIN/u],
    ["cache-optimistic", { ...minimalDns, cacheOptimistic: "true" }, /ADGUARD_CACHE_OPTIMISTIC/u]
  ]) {
    const outputPath = path.join(directory, `${name}.yaml`);
    await assert.rejects(
      execFileAsync(process.execPath, [
        path.join(import.meta.dirname, "adguard-config.js"),
        sourcePath,
        "-",
        "6h",
        "8080",
        JSON.stringify(invalidDns),
        outputPath
      ]),
      (error) => {
        assert.match(error.stderr, expectedError);
        return true;
      }
    );
    await assert.rejects(readFile(outputPath), { code: "ENOENT" });
  }

  const malformedOutputPath = path.join(directory, "malformed-dns.yaml");
  await assert.rejects(
    execFileAsync(process.execPath, [
      path.join(import.meta.dirname, "adguard-config.js"),
      sourcePath,
      "-",
      "6h",
      "8080",
      "not-json",
      malformedOutputPath
    ]),
    (error) => {
      assert.match(error.stderr, /ADGUARD_DNS must be valid JSON/u);
      return true;
    }
  );
  await assert.rejects(readFile(malformedOutputPath), { code: "ENOENT" });
});

test("rejects invalid managed AdGuard Home settings", () => {
  const rewrites = parseAdguardRewrites(REWRITES_YAML);
  const settings = {
    ...MANAGED_SETTINGS,
    rewrites
  };

  assert.throws(
    () => patchAdguardConfig(SOURCE_CONFIG, { ...settings, querylogInterval: "six-hours" }),
    /ADGUARD_QUERYLOG_INTERVAL/u
  );
  assert.throws(
    () => patchAdguardConfig(SOURCE_CONFIG, { ...settings, webPort: "70000" }),
    /ADGUARD_WEB_PORT/u
  );
  assert.throws(
    () => patchAdguardConfig(SOURCE_CONFIG, {
      ...settings,
      dns: { ...settings.dns, port: "70000" }
    }),
    /ADGUARD_DNS_PORT/u
  );
  assert.throws(
    () => patchAdguardConfig(SOURCE_CONFIG, {
      ...settings,
      dns: { ...settings.dns, rateLimit: Number.NaN }
    }),
    /ADGUARD_RATE_LIMIT/u
  );
  assert.throws(
    () => patchAdguardConfig(SOURCE_CONFIG, {
      ...settings,
      dns: { ...settings.dns, rateLimitSubnetLenIpv4: 99 }
    }),
    /ADGUARD_RATE_LIMIT_SUBNET_LEN_IPV4/u
  );
  assert.throws(
    () => patchAdguardConfig(SOURCE_CONFIG, {
      ...settings,
      dns: { ...settings.dns, rateLimitSubnetLenIpv6: 999 }
    }),
    /ADGUARD_RATE_LIMIT_SUBNET_LEN_IPV6/u
  );
  assert.throws(
    () => patchAdguardConfig(SOURCE_CONFIG, {
      ...settings,
      dns: { ...settings.dns, rateLimitWhitelist: "not-a-list" }
    }),
    /ADGUARD_RATE_LIMIT_WHITELIST/u
  );
  assert.throws(
    () => patchAdguardConfig(SOURCE_CONFIG, {
      ...settings,
      dns: { ...settings.dns, ednsClientSubnet: "false" }
    }),
    /ADGUARD_EDNS_CLIENT_SUBNET/u
  );
  assert.throws(
    () => patchAdguardConfig(SOURCE_CONFIG, {
      ...settings,
      dns: { ...settings.dns, cacheTtlMin: 90, cacheTtlMax: 60 }
    }),
    /ADGUARD_CACHE_TTL_MIN/u
  );
});
