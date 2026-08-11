import path from "node:path";
import { NFQWS2_RELEASE } from "./nfqws2-release.js";

export async function updateNfqws2Release(
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
    await remote.exec(buildRemoteUpdateCommand(remoteArchivePath, release));
  } catch (error) {
    throw new Error(
      `nfqws2 update failed; uploaded archive and update stage remain under ${remote.config.openwrt.remoteTmpDir}: ${errorMessage(error)}`
    );
  }

  await remote.exec(`rm -f '${remoteArchivePath}'`);
  return { version: release.version };
}

export function buildRemoteUpdateCommand(
  remoteArchivePath,
  release = NFQWS2_RELEASE
) {
  const remoteStagePath = path.posix.join(
    path.posix.dirname(remoteArchivePath),
    "zapret2-update"
  );

  return `
set -eu

archive='${remoteArchivePath}'
stage='${remoteStagePath}'
source_dir="$stage/${release.sourceDirectory}"
previous="$stage/previous"
failed="$stage/failed"
target=/opt/zapret2
expected_archive_sha256=${release.archiveSha256}
expected_binary_sha256=${release.binarySha256}

[ -f "$target/.openwrt-router-tools-version" ] || {
  echo "managed nfqws2 installation is missing; run install-nfqws2" >&2
  exit 1
}

actual_archive_sha256="$(sha256sum "$archive" | cut -d ' ' -f 1)"
[ "$actual_archive_sha256" = "$expected_archive_sha256" ] || {
  echo "zapret2 archive checksum mismatch" >&2
  exit 1
}
[ "$(uname -m)" = "aarch64" ] || {
  echo "unsupported router architecture: $(uname -m)" >&2
  exit 1
}

rm -rf "$stage"
mkdir -p "$stage"
tar -xzf "$archive" -C "$stage"
[ -x "$source_dir/binaries/linux-arm64/nfqws2" ] || {
  echo "linux-arm64/nfqws2 is missing from the release" >&2
  exit 1
}
actual_binary_sha256="$(sha256sum "$source_dir/binaries/linux-arm64/nfqws2" | cut -d ' ' -f 1)"
[ "$actual_binary_sha256" = "$expected_binary_sha256" ] || {
  echo "nfqws2 binary checksum mismatch" >&2
  exit 1
}

mkdir -p "$source_dir/nfq2" "$source_dir/ip2net" "$source_dir/mdig" \
  "$source_dir/init.d/openwrt/custom.d" "$source_dir/tmp"
ln -s ../binaries/linux-arm64/nfqws2 "$source_dir/nfq2/nfqws2"
ln -s ../binaries/linux-arm64/ip2net "$source_dir/ip2net/ip2net"
ln -s ../binaries/linux-arm64/mdig "$source_dir/mdig/mdig"
cp "$target/config" "$source_dir/config"
touch "$source_dir/ipset/zapret-hosts-user.txt"
touch "$source_dir/ipset/zapret-hosts-user-ipban.txt"
cp "$source_dir/ipset/zapret-hosts-user-exclude.txt.default" \
  "$source_dir/ipset/zapret-hosts-user-exclude.txt"
printf '%s\n' '${release.version}' > \
  "$source_dir/.openwrt-router-tools-version"

init_script="$source_dir/init.d/openwrt/zapret2"
old_luaopt='LUAOPT="--lua-init=@$ZAPRET_BASE/lua/zapret-lib.lua --lua-init=@$ZAPRET_BASE/lua/zapret-antidpi.lua --lua-init=@$ZAPRET_BASE/lua/zapret-auto.lua"'
managed_luaopt='LUAOPT="--lua-init=@$ZAPRET_BASE/lua/zapret-lib.lua --lua-init=@$ZAPRET_BASE/lua/zapret-antidpi.lua --lua-init=@$ZAPRET_BASE/lua/zapret-auto.lua --blob=quic_initial:@$ZAPRET_BASE/files/fake/quic_initial_www_google_com.bin"'
grep -Fqx "$old_luaopt" "$init_script" || {
  echo "unsupported zapret2 OpenWrt init script" >&2
  exit 1
}
awk -v old="$old_luaopt" -v managed="$managed_luaopt" \
  '{ print $0 == old ? managed : $0 }' "$init_script" > "$init_script.new"
chmod 0755 "$init_script.new"
mv -f "$init_script.new" "$init_script"
grep -Fqx "$managed_luaopt" "$init_script"

. "$source_dir/config"
if [ "$NFQWS2_ENABLE" = 1 ]; then
  "$source_dir/nfq2/nfqws2" --dry-run --qnum=300 --user=root \
    --fwmark=0x40000000 \
    --lua-init=@"$source_dir/lua/zapret-lib.lua" \
    --lua-init=@"$source_dir/lua/zapret-antidpi.lua" \
    --lua-init=@"$source_dir/lua/zapret-auto.lua" \
    --blob=quic_initial:@"$source_dir/files/fake/quic_initial_www_google_com.bin" \
    $NFQWS2_OPT
fi

was_enabled=0
/etc/init.d/zapret2 enabled && was_enabled=1
/etc/init.d/zapret2 stop
mv "$target" "$previous"
mv "$source_dir" "$target"
ln -sfn "$target/init.d/openwrt/zapret2" /etc/init.d/zapret2
ln -sfn "$target/init.d/openwrt/90-zapret2" /etc/hotplug.d/iface/90-zapret2

if [ "$was_enabled" = 1 ]; then
  if ! /etc/init.d/zapret2 restart; then
    mv "$target" "$failed"
    mv "$previous" "$target"
    /etc/init.d/zapret2 restart
    echo "nfqws2 update failed; previous version restored, failed target remains at $failed" >&2
    exit 1
  fi
  /etc/init.d/zapret2 enable
else
  /etc/init.d/zapret2 disable
  /etc/init.d/zapret2 stop
fi

rm -rf "$stage"
`;
}

