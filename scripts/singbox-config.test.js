import assert from "node:assert/strict";
import test from "node:test";
import {
  patchSingBoxConfig,
  TUN_INCLUDE_INTERFACE,
  TUN_ROUTE_EXCLUDE_ADDRESS
} from "./singbox-config.js";

test("builds an OpenWrt TUN config with only route proxy resources", () => {
  const source = createSourceConfig();
  const resources = [
    { kind: "domain", value: "proxy.example", route: "proxy" },
    { kind: "domain_suffix", value: "dns.example", route: "dns" },
    { kind: "domain_suffix", value: "nfq.example", route: undefined },
    { kind: "ip_cidr", value: "192.0.2.0/24", route: "proxy" }
  ];

  const result = patchSingBoxConfig(source, resources);
  const tun = result.inbounds.find((inbound) => inbound.type === "tun");
  const proxyRules = result.route.rules.filter(
    (rule) => rule.action === "route" && rule.outbound === "proxy"
  );

  assert.deepEqual(tun, {
    type: "tun",
    tag: "tun-in",
    address: ["172.19.0.1/30"],
    auto_route: true,
    auto_redirect: true,
    include_interface: TUN_INCLUDE_INTERFACE,
    route_exclude_address: TUN_ROUTE_EXCLUDE_ADDRESS,
    strict_route: false
  });
  assert.equal(result.route.final, "direct");
  assert.equal(result.route.auto_detect_interface, true);
  assert.deepEqual(proxyRules, [
    {
      action: "route",
      outbound: "proxy",
      domain: ["proxy.example"]
    },
    {
      action: "route",
      outbound: "proxy",
      ip_cidr: ["192.0.2.0/24"]
    }
  ]);
  assert.doesNotMatch(JSON.stringify(proxyRules), /dns\.example|nfq\.example/u);
  assert.equal(result.outbounds[0].password, "preserved-secret");
  assert.deepEqual(result.route.rules.slice(0, 2), [
    { action: "sniff" },
    { action: "route", ip_is_private: true, outbound: "direct" }
  ]);
  assert.equal(
    result.route.rules.some((rule) => rule.action === "hijack-dns"),
    false
  );
});

test("rejects generated configs without the required TUN and outbounds", () => {
  const source = createSourceConfig();

  assert.throws(
    () => patchSingBoxConfig({ ...source, inbounds: [] }, []),
    /exactly one TUN inbound/u
  );
  assert.throws(
    () =>
      patchSingBoxConfig(
        {
          ...source,
          outbounds: source.outbounds.filter((outbound) => outbound.tag !== "direct")
        },
        []
      ),
    /no direct outbound/u
  );
});

function createSourceConfig() {
  return {
    log: { level: "error" },
    dns: { servers: [{ type: "local", tag: "local-dns" }], final: "local-dns" },
    inbounds: [
      {
        type: "tun",
        tag: "tun-in",
        address: ["172.19.0.1/30"],
        auto_route: true,
        strict_route: true
      }
    ],
    outbounds: [
      {
        type: "hysteria2",
        tag: "proxy",
        server: "proxy.example",
        password: "preserved-secret"
      },
      { type: "direct", tag: "direct" }
    ],
    route: {
      auto_detect_interface: true,
      final: "proxy",
      rules: [
        { action: "sniff" },
        { action: "hijack-dns", protocol: "dns" },
        { action: "route", ip_is_private: true, outbound: "direct" },
        { action: "route", outbound: "proxy", domain: ["all.example"] },
        { action: "route", outbound: "proxy", ip_cidr: ["198.51.100.0/24"] }
      ]
    }
  };
}
