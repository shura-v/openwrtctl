import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { parseProjectConfig } from "./lib/config.js";
import { PROJECT_DIRECTORY } from "./lib/remote.js";

const CONFIG = `
openwrt:
  endpoint: root@192.168.1.1
  sshPort: 22
  remoteTmpDir: /root/tmp
adguard:
  rewriteIp: 94.183.189.30
  querylogInterval: 6h
  webPort: 8080
  dnsPort: 5353
  upstreamDns: [https://cloudflare-dns.com/dns-query, tls://common.dot.dns.yandex.net]
  bootstrapDns: [1.1.1.1, 77.88.8.8]
  upstreamMode: load_balance
singboxctl:
  profile: router
  ruleSetsDirectory: ./rule-sets
backup:
  directory: ./backups
nfqws2:
  test:
    httpsDomains: [www.youtube.com, example.org]
  filter:
    tcp: [443, 80]
    udp: [3478-3481, 5349]
  filterL7:
    tcp: [http, tls]
    udp: [stun]
  strategy:
    http: --payload=http_req
    https: --payload=tls_client_hello
    udp: --payload=stun
`;

test("parses the OpenWrt project config", () => {
  assert.deepEqual(parseProjectConfig(CONFIG, "/project/config.yaml"), {
    openwrt: {
      endpoint: "root@192.168.1.1",
      sshPort: 22,
      remoteTmpDir: "/root/tmp"
    },
    adguard: {
      rewriteIp: "94.183.189.30",
      querylogInterval: "6h",
      webPort: 8080,
      dnsPort: 5353,
      upstreamDns: [
        "https://cloudflare-dns.com/dns-query",
        "tls://common.dot.dns.yandex.net"
      ],
      bootstrapDns: ["1.1.1.1", "77.88.8.8"],
      upstreamMode: "load_balance"
    },
    singboxctl: {
      profile: "router",
      ruleSetsDirectory: "/project/rule-sets"
    },
    backup: {
      directory: "/project/backups"
    },
    nfqws2: {
      test: {
        httpsDomains: ["www.youtube.com", "example.org"]
      },
      filter: {
        tcp: ["443", "80"],
        udp: ["3478-3481", "5349"]
      },
      filterL7: {
        tcp: ["http", "tls"],
        udp: ["stun"]
      },
      strategy: {
        http: "--payload=http_req",
        https: "--payload=tls_client_hello",
        udp: "--payload=stun"
      }
    }
  });
});

test("loads the example nfqws2 HTTPS test domain", async () => {
  const exampleConfig = await readFile(
    path.join(PROJECT_DIRECTORY, "config.example.yaml"),
    "utf8"
  );

  assert.deepEqual(
    parseProjectConfig(exampleConfig, path.join(PROJECT_DIRECTORY, "config.example.yaml"))
      .nfqws2.test.httpsDomains,
    ["www.youtube.com"]
  );
});

test("rejects invalid project config values", () => {
  assert.throws(
    () =>
      parseProjectConfig(
        CONFIG.replace(
          "upstreamDns: [https://cloudflare-dns.com/dns-query, tls://common.dot.dns.yandex.net]",
          "upstreamDns: []"
        ),
        "/project/config.yaml"
      ),
    /adguard\.upstreamDns/u
  );
  assert.throws(
    () =>
      parseProjectConfig(
        CONFIG.replace("bootstrapDns: [1.1.1.1, 77.88.8.8]", "bootstrapDns: [1.1.1.1, 53]"),
        "/project/config.yaml"
      ),
    /adguard\.bootstrapDns/u
  );
  assert.deepEqual(
    parseProjectConfig(
      CONFIG.replace("bootstrapDns: [1.1.1.1, 77.88.8.8]", "bootstrapDns: []"),
      "/project/config.yaml"
    ).adguard.bootstrapDns,
    []
  );
  assert.throws(
    () =>
      parseProjectConfig(
        CONFIG.replace("upstreamMode: load_balance", "upstreamMode: random"),
        "/project/config.yaml"
      ),
    /adguard\.upstreamMode/u
  );
  assert.throws(
    () =>
      parseProjectConfig(
        CONFIG.replace("webPort: 8080", "webPort: 70000"),
        "/project/config.yaml"
      ),
    /adguard\.webPort/u
  );
  assert.throws(
    () =>
      parseProjectConfig(
        CONFIG.replace("dnsPort: 5353", "dnsPort: 0"),
        "/project/config.yaml"
      ),
    /adguard\.dnsPort/u
  );
  assert.throws(
    () =>
      parseProjectConfig(
        CONFIG.replace("remoteTmpDir: /root/tmp", "remoteTmpDir: /root/../tmp"),
        "/project/config.yaml"
      ),
    /openwrt\.remoteTmpDir/u
  );
  assert.throws(
    () =>
      parseProjectConfig(
        CONFIG.replace("httpsDomains: [www.youtube.com, example.org]", "httpsDomains: []"),
        "/project/config.yaml"
      ),
    /nfqws2\.test\.httpsDomains/u
  );
  assert.throws(
    () =>
      parseProjectConfig(
        CONFIG.replace(
          "httpsDomains: [www.youtube.com, example.org]",
          "httpsDomains: [https://www.youtube.com, 'bad; command']"
        ),
        "/project/config.yaml"
      ),
    /nfqws2\.test\.httpsDomains/u
  );
  assert.throws(
    () =>
      parseProjectConfig(
        CONFIG.replace("http: --payload=http_req", "http: ''"),
        "/project/config.yaml"
      ),
    /nfqws2\.strategy\.http/u
  );
  assert.throws(
    () =>
      parseProjectConfig(
        CONFIG.replace("tcp: [443, 80]", "tcp: []"),
        "/project/config.yaml"
      ),
    /nfqws2\.filter\.tcp/u
  );
  assert.throws(
    () =>
      parseProjectConfig(
        CONFIG.replace("udp: [3478-3481, 5349]", "udp: [65536]"),
        "/project/config.yaml"
      ),
    /nfqws2\.filter\.udp/u
  );
  assert.throws(
    () =>
      parseProjectConfig(
        CONFIG.replace("profile: router", "profile: 'bad profile'"),
        "/project/config.yaml"
      ),
    /singboxctl\.profile/u
  );
});
