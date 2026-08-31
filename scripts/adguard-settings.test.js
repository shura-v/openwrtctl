import assert from "node:assert/strict";
import test from "node:test";
import { parseAdguardSettings } from "./lib/adguard-settings.js";

const MINIMAL_SETTINGS = {
  webPort: 8080,
  dns: {
    port: 5353,
    upstreamDns: ["tls://dns.example"]
  }
};

test("normalizes AdGuard defaults from one shared schema", () => {
  const first = parseAdguardSettings(MINIMAL_SETTINGS);
  const second = parseAdguardSettings(MINIMAL_SETTINGS);

  assert.deepEqual(first, {
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
      cacheTtlMin: 0,
      cacheTtlMax: 0,
      cacheOptimistic: false
    }
  });
  assert.notEqual(first.dns, second.dns);
  assert.notEqual(first.dns.bootstrapDns, second.dns.bootstrapDns);
  assert.notEqual(first.dns.rateLimitWhitelist, second.dns.rateLimitWhitelist);
  assert.notEqual(first.dns.ednsClientSubnet, second.dns.ednsClientSubnet);
});

test("reports stable field-specific AdGuard validation errors", () => {
  for (const [field, value, expectedMessage] of [
    ["rateLimit", Number.NaN, /adguard\.dns\.rateLimit must be a non-negative integer/u],
    ["rateLimitSubnetLenIpv4", 33, /adguard\.dns\.rateLimitSubnetLenIpv4/u],
    ["rateLimitSubnetLenIpv6", 129, /adguard\.dns\.rateLimitSubnetLenIpv6/u],
    ["rateLimitWhitelist", "not-a-list", /adguard\.dns\.rateLimitWhitelist/u],
    ["cacheSize", -1, /adguard\.dns\.cacheSize/u],
    ["cacheOptimistic", "false", /adguard\.dns\.cacheOptimistic/u]
  ]) {
    assert.throws(
      () => parseAdguardSettings({
        ...MINIMAL_SETTINGS,
        dns: { ...MINIMAL_SETTINGS.dns, [field]: value }
      }),
      expectedMessage
    );
  }
});

test("validates structured EDNS and cache relationships", () => {
  const explicit = parseAdguardSettings({
    ...MINIMAL_SETTINGS,
    dns: {
      ...MINIMAL_SETTINGS.dns,
      ednsClientSubnet: {
        enabled: true,
        useCustom: true,
        customIp: "2001:db8::1"
      },
      cacheSize: 8_388_608,
      cacheTtlMin: 30,
      cacheTtlMax: 60,
      cacheOptimistic: true
    }
  });

  assert.deepEqual(explicit.dns.ednsClientSubnet, {
    enabled: true,
    useCustom: true,
    customIp: "2001:db8::1"
  });
  assert.equal(explicit.dns.cacheTtlMin, 30);
  assert.equal(explicit.dns.cacheTtlMax, 60);

  assert.throws(
    () => parseAdguardSettings({
      ...MINIMAL_SETTINGS,
      dns: {
        ...MINIMAL_SETTINGS.dns,
        ednsClientSubnet: { useCustom: true, customIp: "not-an-ip" }
      }
    }),
    /adguard\.dns\.ednsClientSubnet\.customIp/u
  );
  assert.throws(
    () => parseAdguardSettings({
      ...MINIMAL_SETTINGS,
      dns: {
        ...MINIMAL_SETTINGS.dns,
        ednsClientSubnet: { useCustom: false, customIp: "not-an-ip" }
      }
    }),
    /adguard\.dns\.ednsClientSubnet\.customIp/u
  );
  assert.throws(
    () => parseAdguardSettings({
      ...MINIMAL_SETTINGS,
      dns: { ...MINIMAL_SETTINGS.dns, cacheTtlMin: 60, cacheTtlMax: 30 }
    }),
    /adguard\.dns\.cacheTtlMin/u
  );
});

test("rejects missing DNS and removed flat settings", () => {
  assert.throws(
    () => parseAdguardSettings({ webPort: 8080 }),
    /adguard\.dns must be a mapping/u
  );
  assert.throws(
    () => parseAdguardSettings({ ...MINIMAL_SETTINGS, dnsPort: 5353 }),
    /adguard\.dnsPort is not supported/u
  );
  assert.throws(
    () => parseAdguardSettings({
      ...MINIMAL_SETTINGS,
      dns: { ...MINIMAL_SETTINGS.dns, cache: {} }
    }),
    /adguard\.dns\.cache is not supported/u
  );
});
