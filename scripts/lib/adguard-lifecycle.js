export function buildUninstallAdguardCommand(remoteTmpDirectory) {
  return `
set -eu

if [ -x /etc/init.d/adguardhome ]; then
  /etc/init.d/adguardhome disable
  /etc/init.d/adguardhome stop
fi

uci set dhcp.@dnsmasq[0].port="53"
uci commit dhcp
/etc/init.d/dnsmasq restart

if apk info -e adguardhome >/dev/null 2>&1; then
  apk del --purge adguardhome
fi

rm -rf /etc/adguardhome
rm -f '${remoteTmpDirectory}/adguardhome.yaml'
`;
}
