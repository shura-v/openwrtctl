import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  generateNfqws2Bundle,
  parseNfqws2Resources,
  patchNfqws2Config
} from "./nfqws2-config.js";

const SOURCE_CONFIG = `
NFQWS2_ENABLE=0
NFQWS2_PORTS_TCP=80,443
NFQWS2_PORTS_UDP=443
NFQWS2_PORTS_UDP_KEEPALIVE=443
NFQWS2_UDP_PKT_OUT=5
NFQWS2_UDP_PKT_IN=3
NFQWS2_OPT="
--filter-tcp=80 --lua-desync=pass --new
--filter-udp=443 --filter-l7=quic --payload=quic_initial
"
MODE_FILTER=none
INIT_APPLY_FW=1
DISABLE_IPV6=1
FILTER_TTL_EXPIRED_ICMP=1
`;

const NFQWS2 = {
  filter: {
    tcp: ["443", "80", "1984", "5222"],
    udp: ["590-600", "1400", "3478-3481", "5349"]
  },
  filterL7: {
    tcp: ["http", "tls", "mtproto"],
    udp: ["wireguard", "stun", "discord", "mtproto", "unknown"]
  },
  strategy: {
    http: "--payload=http_req\n--lua-desync=http_methodeol:badsum",
    https: "--payload=tls_client_hello\n--lua-desync=multidisorder:pos=midsld",
    udp: [
      "--out-range=<n2",
      "--payload=wireguard_initiation,stun,discord_ip_discovery,unknown",
      "--lua-desync=circular:fails=2:time=300:retrans=3:nld=2",
      "--lua-desync=fake:repeats=6:strategy=1",
      "--lua-desync=fake:blob=quic_initial:repeats=6:strategy=2"
    ].join("\n")
  }
};

test("parses independent nfqws2 resource manifests", () => {
  assert.deepEqual(parseNfqws2Resources(`
userList:
  - ^a.example
  - z.example
ipsetList:
  - 192.0.2.0/24
  - 2001:db8::/32
`), {
    userList: ["^a.example", "z.example"],
    ipsetList: ["192.0.2.0/24", "2001:db8::/32"]
  });
  assert.deepEqual(parseNfqws2Resources("userList: []\nipsetList: []\n"), {
    userList: [],
    ipsetList: []
  });
  assert.deepEqual(parseNfqws2Resources(Buffer.from("userList: []\nipsetList: []\n")), {
    userList: [],
    ipsetList: []
  });
});

test("rejects malformed nfqws2 resource manifests", () => {
  assert.throws(
    () => parseNfqws2Resources("- example.com\n"),
    /top-level YAML mapping/u
  );
  assert.throws(
    () => parseNfqws2Resources("userList: example.com\nipsetList: []\n"),
    /resources\.userList must be an array/u
  );
  assert.throws(
    () => parseNfqws2Resources("userList: [example.com]\nipsetList: [42]\n"),
    /resources\.ipsetList\[0\]/u
  );
  assert.throws(
    () => parseNfqws2Resources("userList: []\nipsetList: []\nipsets: []\n"),
    /unsupported field "ipsets"/u
  );
  assert.throws(
    () => parseNfqws2Resources("userList:\n  - |\n    example.com\n    injected.example\nipsetList: []\n"),
    /resources\.userList\[0\]/u
  );
});

