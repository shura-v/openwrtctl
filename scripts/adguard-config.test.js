import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { parse } from "yaml";
import {
  generateAdguardConfig,
  parseAdguardRewrites,
  parseAdguardUserRules,
  patchAdguardConfig
} from "./adguard-config.js";

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
  const upstreamDns = ["tls://dns.example"];
  const bootstrapDns = ["192.0.2.54"];
  const result = parse(
    patchAdguardConfig(SOURCE_CONFIG, {
      rewrites,
      querylogInterval: "6h",
      webPort: "8080",
      dnsPort: "5353",
      upstreamDns,
      bootstrapDns,
      upstreamMode: "fastest_addr"
    })
  );

  assert.deepEqual(result.users, [{ name: "admin", password: "preserved-hash" }]);
  assert.equal(result.dns.port, 5353);
  assert.equal(result.dns.cache_size, 1234);
  assert.equal(result.filtering.filtering_enabled, true);
  assert.equal(result.querylog.interval, "6h");
  assert.equal(result.querylog.size_memory, 1000);
  assert.equal(result.http.address, "0.0.0.0:8080");
  assert.deepEqual(result.dns.upstream_dns, upstreamDns);
  assert.deepEqual(result.dns.bootstrap_dns, bootstrapDns);
  assert.equal(result.dns.upstream_mode, "fastest_addr");
  assert.deepEqual(result.filtering.rewrites, rewrites);
  assert.deepEqual(result.user_rules, []);

  const withoutRewrites = parse(
    patchAdguardConfig(SOURCE_CONFIG, {
      rewrites: parseAdguardRewrites("[]\n"),
      querylogInterval: "6h",
      webPort: "8080",
      dnsPort: "5353",
      upstreamDns,
      bootstrapDns,
      upstreamMode: "fastest_addr"
    })
  );
  assert.deepEqual(withoutRewrites.filtering.rewrites, []);
});

test("writes empty AdGuard bootstrap DNS when omitted or explicitly empty", () => {
  const settings = {
    rewrites: [],
    querylogInterval: "6h",
    webPort: "8080",
    dnsPort: "5353",
    upstreamDns: ["tls://dns.example"],
    upstreamMode: "fastest_addr"
  };
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
      querylogInterval: "6h",
      webPort: "8080",
      dnsPort: "5353",
      upstreamDns: ["tls://dns.example"],
      bootstrapDns: ["192.0.2.54"],
      upstreamMode: "fastest_addr"
    })
  );

  assert.deepEqual(result.user_rules, userRules);
  assert.deepEqual(result.filtering.rewrites, []);
});

test("requires exactly one managed AdGuard artifact", () => {
  const settings = {
    querylogInterval: "6h",
    webPort: "8080",
    dnsPort: "5353",
    upstreamDns: ["tls://dns.example"],
    bootstrapDns: ["192.0.2.54"],
    upstreamMode: "load_balance"
  };

  assert.throws(
    () => patchAdguardConfig(SOURCE_CONFIG, settings),
    /exactly one of rewrites or userRules/u
  );
  assert.throws(
    () => patchAdguardConfig(SOURCE_CONFIG, { ...settings, rewrites: [], userRules: [] }),
    /exactly one of rewrites or userRules/u
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
    querylogInterval: "6h",
    webPort: "8080",
    dnsPort: "5353",
    upstreamDns: ["tls://dns.example"],
    bootstrapDns: ["192.0.2.54"],
    upstreamMode: "fastest_addr",
    outputPath
  });

  assert.deepEqual(parse(await readFile(outputPath, "utf8")).filtering.rewrites, [
    { domain: "exact.example", answer: "192.0.2.10", enabled: true },
    { domain: "*.suffix.example", answer: "target.example", enabled: true },
    { domain: "disabled.example", answer: "192.0.2.11", enabled: false }
  ]);
});

test("rejects invalid managed AdGuard Home settings", () => {
  const rewrites = parseAdguardRewrites(REWRITES_YAML);
  const settings = {
    rewrites,
    querylogInterval: "6h",
    webPort: "8080",
    dnsPort: "5353",
    upstreamDns: ["tls://dns.example"],
    bootstrapDns: ["192.0.2.54"],
    upstreamMode: "load_balance"
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
});
