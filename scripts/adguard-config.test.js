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
  dnsPort: 5353,
  upstreamDns: ["tls://dns.example"],
  bootstrapDns: ["192.0.2.54"],
  upstreamMode: "fastest_addr",
  rateLimit: 100,
  rateLimitSubnetLenIpv4: 24,
  rateLimitSubnetLenIpv6: 56,
  rateLimitWhitelist: ["198.51.100.10", "2001:db8::/64"],
  ednsClientSubnet: false
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
  assert.equal(result.dns.cache_size, 1234);
  assert.equal(result.filtering.filtering_enabled, true);
  assert.equal(result.querylog.interval, "6h");
  assert.equal(result.querylog.size_memory, 1000);
  assert.equal(result.http.address, "0.0.0.0:8080");
  assert.deepEqual(result.dns.upstream_dns, MANAGED_SETTINGS.upstreamDns);
  assert.deepEqual(result.dns.bootstrap_dns, MANAGED_SETTINGS.bootstrapDns);
  assert.equal(result.dns.upstream_mode, "fastest_addr");
  assert.equal(result.dns.ratelimit, 100);
  assert.equal(result.dns.ratelimit_subnet_len_ipv4, 24);
  assert.equal(result.dns.ratelimit_subnet_len_ipv6, 56);
  assert.deepEqual(result.dns.ratelimit_whitelist, MANAGED_SETTINGS.rateLimitWhitelist);
  assert.deepEqual(result.dns.edns_client_subnet, {
    enabled: false,
    use_custom: false,
    custom_ip: ""
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
    rewrites: []
  };
  delete settings.bootstrapDns;
  const defaulted = parse(patchAdguardConfig(SOURCE_CONFIG, settings));
  const cleared = parse(
    patchAdguardConfig(SOURCE_CONFIG, { ...settings, bootstrapDns: [] })
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
    "5353",
    '["tls://dns.example"]',
    "[]",
    "load_balance",
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
  assert.deepEqual(result.filtering.rewrites, []);
  assert.deepEqual(result.user_rules, []);
  assert.match(stdout, /settings only/u);
});

test("direct CLI rejects invalid managed settings before writing YAML", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "adguard-config-cli-invalid-"));
  const sourcePath = path.join(directory, "source.yaml");
  context.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(sourcePath, SOURCE_CONFIG);

  for (const [name, optionalArguments, expectedError] of [
    ["rate-limit", ["bogus"], /ADGUARD_RATE_LIMIT/u],
    ["non-decimal-rate-limit", ["0x10"], /ADGUARD_RATE_LIMIT/u],
    ["ipv4-prefix", ["0", "99"], /ADGUARD_RATE_LIMIT_SUBNET_LEN_IPV4/u],
    ["ipv6-prefix", ["0", "24", "999"], /ADGUARD_RATE_LIMIT_SUBNET_LEN_IPV6/u],
    ["whitelist-shape", ["0", "24", "56", '"not-a-list"'], /ADGUARD_RATE_LIMIT_WHITELIST/u],
    ["whitelist-json", ["0", "24", "56", "not-json"], /ADGUARD_RATE_LIMIT_WHITELIST/u],
    ["edns", ["0", "24", "56", "[]", "yes"], /ADGUARD_EDNS_CLIENT_SUBNET/u]
  ]) {
    const outputPath = path.join(directory, `${name}.yaml`);
    await assert.rejects(
      execFileAsync(process.execPath, [
        path.join(import.meta.dirname, "adguard-config.js"),
        sourcePath,
        "-",
        "6h",
        "8080",
        "5353",
        '["tls://dns.example"]',
        "[]",
        "load_balance",
        outputPath,
        ...optionalArguments
      ]),
      (error) => {
        assert.match(error.stderr, expectedError);
        return true;
      }
    );
    await assert.rejects(readFile(outputPath), { code: "ENOENT" });
  }
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
    () => patchAdguardConfig(SOURCE_CONFIG, { ...settings, dnsPort: "70000" }),
    /ADGUARD_DNS_PORT/u
  );
  assert.throws(
    () => patchAdguardConfig(SOURCE_CONFIG, { ...settings, rateLimit: Number.NaN }),
    /ADGUARD_RATE_LIMIT/u
  );
  assert.throws(
    () => patchAdguardConfig(SOURCE_CONFIG, { ...settings, rateLimitSubnetLenIpv4: 99 }),
    /ADGUARD_RATE_LIMIT_SUBNET_LEN_IPV4/u
  );
  assert.throws(
    () => patchAdguardConfig(SOURCE_CONFIG, { ...settings, rateLimitSubnetLenIpv6: 999 }),
    /ADGUARD_RATE_LIMIT_SUBNET_LEN_IPV6/u
  );
  assert.throws(
    () => patchAdguardConfig(SOURCE_CONFIG, { ...settings, rateLimitWhitelist: "not-a-list" }),
    /ADGUARD_RATE_LIMIT_WHITELIST/u
  );
  assert.throws(
    () => patchAdguardConfig(SOURCE_CONFIG, { ...settings, ednsClientSubnet: "false" }),
    /ADGUARD_EDNS_CLIENT_SUBNET/u
  );
});
