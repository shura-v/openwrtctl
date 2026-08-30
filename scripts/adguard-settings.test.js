import assert from "node:assert/strict";
import test from "node:test";
import { parseAdguardSettings } from "./lib/adguard-settings.js";

const MINIMAL_SETTINGS = {
  webPort: 8080,
  dnsPort: 5353,
  upstreamDns: ["tls://dns.example"]
};

test("normalizes AdGuard defaults from one shared schema", () => {
  const first = parseAdguardSettings(MINIMAL_SETTINGS);
  const second = parseAdguardSettings(MINIMAL_SETTINGS);

  assert.deepEqual(first, {
    querylogInterval: "6h",
    webPort: 8080,
    dnsPort: 5353,
    upstreamDns: ["tls://dns.example"],
    bootstrapDns: [],
    upstreamMode: "load_balance",
    rateLimit: 0,
    rateLimitSubnetLenIpv4: 24,
    rateLimitSubnetLenIpv6: 56,
    rateLimitWhitelist: [],
    ednsClientSubnet: false
  });
  assert.notEqual(first.bootstrapDns, second.bootstrapDns);
  assert.notEqual(first.rateLimitWhitelist, second.rateLimitWhitelist);
});

test("reports stable field-specific AdGuard validation errors", () => {
  for (const [field, value, expectedMessage] of [
    ["rateLimit", Number.NaN, /adguard\.rateLimit must be a non-negative integer/u],
    ["rateLimitSubnetLenIpv4", 33, /adguard\.rateLimitSubnetLenIpv4/u],
    ["rateLimitSubnetLenIpv6", 129, /adguard\.rateLimitSubnetLenIpv6/u],
    ["rateLimitWhitelist", "not-a-list", /adguard\.rateLimitWhitelist/u],
    ["ednsClientSubnet", "false", /adguard\.ednsClientSubnet/u]
  ]) {
    assert.throws(
      () => parseAdguardSettings({ ...MINIMAL_SETTINGS, [field]: value }),
      expectedMessage
    );
  }
});