export function buildRemoteUninstallCommand(remoteTmpDirectory) {
  return `
set -eu

target=/opt/zapret2
if [ -e "$target" ]; then
  [ -f "$target/.openwrt-router-tools-version" ] || {
    echo "$target is not managed by openwrt-router-tools" >&2
    exit 1
  }
  /etc/init.d/zapret2 disable
  /etc/init.d/zapret2 stop
  rm -rf "$target"
fi

rm -rf /etc/nfqws2

if [ "$(readlink /etc/init.d/zapret2 2>/dev/null || true)" = "/opt/zapret2/init.d/openwrt/zapret2" ]; then
  rm -f /etc/init.d/zapret2
fi
if [ "$(readlink /etc/hotplug.d/iface/90-zapret2 2>/dev/null || true)" = "/opt/zapret2/init.d/openwrt/90-zapret2" ]; then
  rm -f /etc/hotplug.d/iface/90-zapret2
fi

nft delete table inet zapret2 2>/dev/null || true
rm -f '${remoteTmpDirectory}/zapret2-release.tar.gz' \
  '${remoteTmpDirectory}/nfqws2.conf' \
  '${remoteTmpDirectory}/nfqws2-user.list' \
  '${remoteTmpDirectory}/nfqws2-ipset.list'
rm -rf '${remoteTmpDirectory}/zapret2-install' \
  '${remoteTmpDirectory}/zapret2-update'
`;
}

export function buildRemoteDisableCommand() {
  return `
set -eu

target=/opt/zapret2
[ -f "$target/.openwrt-router-tools-version" ] || {
  echo "managed nfqws2 installation is missing" >&2
  exit 1
}
[ -f "$target/config" ] || {
  echo "managed nfqws2 config is missing" >&2
  exit 1
}

/etc/init.d/zapret2 stop || true
/etc/init.d/zapret2 disable
sed -i 's/^NFQWS2_ENABLE=.*/NFQWS2_ENABLE=0/' "$target/config"
grep -qx 'NFQWS2_ENABLE=0' "$target/config"
nft delete table inet zapret2 2>/dev/null || true
`;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
