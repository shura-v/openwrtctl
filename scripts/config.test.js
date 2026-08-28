import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseProjectConfig } from "./lib/config.js";
import { PROJECT_DIRECTORY } from "./lib/remote.js";

const COMMON_CONFIG = `
openwrt:
  endpoint: root@192.168.1.1
  sshPort: 22
  remoteTmpDir: /root/tmp
backup:
  directory: ./backups
`;

const ADGUARD_CONFIG = `
adguard:
  rewrites:
    path: ./generated/adguard-rewrites.yaml
    prepare:
      command: [openwrtctl-adguard-rewrites, router, "{output}"]
      cwd: ./producers
  querylogInterval: 6h
  webPort: 8080
  dnsPort: 5353
  upstreamDns: [https://cloudflare-dns.com/dns-query, tls://common.dot.dns.yandex.net]
  bootstrapDns: [1.1.1.1, 77.88.8.8]
  upstreamMode: load_balance
`;

const ADGUARD_USER_RULES_CONFIG = ADGUARD_CONFIG.replace(
  `  rewrites:
    path: ./generated/adguard-rewrites.yaml
    prepare:
      command: [openwrtctl-adguard-rewrites, router, "{output}"]
      cwd: ./producers
`,
  `  userRules:
    path: ./generated/adguard-user-rules.yaml
`
);

const SINGBOX_CONFIG = `
singbox:
  config:
    path: ~/.config/openwrtctl/generated/sing-box.json
    prepare:
      command: [openwrtctl-singbox-config, router, "{output}"]
`;

