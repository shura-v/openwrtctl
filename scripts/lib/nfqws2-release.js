import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { $ } from "zx";
import {
  buildRemoteNfqws2ArchitectureSelection,
  NFQWS2_BINARY_TARGETS
} from "./nfqws2-architecture.js";

export const DEFAULT_NFQWS2_VERSION = "1.0.4";

const PINNED_RELEASE_HASHES = Object.freeze({
  "1.0.4": Object.freeze({
    archiveSha256: "2ac26fef23ec387fbbb34aab2e34290dec0012afccb9453fd8befdeb733ccde3",
    binarySha256ByTarget: Object.freeze({
      arm: "7d379ca5270da83c254e9df5995f71dbea7a2126b5c9632d6f5b802eaecfb3ee",
      arm64: "b2827dcad28c2d3fc567cf7da34fd94832a551cbb492e8ce820ab944814a82c6",
      lexra: "72e2b9bc040e9e4739147d92730363f7b97d438e9e509a01a4a97a8117c9f8f5",
      mips: "4e8fbaae750d3e7fa10081b582996c2fdd01219f55164360f27d13da50b51d74",
      mips64: "30f2984dff5b69dbc258d6a2eab9cfbf61b8a60aba654304add7e6f0bf58ee1b",
      mipsel: "d89af93c5b62fedb4bdadb9c0cd98d0d1998dcdf699076ea5c65f47b64b389ac",
      ppc: "00da87e56cc5b818aa85447bced68b6ede16243cb79bee6d7b255b0998c71c5a",
      riscv64: "8e4ddc0f4b81e03a6c1c76c4025e6d9d66c86325ff2169184adbc60b029f60b4",
      x86: "bca221f7d7b1ff4b77f2f9febcbd4b414ccab6815268009cd7aef2b6871bc7a1",
      x86_64: "58637c7b9d4bcd2dbd34e83244370df553215bc8cf370f738ac5d53e5c154b60"
    })
  })
});

export const NFQWS2_RELEASE = createNfqws2Release(DEFAULT_NFQWS2_VERSION);

export function parseNfqws2VersionArgument(arguments_) {
  if (arguments_.length === 0) {
    return DEFAULT_NFQWS2_VERSION;
  }

  if (arguments_.length !== 1 || !arguments_[0].startsWith("--version=")) {
    throw new Error("usage: --version=<zapret2 release version>");
  }

  return normalizeVersion(arguments_[0].slice("--version=".length));
}

export function createNfqws2Release(version) {
  const normalizedVersion = normalizeVersion(version);
  const archiveName = `zapret2-v${normalizedVersion}-openwrt-embedded.tar.gz`;
  const hashes = PINNED_RELEASE_HASHES[normalizedVersion] ?? {};

  return Object.freeze({
    version: normalizedVersion,
    archiveName,
    archiveSha256: hashes.archiveSha256,
    binarySha256ByTarget: hashes.binarySha256ByTarget ?? Object.freeze({}),
    sourceDirectory: `zapret2-v${normalizedVersion}`,
    url: `https://github.com/bol-van/zapret2/releases/download/v${normalizedVersion}/${archiveName}`
  });
}

export async function prepareNfqws2ReleaseArchive(
  destinationDirectory,
  version = DEFAULT_NFQWS2_VERSION
) {
  const requestedRelease = createNfqws2Release(version);
  await mkdir(destinationDirectory, { recursive: true });
  const archivePath = path.join(destinationDirectory, requestedRelease.archiveName);

  try {
    const release = await inspectReleaseArchive(archivePath, requestedRelease);
    console.log(`Using cached zapret2 archive: ${archivePath}`);
    return { archivePath, release };
  } catch {
    await rm(archivePath, { force: true });
  }

  const candidatePath = `${archivePath}.part`;
  await rm(candidatePath, { force: true });
  const run = $({ verbose: true, stdio: "inherit" });

  try {
    await run`curl --fail --location --retry 3 --proto =https --tlsv1.2 --output ${candidatePath} ${requestedRelease.url}`;
    const release = await inspectReleaseArchive(candidatePath, requestedRelease);
    await rename(candidatePath, archivePath);
    return { archivePath, release };
  } catch (error) {
    await rm(candidatePath, { force: true });
    throw error;
  }
}

export async function ensureNfqws2ReleaseArchive(destinationDirectory) {
  const { archivePath } = await prepareNfqws2ReleaseArchive(destinationDirectory);
  return archivePath;
}

