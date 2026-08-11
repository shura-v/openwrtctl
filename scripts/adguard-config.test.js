import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { parse } from "yaml";
import {
  ADGUARD_BOOTSTRAP_DNS,
  ADGUARD_UPSTREAM_DNS,
  buildAdguardRewrites,
  patchAdguardConfig
} from "./adguard-config.js";
import { loadRouterResources } from "./lib/router-resources.js";

test("joins generated profile resources with route metadata", async () => {
  const fixture = await createFixture();

  const resources = await loadRouterResources(fixture.singBoxConfigPath, fixture.ruleSetsDirectoryPath);

  assert.deepEqual(resources, [
    { kind: "domain", value: "direct.example", route: undefined, ruleSetNames: ["direct"] },
    { kind: "domain_suffix", value: "dns.example", route: "dns", ruleSetNames: ["dns"] },
    { kind: "ip_cidr", value: "192.0.2.0/24", route: "proxy", ruleSetNames: ["proxy"] }
  ]);
});

test("patches only managed AdGuard Home fields", async () => {
  const resources = [
    { kind: "domain", value: "exact.example", route: "dns" },
    { kind: "domain_suffix", value: "suffix.example", route: "dns" },
    { kind: "domain_suffix", value: "proxy.example", route: "proxy" }
  ];
  const rewrites = buildAdguardRewrites(resources, "192.0.2.10");
  const source = `
users:
  - name: admin
    password: preserved-hash
dns:
  upstream_dns:
    - https://old.example/dns-query
  bootstrap_dns:
    - 192.0.2.53
  upstream_mode: parallel
  cache_size: 1234
filtering:
  filtering_enabled: true
  rewrites: []
querylog:
  interval: 90d
  size_memory: 1000
http:
  address: 0.0.0.0:3000
`;

  const result = parse(patchAdguardConfig(source, rewrites, "6h", "8080"));

  assert.deepEqual(result.users, [{ name: "admin", password: "preserved-hash" }]);
  assert.equal(result.dns.cache_size, 1234);
  assert.equal(result.filtering.filtering_enabled, true);
  assert.equal(result.querylog.interval, "6h");
  assert.equal(result.querylog.size_memory, 1000);
  assert.equal(result.http.address, "0.0.0.0:8080");
  assert.deepEqual(result.dns.upstream_dns, ADGUARD_UPSTREAM_DNS);
  assert.deepEqual(result.dns.bootstrap_dns, ADGUARD_BOOTSTRAP_DNS);
  assert.equal(result.dns.upstream_mode, "load_balance");
  assert.deepEqual(result.filtering.rewrites, [
    { domain: "*.suffix.example", answer: "192.0.2.10", enabled: true },
    { domain: "exact.example", answer: "192.0.2.10", enabled: true },
    { domain: "suffix.example", answer: "192.0.2.10", enabled: true }
  ]);
  assert.throws(
    () => patchAdguardConfig(source, rewrites, "six-hours", "8080"),
    /ADGUARD_QUERYLOG_INTERVAL/u
  );
  assert.throws(
    () => patchAdguardConfig(source, rewrites, "6h", "70000"),
    /ADGUARD_WEB_PORT/u
  );
});

test("rejects conflicting routes for the same resource", async () => {
  const fixture = await createFixture();
  await writeJson(path.join(fixture.ruleSetsDirectoryPath, "conflict.json"), {
    route: "proxy",
    rules: ["domain_suffix:dns.example"]
  });

  await assert.rejects(
    loadRouterResources(fixture.singBoxConfigPath, fixture.ruleSetsDirectoryPath),
    /conflicting routes/u
  );
});

async function createFixture() {
  const directoryPath = await mkdtemp(path.join(tmpdir(), "openwrt-router-resources-"));
  const ruleSetsDirectoryPath = path.join(directoryPath, "rule-sets");
  const singBoxConfigPath = path.join(directoryPath, "sing-box.json");
  await mkdir(ruleSetsDirectoryPath);
  await writeJson(path.join(ruleSetsDirectoryPath, "direct.json"), {
    rules: ["domain:direct.example"]
  });
  await writeJson(path.join(ruleSetsDirectoryPath, "dns.json"), {
    route: "dns",
    rules: ["domain_suffix:dns.example"]
  });
  await writeJson(path.join(ruleSetsDirectoryPath, "proxy.json"), {
    route: "proxy",
    rules: ["ip_cidr:192.0.2.0/24"]
  });
  await writeJson(singBoxConfigPath, {
    route: {
      rules: [
        { action: "route", outbound: "proxy", domain: ["direct.example"] },
        { action: "route", outbound: "proxy", domain_suffix: ["dns.example"] },
        { action: "route", outbound: "proxy", ip_cidr: ["192.0.2.0/24"] }
      ]
    }
  });

  return { ruleSetsDirectoryPath, singBoxConfigPath };
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
