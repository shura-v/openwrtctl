import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { $ } from "zx";
import {
  buildRemoteInstallCommand,
  createNfqws2Release,
  installNfqws2Release,
  NFQWS2_RELEASE,
  parseNfqws2VersionArgument,
  prepareNfqws2ReleaseArchive,
  verifyFileSha256
} from "./lib/nfqws2-release.js";

test("parses an optional zapret2 release version", () => {
  assert.equal(parseNfqws2VersionArgument([]), "1.0.4");
  assert.equal(parseNfqws2VersionArgument(["--version=1.0.3"]), "1.0.3");
  assert.equal(parseNfqws2VersionArgument(["--version=v1.0.3"]), "1.0.3");
  assert.throws(
    () => parseNfqws2VersionArgument(["--version=latest"]),
    /invalid zapret2 release version/u
  );
  assert.throws(
    () => parseNfqws2VersionArgument(["--force"]),
    /usage: --version/u
  );
});

test("builds the GitHub asset descriptor for a concrete version", () => {
  const release = createNfqws2Release("1.0.3");

  assert.equal(release.archiveName, "zapret2-v1.0.3-openwrt-embedded.tar.gz");
  assert.equal(release.sourceDirectory, "zapret2-v1.0.3");
  assert.equal(
    release.url,
    "https://github.com/bol-van/zapret2/releases/download/v1.0.3/zapret2-v1.0.3-openwrt-embedded.tar.gz"
  );
});

test("derives transfer checksums from a cached concrete release", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "nfqws2-version-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const release = createNfqws2Release("1.0.3");
  const sourceDirectory = path.join(directory, release.sourceDirectory);
  const binaryDirectory = path.join(sourceDirectory, "binaries/linux-arm64");
  await mkdir(binaryDirectory, { recursive: true });
  await writeFile(path.join(binaryDirectory, "nfqws2"), "test binary", "utf8");
  const archivePath = path.join(directory, release.archiveName);
  const run = $({ verbose: false });
  await run`tar -czf ${archivePath} -C ${directory} ${release.sourceDirectory}`;
  await rm(sourceDirectory, { recursive: true, force: true });

  const prepared = await prepareNfqws2ReleaseArchive(directory, "1.0.3");

  assert.equal(prepared.archivePath, archivePath);
  assert.match(prepared.release.archiveSha256, /^[a-f0-9]{64}$/u);
  assert.equal(
    prepared.release.binarySha256ByTarget.arm64,
    "a8b077366207a4f60b23396338f9e2d65007c87d49e7bcc1f8f7d18db947d085"
  );
});

test("verifies local release files with SHA-256", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "nfqws2-release-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "archive.tar.gz");
  await writeFile(filePath, "zapret2", "utf8");

  await verifyFileSha256(
    filePath,
    "a9690b2dd36a0169f9025dc9327e861243bc82bde288cdedc400ff01b4569fb7"
  );
  await assert.rejects(
    verifyFileSha256(filePath, "0".repeat(64)),
    /SHA-256 mismatch/u
  );
});

test("stages the release in RAM before running the router installer", async () => {
  const calls = [];
  const remote = {
    config: { openwrt: { remoteTmpDir: "/root/tmp" } },
    push: async (source, destination) => calls.push(["push", source, destination]),
    exec: async (command) => calls.push(["exec", command])
  };

  await installNfqws2Release(remote, "/local/zapret2.tar.gz");

  const remoteArchivePath = "/tmp/openwrtctl-zapret2-release.tar.gz";
  assert.deepEqual(calls[0], ["push", "/local/zapret2.tar.gz", remoteArchivePath]);
  assert.match(calls[1][1], /tar -xzf "\$archive"/u);
  assert.match(calls[1][1], /trap cleanup EXIT/u);
  assert.doesNotMatch(calls[1][1], /github\.com|\bcurl\b/u);
  assert.equal(calls.length, 2);
});

test("selects the zapret2 binary from the OpenWrt architecture", () => {
  const command = buildRemoteInstallCommand("/root/tmp/zapret2.tar.gz");
  const markerIndex = command.indexOf('"$source_dir/.openwrt-router-tools-version"');
  const moveIndex = command.indexOf('mv "$source_dir" "$target"');

  assert.match(command, /openwrt_arch="\$\(apk --print-arch\)"/u);
  assert.match(command, /aarch64\*\) binary_target=arm64/u);
  assert.match(command, /x86_64\*\) binary_target=x86_64/u);
  assert.match(command, /mipsel\*\) binary_target=mipsel/u);
  assert.match(command, /binaries\/linux-\$binary_target/u);
  assert.match(
    command,
    /for binary_path in "\$source_dir"\/binaries\/linux-\*; do[\s\S]*rm -rf "\$binary_path"/u
  );
  assert.match(command, new RegExp(NFQWS2_RELEASE.binarySha256ByTarget.arm64, "u"));
  assert.match(
    command,
    /cp "\$source_dir\/config\.default" "\$source_dir\/config"/u
  );
  assert.ok(markerIndex >= 0 && markerIndex < moveIndex);
  assert.doesNotMatch(command, /NFQWS2_PORTS_UDP=|filter-udp/u);
});

test("keeps zapret2 disabled until sync applies its managed config", () => {
  const command = buildRemoteInstallCommand("/root/tmp/zapret2.tar.gz");

  assert.match(command, /\/etc\/init\.d\/zapret2 disable/u);
  assert.match(command, /\/etc\/init\.d\/zapret2 stop/u);
  assert.doesNotMatch(command, /\/etc\/init\.d\/zapret2 (?:enable|start|restart)/u);
});

test("loads the Lua libraries and fake blob required by the managed strategies", () => {
  const command = buildRemoteInstallCommand("/root/tmp/zapret2.tar.gz");

  assert.match(
    command,
    /managed_luaopt=.*zapret-lib\.lua.*zapret-antidpi\.lua.*zapret-auto\.lua/u
  );
  assert.match(
    command,
    /managed_luaopt=.*--blob=quic_initial:@\$ZAPRET_BASE\/files\/fake\/quic_initial_www_google_com\.bin/u
  );
  assert.match(command, /unsupported zapret2 OpenWrt init script/u);
});

test("installs the explicitly selected release", () => {
  const release = {
    ...createNfqws2Release("1.0.3"),
    archiveSha256: "a".repeat(64),
    binarySha256ByTarget: { arm64: "b".repeat(64) }
  };
  const command = buildRemoteInstallCommand(
    "/root/tmp/zapret2-release.tar.gz",
    release
  );

  assert.match(command, /zapret2-v1\.0\.3/u);
  assert.match(command, /openwrt-router-tools-version/u);
  assert.match(command, new RegExp("a".repeat(64), "u"));
  assert.match(command, new RegExp("b".repeat(64), "u"));
});
