export const SINGBOX_CONFIG_PATH = "/etc/sing-box/config.json";
export const SINGBOX_MARKER_PATH = "/etc/sing-box/.openwrt-router-tools";

export function buildInstallSingBoxCommand() {
  return `
set -eu

apk add sing-box
test -x /usr/bin/sing-box
test -x /etc/init.d/sing-box
mkdir -p /etc/sing-box
printf '%s\n' managed > '${SINGBOX_MARKER_PATH}'
chmod 0600 '${SINGBOX_MARKER_PATH}'
uci set sing-box.main.enabled='0'
uci set sing-box.main.user='root'
uci set sing-box.main.conffile='${SINGBOX_CONFIG_PATH}'
uci commit sing-box
/etc/init.d/sing-box disable
/etc/init.d/sing-box stop
/usr/bin/sing-box version
`;
}

export function buildUpdateSingBoxCommand() {
  return `
set -eu

test -f '${SINGBOX_MARKER_PATH}' || {
  echo "sing-box is not managed by openwrt-router-tools; run install-singbox" >&2
  exit 1
}
apk info -e sing-box >/dev/null 2>&1 || {
  echo "sing-box package is not installed; run install-singbox" >&2
  exit 1
}
test -f '${SINGBOX_CONFIG_PATH}' || {
  echo "managed sing-box config is missing; run sync-singbox" >&2
  exit 1
}

apk update
apk upgrade sing-box
/usr/bin/sing-box version
/usr/bin/sing-box check -c '${SINGBOX_CONFIG_PATH}'

uci set sing-box.main.user='root'
uci set sing-box.main.conffile='${SINGBOX_CONFIG_PATH}'
uci commit sing-box
if [ "$(uci -q get sing-box.main.enabled || true)" = "1" ]; then
  /etc/init.d/sing-box restart
  /etc/init.d/sing-box enable
else
  /etc/init.d/sing-box disable
  /etc/init.d/sing-box stop
fi
`;
}

export function buildDisableSingBoxCommand() {
  return `
set -eu

test -f '${SINGBOX_MARKER_PATH}' || {
  echo "sing-box is not managed by openwrt-router-tools" >&2
  exit 1
}
apk info -e sing-box >/dev/null 2>&1 || {
  echo "sing-box package is not installed" >&2
  exit 1
}

uci set sing-box.main.enabled='0'
uci commit sing-box
/etc/init.d/sing-box stop || true
/etc/init.d/sing-box disable
`;
}

export function buildUninstallSingBoxCommand(remoteTmpDirectory) {
  return `
set -eu

installed=0
apk info -e sing-box >/dev/null 2>&1 && installed=1
if [ "$installed" = 1 ] || [ -e /etc/sing-box ] || [ -e /etc/config/sing-box ]; then
  test -f '${SINGBOX_MARKER_PATH}' || {
    echo "sing-box installation is not managed by openwrt-router-tools" >&2
    exit 1
  }
fi

if [ -x /etc/init.d/sing-box ]; then
  uci -q set sing-box.main.enabled='0' || true
  uci -q commit sing-box || true
  /etc/init.d/sing-box disable
  /etc/init.d/sing-box stop
fi

if [ "$installed" = 1 ]; then
  apk del --purge sing-box
fi

rm -rf /etc/sing-box
rm -f /etc/config/sing-box '${remoteTmpDirectory}/sing-box.json'
`;
}

export async function applyRemoteSingBoxConfig(remote, stagedConfigPath) {
  await remote.exec(`
set -eu

test -f '${SINGBOX_MARKER_PATH}' || {
  echo "sing-box is not managed by openwrt-router-tools; run install-singbox" >&2
  exit 1
}
apk info -e sing-box >/dev/null 2>&1 || {
  echo "sing-box package is not installed; run install-singbox" >&2
  exit 1
}

candidate='${SINGBOX_CONFIG_PATH}.new'
trap 'rm -f "$candidate"' EXIT
cp '${stagedConfigPath}' "$candidate"
chmod 0600 "$candidate"
/usr/bin/sing-box check -c "$candidate"
mv -f "$candidate" '${SINGBOX_CONFIG_PATH}'

uci set sing-box.main.enabled='1'
uci set sing-box.main.user='root'
uci set sing-box.main.conffile='${SINGBOX_CONFIG_PATH}'
uci commit sing-box
/etc/init.d/sing-box enable
/etc/init.d/sing-box restart || {
  echo "sing-box restart failed; managed config remains installed for diagnostics" >&2
  exit 1
}
rm -f '${stagedConfigPath}'
`);
}
