export function buildDoctorCommand() {
  return String.raw`
model="$(cat /tmp/sysinfo/model 2>/dev/null || echo unknown)"
release="$(. /etc/openwrt_release 2>/dev/null; echo "$DISTRIB_DESCRIPTION")"
[ -n "$release" ] || release=unknown
uptime_seconds="$(cut -d. -f1 /proc/uptime)"
uptime_days=$((uptime_seconds / 86400))
uptime_hours=$(((uptime_seconds % 86400) / 3600))
uptime_minutes=$(((uptime_seconds % 3600) / 60))

printf 'Router\n'
printf '  Model: %s\n' "$model"
printf '  OpenWrt: %s\n' "$release"
printf '  Uptime: %dd %dh %dm\n' "$uptime_days" "$uptime_hours" "$uptime_minutes"

printf '\nStorage\n'
mount | awk '$3 == "/overlay" { printf "  Overlay: %s (%s)\n", $1, $5 }'
df -h /overlay | awk 'NR == 2 { printf "  Free: %s / %s (%s used)\n", $4, $2, $5 }'

printf '\nServices\n'
for service in adguardhome sing-box zapret2; do
  if [ ! -x "/etc/init.d/$service" ]; then
    printf '  %s: not installed\n' "$service"
  elif "/etc/init.d/$service" running >/dev/null 2>&1; then
    printf '  %s: running\n' "$service"
  else
    printf '  %s: stopped\n' "$service"
  fi
done
`;
}
