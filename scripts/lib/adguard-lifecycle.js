const DEFAULT_RESOLV_FILE = "/tmp/resolv.conf.d/resolv.conf.auto";
const WAIT_FOR_TCP_SERVICE = `
wait_for_tcp_service() {
  service="$1"
  port="$2"
  attempts=10

  while [ "$attempts" -gt 0 ]; do
    if "/etc/init.d/$service" running >/dev/null 2>&1 \
      && ncat -z -w 1 127.0.0.1 "$port" >/dev/null 2>&1; then
      return 0
    fi

    attempts=$((attempts - 1))
    if [ "$attempts" -gt 0 ]; then
      sleep 1
    fi
  done

  echo "openwrt: $service did not become ready on port $port" >&2
  return 1
}
`;

export function buildConfigureDnsmasqCommand(remoteTmpDirectory, dnsPort) {
  const normalizedDnsPort = validateDnsPort(dnsPort);

  return `
set -eu

${WAIT_FOR_TCP_SERVICE}
managed_server='127.0.0.1#${normalizedDnsPort}'
default_resolv_file='${DEFAULT_RESOLV_FILE}'
backup='${remoteTmpDirectory}/dhcp.before-adguard-sync'
current_noresolv="$(uci -q get dhcp.@dnsmasq[0].noresolv || true)"
current_resolv_file="$(uci -q get dhcp.@dnsmasq[0].resolvfile || true)"
current_server="$(uci -q get dhcp.@dnsmasq[0].server || true)"

if [ "$current_server" = "$managed_server" ] && [ "$current_noresolv" = "1" ]; then
  :
elif [ -z "$current_server" ] \
  && { [ -z "$current_noresolv" ] || [ "$current_noresolv" = "0" ]; } \
  && { [ -z "$current_resolv_file" ] || [ "$current_resolv_file" = "$default_resolv_file" ]; }; then
  :
else
  echo "openwrt: dnsmasq has custom upstream settings; refusing to replace them with $managed_server" >&2
  exit 1
fi

wait_for_tcp_service adguardhome '${normalizedDnsPort}'
mkdir -p '${remoteTmpDirectory}'
cp /etc/config/dhcp "$backup"

restore_dnsmasq() {
  status=$?
  trap - EXIT
  if [ "$status" -ne 0 ]; then
    cp "$backup" /etc/config/dhcp
    /etc/init.d/dnsmasq restart || true
  fi
  rm -f "$backup"
  exit "$status"
}
trap restore_dnsmasq EXIT

uci set dhcp.@dnsmasq[0].noresolv='1'
uci -q delete dhcp.@dnsmasq[0].resolvfile || true
uci -q delete dhcp.@dnsmasq[0].server || true
uci add_list dhcp.@dnsmasq[0].server="$managed_server"
uci commit dhcp
/etc/init.d/dnsmasq restart
wait_for_tcp_service dnsmasq '53'

trap - EXIT
rm -f "$backup"
`;
}

export function buildUninstallAdguardCommand(remoteTmpDirectory, dnsPort) {
  const normalizedDnsPort = validateDnsPort(dnsPort);

  return `
set -eu

${WAIT_FOR_TCP_SERVICE}
managed_server='127.0.0.1#${normalizedDnsPort}'
backup='${remoteTmpDirectory}/dhcp.before-adguard-uninstall'
current_noresolv="$(uci -q get dhcp.@dnsmasq[0].noresolv || true)"
current_server="$(uci -q get dhcp.@dnsmasq[0].server || true)"

if [ "$current_server" = "$managed_server" ] && [ "$current_noresolv" = "1" ]; then
  mkdir -p '${remoteTmpDirectory}'
  cp /etc/config/dhcp "$backup"

  restore_dnsmasq() {
    status=$?
    trap - EXIT
    if [ "$status" -ne 0 ]; then
      cp "$backup" /etc/config/dhcp
      /etc/init.d/dnsmasq restart || true
    fi
    rm -f "$backup"
    exit "$status"
  }
  trap restore_dnsmasq EXIT

  uci -q delete dhcp.@dnsmasq[0].noresolv || true
  uci -q delete dhcp.@dnsmasq[0].server || true
  uci set dhcp.@dnsmasq[0].resolvfile='${DEFAULT_RESOLV_FILE}'
  uci commit dhcp
  /etc/init.d/dnsmasq restart
  wait_for_tcp_service dnsmasq '53'

  trap - EXIT
  rm -f "$backup"
else
  case " $current_server " in
    *" $managed_server "*)
      echo "openwrt: dnsmasq still references $managed_server together with custom settings; refusing to remove AdGuard Home" >&2
      exit 1
      ;;
  esac
fi

if [ -x /etc/init.d/adguardhome ]; then
  /etc/init.d/adguardhome disable
  /etc/init.d/adguardhome stop
fi

if apk info -e adguardhome >/dev/null 2>&1; then
  apk del --purge adguardhome
fi

rm -rf /etc/adguardhome
rm -f '${remoteTmpDirectory}/adguardhome.yaml' \
  '${remoteTmpDirectory}/dhcp.before-adguard-sync' \
  '${remoteTmpDirectory}/dhcp.before-adguard-uninstall'
`;
}

function validateDnsPort(dnsPort) {
  const normalizedDnsPort = String(dnsPort);

  if (
    !/^\d+$/u.test(normalizedDnsPort) ||
    Number(normalizedDnsPort) < 1 ||
    Number(normalizedDnsPort) > 65535
  ) {
    throw new Error(`AdGuard Home DNS port must be an integer from 1 to 65535: ${JSON.stringify(dnsPort)}`);
  }

  return normalizedDnsPort;
}