const NFQWS2_CONFIG = `
nfqws2:
  resources:
    path: ./generated/nfqws2-resources.yaml
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

const CONFIG = `${COMMON_CONFIG}${ADGUARD_CONFIG}${SINGBOX_CONFIG}${NFQWS2_CONFIG}`;

test("parses the OpenWrt project config", () => {
  assert.deepEqual(parseProjectConfig(CONFIG, "/project/config.yaml"), {
    openwrt: {
      endpoint: "root@192.168.1.1",
      sshPort: 22,
      remoteTmpDir: "/root/tmp"
    },
    adguard: {
      rewrites: {
        path: "/project/generated/adguard-rewrites.yaml",
        prepare: {
          command: ["openwrtctl-adguard-rewrites", "router", "{output}"],
          cwd: "/project/producers"
        }
      },
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
    singbox: {
      config: {
        path: path.join(os.homedir(), ".config/openwrtctl/generated/sing-box.json"),
        prepare: {
          command: ["openwrtctl-singbox-config", "router", "{output}"],
          cwd: "/project"
        }
      }
    },
    backup: {
      directory: "/project/backups"
    },
    nfqws2: {
      resources: {
        path: "/project/generated/nfqws2-resources.yaml"
      },
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

test("accepts omitted and explicitly empty AdGuard bootstrap DNS", () => {
  const withoutBootstrapDns = parseProjectConfig(
    `${COMMON_CONFIG}${ADGUARD_CONFIG.replace(
      "  bootstrapDns: [1.1.1.1, 77.88.8.8]\n",
      ""
    )}`,
    "/project/config.yaml"
  );
  const withEmptyBootstrapDns = parseProjectConfig(
    `${COMMON_CONFIG}${ADGUARD_CONFIG.replace(
      "bootstrapDns: [1.1.1.1, 77.88.8.8]",
      "bootstrapDns: []"
    )}`,
    "/project/config.yaml"
  );

  assert.equal(Object.hasOwn(withoutBootstrapDns.adguard, "bootstrapDns"), false);
  assert.deepEqual(withEmptyBootstrapDns.adguard.bootstrapDns, []);
});

test("accepts a singbox-only config and omits absent services", () => {
  const parsed = parseProjectConfig(
    `${COMMON_CONFIG}${SINGBOX_CONFIG}`,
    "/project/config.yaml"
  );

  assert.deepEqual(parsed.singbox, {
    config: {
      path: path.join(os.homedir(), ".config/openwrtctl/generated/sing-box.json"),
      prepare: {
        command: ["openwrtctl-singbox-config", "router", "{output}"],
        cwd: "/project"
      }
    }
  });
  assert.equal(parsed.adguard, undefined);
  assert.equal(parsed.nfqws2, undefined);
  assert.equal(Object.hasOwn(parsed, "adguard"), false);
  assert.equal(Object.hasOwn(parsed, "nfqws2"), false);
});

test("accepts a common-only config and requires both common sections", () => {
  const parsed = parseProjectConfig(COMMON_CONFIG, "/project/config.yaml");

  assert.deepEqual(parsed, {
    openwrt: {
      endpoint: "root@192.168.1.1",
      sshPort: 22,
      remoteTmpDir: "/root/tmp"
    },
    backup: { directory: "/project/backups" }
  });
  assert.throws(
    () =>
      parseProjectConfig(
        `backup:\n  directory: ./backups\n`,
        "/project/config.yaml"
      ),
    /must contain openwrt and backup mappings/u
  );
  assert.throws(
    () =>
      parseProjectConfig(
        `openwrt:\n  endpoint: root@192.168.1.1\n  sshPort: 22\n  remoteTmpDir: /root/tmp\n`,
        "/project/config.yaml"
      ),
    /must contain openwrt and backup mappings/u
  );
});

test("validates every optional service independently", () => {
  for (const [serviceName, validSection, invalidSection, errorPattern] of [
    [
      "singbox",
      SINGBOX_CONFIG,
      SINGBOX_CONFIG.replace(
        "    path: ~/.config/openwrtctl/generated/sing-box.json\n",
        ""
      ),
      /singbox\.config\.path/u
    ],
    [
      "adguard",
      ADGUARD_CONFIG,
      ADGUARD_CONFIG.replace(
        "  upstreamDns: [https://cloudflare-dns.com/dns-query, tls://common.dot.dns.yandex.net]",
        "  upstreamDns: []"
      ),
      /adguard\.upstreamDns/u
    ],
    [
      "nfqws2",
      NFQWS2_CONFIG,
      NFQWS2_CONFIG.replace("    tcp: [443, 80]", "    tcp: []"),
      /nfqws2\.filter\.tcp/u
    ]
  ]) {
    const parsed = parseProjectConfig(
      `${COMMON_CONFIG}${validSection}`,
      "/project/config.yaml"
    );
    assert.notEqual(parsed[serviceName], undefined);
    assert.throws(
      () =>
        parseProjectConfig(
          `${COMMON_CONFIG}${invalidSection}`,
          "/project/config.yaml"
        ),
      errorPattern
    );
  }
});

test("loads the example artifact sources and nfqws2 HTTPS test domain", async () => {
  const exampleConfig = await readFile(
    path.join(PROJECT_DIRECTORY, "config.example.yaml"),
    "utf8"
  );
  const parsed = parseProjectConfig(
    exampleConfig,
    path.join(PROJECT_DIRECTORY, "config.example.yaml")
  );

  assert.equal(parsed.singbox.config.path, path.join(PROJECT_DIRECTORY, "generated/sing-box.json"));
  assert.equal(
    parsed.adguard.rewrites.path,
    path.join(PROJECT_DIRECTORY, "generated/adguard-rewrites.yaml")
  );
  assert.equal(
    parsed.nfqws2.resources.path,
    path.join(PROJECT_DIRECTORY, "generated/nfqws2-resources.yaml")
  );
  assert.equal(parsed.singbox.config.prepare.cwd, PROJECT_DIRECTORY);
  assert.deepEqual(parsed.nfqws2.test.httpsDomains, ["www.youtube.com"]);
});

test("accepts exactly one AdGuard artifact source", () => {
  const userRulesConfig = parseProjectConfig(
    `${COMMON_CONFIG}${ADGUARD_USER_RULES_CONFIG}`,
    "/project/config.yaml"
  );

  assert.deepEqual(userRulesConfig.adguard.userRules, {
    path: "/project/generated/adguard-user-rules.yaml"
  });
  assert.equal(Object.hasOwn(userRulesConfig.adguard, "rewrites"), false);
  assert.throws(
    () =>
      parseProjectConfig(
        `${COMMON_CONFIG}${ADGUARD_CONFIG.replace(
          "  querylogInterval:",
          "  userRules:\n    path: ./generated/adguard-user-rules.yaml\n  querylogInterval:"
        )}`,
        "/project/config.yaml"
      ),
    /exactly one of rewrites or userRules/u
  );
  assert.throws(
    () =>
      parseProjectConfig(
        `${COMMON_CONFIG}${ADGUARD_CONFIG.replace(
          /  rewrites:\n(?:    .*\n){4}/u,
          ""
        )}`,
        "/project/config.yaml"
      ),
    /exactly one of rewrites or userRules/u
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
        CONFIG.replace(
          "command: [openwrtctl-singbox-config, router, \"{output}\"]",
          "command: [openwrtctl-singbox-config, router]"
        ),
        "/project/config.yaml"
      ),
    /singbox\.config\.prepare\.command/u
  );
});

test("requires an artifact path in every present service", () => {
  for (const [artifactSource, sourceWithoutPath, fieldName] of [
    [
      "  config:\n    path: ~/.config/openwrtctl/generated/sing-box.json\n",
      "  config:\n",
      "singbox.config.path"
    ],
    [
      "  rewrites:\n    path: ./generated/adguard-rewrites.yaml\n",
      "  rewrites:\n",
      "adguard.rewrites.path"
    ],
    [
      "  userRules:\n    path: ./generated/adguard-user-rules.yaml\n",
      "  userRules:\n",
      "adguard.userRules.path"
    ],
    [
      "  resources:\n    path: ./generated/nfqws2-resources.yaml\n",
      "  resources:\n",
      "nfqws2.resources.path"
    ]
  ]) {
    const sourceConfig = fieldName === "adguard.userRules.path"
      ? `${COMMON_CONFIG}${ADGUARD_USER_RULES_CONFIG}`
      : CONFIG;
    assert.throws(
      () =>
        parseProjectConfig(
          sourceConfig.replace(artifactSource, sourceWithoutPath),
          "/project/config.yaml"
        ),
      new RegExp(fieldName.replaceAll(".", "\\."), "u")
    );
  }
});

test("validates artifact prepare commands and working directories", () => {
  assert.throws(
    () =>
      parseProjectConfig(
        CONFIG.replace(
          "command: [openwrtctl-singbox-config, router, \"{output}\"]",
          "command: [openwrtctl-singbox-config, router, \"prefix-{output}\"]"
        ),
        "/project/config.yaml"
      ),
    /singbox\.config\.prepare\.command.*standalone/u
  );
  assert.throws(
    () =>
      parseProjectConfig(
        CONFIG.replace(
          "command: [openwrtctl-singbox-config, router, \"{output}\"]",
          "command: [openwrtctl-singbox-config, \"{output}\", \"{output}\"]"
        ),
        "/project/config.yaml"
      ),
    /singbox\.config\.prepare\.command.*exactly one/u
  );
  assert.throws(
    () =>
      parseProjectConfig(
        CONFIG.replace(
          "    prepare:\n      command: [openwrtctl-singbox-config, router, \"{output}\"]\n",
          "    prepare:\n      cwd: .\n"
        ),
        "/project/config.yaml"
      ),
    /singbox\.config\.prepare\.cwd/u
  );
});

test("rejects legacy-only and mixed artifact configuration", () => {
  const legacySingbox = `singboxctl:\n  profile: router\n  ruleSetsDirectory: ./rule-sets`;
  const newSingbox = `singbox:\n  config:\n    path: ~/.config/openwrtctl/generated/sing-box.json\n    prepare:\n      command: [openwrtctl-singbox-config, router, "{output}"]`;

  assert.throws(
    () => parseProjectConfig(CONFIG.replace(newSingbox, legacySingbox), "/project/config.yaml"),
    /singboxctl is not supported/u
  );
  assert.throws(
    () => parseProjectConfig(`${CONFIG}\n${legacySingbox}\n`, "/project/config.yaml"),
    /singboxctl is not supported/u
  );
  assert.throws(
    () =>
      parseProjectConfig(
        CONFIG.replace("adguard:\n", "adguard:\n  rewriteIp: 192.0.2.10\n"),
        "/project/config.yaml"
      ),
    /adguard\.rewriteIp is not supported/u
  );
  assert.throws(
    () =>
      parseProjectConfig(
        CONFIG.replace("singbox:\n", "singbox:\n  ruleSetsDirectory: ./rule-sets\n"),
        "/project/config.yaml"
      ),
    /singbox\.ruleSetsDirectory is not supported/u
  );
});