export async function installNfqws2Release(
  remote,
  localArchivePath,
  release = NFQWS2_RELEASE
) {
  const remoteArchivePath = path.posix.join(
    remote.config.openwrt.remoteTmpDir,
    "zapret2-release.tar.gz"
  );
  await remote.push(localArchivePath, remoteArchivePath);

  try {
    await remote.exec(buildRemoteInstallCommand(remoteArchivePath, release));
  } catch (error) {
    throw new Error(
      `nfqws2 install failed; uploaded archive remains at ${remoteArchivePath}: ${errorMessage(error)}`
    );
  }

  try {
    await remote.exec(`rm -f '${remoteArchivePath}'`);
  } catch (error) {
    throw new Error(
      `nfqws2 ${release.version} was installed, but remote cleanup failed for ${remoteArchivePath}: ${errorMessage(error)}`
    );
  }

  return { remoteArchivePath, version: release.version };
}

export function buildRemoteInstallCommand(
  remoteArchivePath,
  release = NFQWS2_RELEASE
) {
  const remoteStagePath = path.posix.join(
    path.posix.dirname(remoteArchivePath),
    "zapret2-install"
  );
  const architectureSelection = buildRemoteNfqws2ArchitectureSelection(release);

  return `
set -eu

archive='${remoteArchivePath}'
stage='${remoteStagePath}'
source_dir="$stage/${release.sourceDirectory}"
target=/opt/zapret2
expected_archive_sha256=${release.archiveSha256}

actual_archive_sha256="$(sha256sum "$archive" | cut -d ' ' -f 1)"
[ "$actual_archive_sha256" = "$expected_archive_sha256" ] || {
  echo "zapret2 archive checksum mismatch" >&2
  exit 1
}

rm -rf "$stage"
mkdir -p "$stage"
tar -xzf "$archive" -C "$stage"
${architectureSelection}
[ -x "$binary_dir/nfqws2" ] || {
  echo "linux-$binary_target/nfqws2 is missing from the release" >&2
  exit 1
}

actual_binary_sha256="$(sha256sum "$binary_dir/nfqws2" | cut -d ' ' -f 1)"
[ "$actual_binary_sha256" = "$expected_binary_sha256" ] || {
  echo "nfqws2 binary checksum mismatch" >&2
  exit 1
}

if [ -e "$target" ]; then
  [ -f "$target/.openwrt-router-tools-version" ] || {
    echo "$target is not managed by openwrt-router-tools" >&2
    exit 1
  }
  [ "$(cat "$target/.openwrt-router-tools-version")" = "${release.version}" ] || {
    echo "another zapret2 version is already installed at $target" >&2
    exit 1
  }
  installed_binary_sha256="$(sha256sum "$target/nfq2/nfqws2" | cut -d ' ' -f 1)"
  [ "$installed_binary_sha256" = "$expected_binary_sha256" ] || {
    echo "installed nfqws2 binary checksum mismatch" >&2
    exit 1
  }
else
  mkdir -p "$source_dir/nfq2" "$source_dir/ip2net" "$source_dir/mdig" \
    "$source_dir/init.d/openwrt/custom.d" "$source_dir/tmp"
  ln -s "../binaries/linux-$binary_target/nfqws2" "$source_dir/nfq2/nfqws2"
  ln -s "../binaries/linux-$binary_target/ip2net" "$source_dir/ip2net/ip2net"
  ln -s "../binaries/linux-$binary_target/mdig" "$source_dir/mdig/mdig"
  cp "$source_dir/config.default" "$source_dir/config"
  touch "$source_dir/ipset/zapret-hosts-user.txt"
  touch "$source_dir/ipset/zapret-hosts-user-ipban.txt"
  cp "$source_dir/ipset/zapret-hosts-user-exclude.txt.default" \
    "$source_dir/ipset/zapret-hosts-user-exclude.txt"
  printf '%s\n' '${release.version}' > \
    "$source_dir/.openwrt-router-tools-version"
  "$source_dir/nfq2/nfqws2" --version
  mkdir -p /opt
  mv "$source_dir" "$target"
fi

"$target/nfq2/nfqws2" --version
init_script="$target/init.d/openwrt/zapret2"
old_luaopt='LUAOPT="--lua-init=@$ZAPRET_BASE/lua/zapret-lib.lua --lua-init=@$ZAPRET_BASE/lua/zapret-antidpi.lua --lua-init=@$ZAPRET_BASE/lua/zapret-auto.lua"'
previous_managed_luaopt='LUAOPT="--lua-init=@$ZAPRET_BASE/lua/zapret-lib.lua --lua-init=@$ZAPRET_BASE/lua/zapret-antidpi.lua"'
managed_luaopt='LUAOPT="--lua-init=@$ZAPRET_BASE/lua/zapret-lib.lua --lua-init=@$ZAPRET_BASE/lua/zapret-antidpi.lua --lua-init=@$ZAPRET_BASE/lua/zapret-auto.lua --blob=quic_initial:@$ZAPRET_BASE/files/fake/quic_initial_www_google_com.bin"'
if grep -Fqx "$old_luaopt" "$init_script" || grep -Fqx "$previous_managed_luaopt" "$init_script"; then
  awk -v old="$old_luaopt" -v previous="$previous_managed_luaopt" -v managed="$managed_luaopt" \
    '{ print ($0 == old || $0 == previous) ? managed : $0 }' "$init_script" > "$init_script.new"
  chmod 0755 "$init_script.new"
  mv -f "$init_script.new" "$init_script"
elif ! grep -Fqx "$managed_luaopt" "$init_script"; then
  echo "unsupported zapret2 OpenWrt init script" >&2
  exit 1
fi
grep -Fqx "$managed_luaopt" "$init_script"
test -f "$target/lua/zapret-auto.lua" -o -f "$target/lua/zapret-auto.lua.gz"
test -f "$target/files/fake/quic_initial_www_google_com.bin"
ln -sfn "$target/init.d/openwrt/zapret2" /etc/init.d/zapret2
ln -sfn "$target/init.d/openwrt/90-zapret2" /etc/hotplug.d/iface/90-zapret2
/etc/init.d/zapret2 disable
/etc/init.d/zapret2 stop
rm -rf "$stage"
`;
}