test("patches the official config into repeatable managed TCP and UDP profiles", () => {
  const first = patchNfqws2Config(SOURCE_CONFIG, NFQWS2, {
    remoteTmpDirectory: "/root/tmp",
    hasDomains: true,
    hasIpsets: true
  });
  const second = patchNfqws2Config(first, NFQWS2, {
    remoteTmpDirectory: "/root/tmp",
    hasDomains: true,
    hasIpsets: true
  });

  assert.equal(second, first);
  assert.match(first, /^NFQWS2_ENABLE=1$/mu);
  assert.match(first, /^NFQWS2_PORTS_TCP=443,80,1984,5222$/mu);
  assert.match(first, /^NFQWS2_PORTS_UDP=590-600,1400,3478-3481,5349$/mu);
  assert.match(first, /^NFQWS2_PORTS_UDP_KEEPALIVE=$/mu);
  assert.match(first, /^NFQWS2_UDP_PKT_OUT=5$/mu);
  assert.match(first, /^NFQWS2_UDP_PKT_IN=3$/mu);
  assert.match(first, /^DISABLE_IPV6=0$/mu);
  assert.match(first, /^FILTER_TTL_EXPIRED_ICMP=0$/mu);
  assert.match(first, /--hostlist=\/etc\/nfqws2\/lists\/user\.list/u);
  assert.match(first, /--ipset=\/etc\/nfqws2\/lists\/ipset\.list/u);
  assert.equal(first.match(/^--new$/gmu)?.length, 2);
  assert.ok(first.indexOf("--ipset=") < first.indexOf("--new"));
  assert.ok(first.indexOf("--new") < first.indexOf("--hostlist="));
  assert.match(first, /--filter-udp=590-600,1400,3478-3481,5349/u);
  assert.match(first, /--filter-tcp=443,80,1984,5222 --filter-l7=http,tls,mtproto/u);
  assert.match(first, /--filter-udp=[^\n]+ --filter-l7=wireguard,stun,discord,mtproto,unknown/u);
  assert.doesNotMatch(first, /--filter-tcp=[^\n]+ --filter-l7=[^\n]*wireguard/u);
  assert.match(first, /--lua-desync=circular:fails=2:time=300:retrans=3:nld=2/u);
  assert.match(first, /--lua-desync=fake:blob=quic_initial:repeats=6:strategy=2/u);
  assert.equal(first.match(/^TMPDIR=/gmu)?.length, 1);
  assert.equal(first.match(/^FWTYPE=/gmu)?.length, 1);
  assert.equal(first.match(/^GETLIST=/gmu)?.length, 1);
  assert.doesNotMatch(first, /--filter-l7=[^\n]*quic/u);
  assert.doesNotMatch(first, /zapret-auto|tls_clienthello\.bin/u);
});

test("skips TCP profiles when both generated lists are empty", () => {
  const empty = patchNfqws2Config(SOURCE_CONFIG, NFQWS2, {
    remoteTmpDirectory: "/root/tmp",
    hasDomains: false,
    hasIpsets: false
  });

  assert.match(empty, /^NFQWS2_ENABLE=1$/mu);
  assert.match(empty, /^NFQWS2_PORTS_TCP=$/mu);
  assert.doesNotMatch(empty, /--hostlist=|--ipset=|--filter-tcp=/u);
  assert.match(empty, /--filter-udp=/u);
});

test("rejects filters inside strategy fields", () => {
  assert.throws(
    () => patchNfqws2Config(SOURCE_CONFIG, {
      ...NFQWS2,
      strategy: { ...NFQWS2.strategy, udp: "--filter-udp=443" }
    }, {
      remoteTmpDirectory: "/root/tmp",
      hasDomains: true,
      hasIpsets: true
    }),
    /must contain only strategy arguments/u
  );
});

test("generates config and lists from an already parsed resource snapshot", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "nfqws2-config-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, "source.conf"), SOURCE_CONFIG);

  await generateNfqws2Bundle({
    sourceConfigPath: path.join(directory, "source.conf"),
    nfqws2: NFQWS2,
    resources: parseNfqws2Resources(`
userList:
  - dns.example
  - plain.example
ipsetList:
  - 2001:db8::/32
`),
    remoteTmpDirectory: "/root/tmp",
    outputConfigPath: path.join(directory, "patched.conf"),
    outputUserListPath: path.join(directory, "user.list"),
    outputIpsetListPath: path.join(directory, "ipset.list")
  });

  assert.match(await readFile(path.join(directory, "patched.conf"), "utf8"), /^NFQWS2_ENABLE=1$/mu);
  assert.equal(
    await readFile(path.join(directory, "user.list"), "utf8"),
    "dns.example\nplain.example\n"
  );
  assert.equal(await readFile(path.join(directory, "ipset.list"), "utf8"), "2001:db8::/32\n");
});