export async function verifyFileSha256(filePath, expectedSha256) {
  const actualSha256 = await fileSha256(filePath);

  if (actualSha256 !== expectedSha256) {
    throw new Error(
      `SHA-256 mismatch for ${filePath}: expected ${expectedSha256}, got ${actualSha256}`
    );
  }
}

async function fileSha256(filePath) {
  const hash = createHash("sha256");

  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }

  return hash.digest("hex");
}

async function inspectReleaseArchive(archivePath, requestedRelease) {
  const archiveSha256 = await fileSha256(archivePath);
  if (
    requestedRelease.archiveSha256 &&
    archiveSha256 !== requestedRelease.archiveSha256
  ) {
    throw new Error(
      `SHA-256 mismatch for ${archivePath}: expected ${requestedRelease.archiveSha256}, got ${archiveSha256}`
    );
  }

  const inspectionDirectory = await mkdtemp(
    path.join(path.dirname(archivePath), ".nfqws2-inspect-")
  );
  const binariesRelativePath = path.join(
    requestedRelease.sourceDirectory,
    "binaries"
  );
  const run = $({ verbose: false });

  try {
    await run`tar -xzf ${archivePath} -C ${inspectionDirectory} ${binariesRelativePath}`;
    const binarySha256ByTarget = {};
    const binaryDirectory = path.join(inspectionDirectory, binariesRelativePath);
    const entries = await readdir(binaryDirectory, { withFileTypes: true });
    const availableTargets = entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("linux-"))
      .map((entry) => entry.name.slice("linux-".length))
      .filter((target) => NFQWS2_BINARY_TARGETS.includes(target));

    for (const target of availableTargets) {
      const binarySha256 = await fileSha256(
        path.join(binaryDirectory, `linux-${target}/nfqws2`)
      );
      const expectedSha256 = requestedRelease.binarySha256ByTarget[target];
      if (expectedSha256 && binarySha256 !== expectedSha256) {
        throw new Error(
          `SHA-256 mismatch for nfqws2 ${requestedRelease.version} linux-${target}: expected ${expectedSha256}, got ${binarySha256}`
        );
      }
      binarySha256ByTarget[target] = binarySha256;
    }

    for (const target of Object.keys(requestedRelease.binarySha256ByTarget)) {
      if (binarySha256ByTarget[target] === undefined) {
        throw new Error(`nfqws2 ${requestedRelease.version} has no linux-${target} binary`);
      }
    }

    return Object.freeze({
      ...requestedRelease,
      archiveSha256,
      binarySha256ByTarget: Object.freeze(binarySha256ByTarget)
    });
  } finally {
    await rm(inspectionDirectory, { recursive: true, force: true });
  }
}

function normalizeVersion(version) {
  const normalizedVersion = version.startsWith("v") ? version.slice(1) : version;

  if (!/^\d+\.\d+\.\d+$/u.test(normalizedVersion)) {
    throw new Error(`invalid zapret2 release version: ${version || "<empty>"}`);
  }

  return normalizedVersion;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
