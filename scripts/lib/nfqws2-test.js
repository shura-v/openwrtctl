import path from "node:path";

const MANAGED_NFQWS2_DIRECTORY = "/opt/zapret2";
const TEST_LOG_NAME = "nfqws2-test.log";

export function getNfqws2TestLogPath(remoteTmpDirectory) {
  return path.posix.join(remoteTmpDirectory, TEST_LOG_NAME);
}

export function buildRemoteNfqws2TestCommand(remoteTmpDirectory, httpsDomains) {
  const logPath = getNfqws2TestLogPath(remoteTmpDirectory);
  const statusPath = `${logPath}.status`;
  const domains = httpsDomains.join(" ");

  return `
set -eu

target='${MANAGED_NFQWS2_DIRECTORY}'
log_file='${logPath}'
status_file='${statusPath}'

[ -f "$target/.openwrt-router-tools-version" ] || {
  echo "managed nfqws2 installation is missing; run install-nfqws2" >&2
  exit 1
}
[ -x "$target/blockcheck2.sh" ] || {
  echo "managed nfqws2 blockcheck2.sh is missing or not executable" >&2
  exit 1
}
[ -x /etc/init.d/zapret2 ] || {
  echo "managed nfqws2 init script is missing" >&2
  exit 1
}

mkdir -p '${remoteTmpDirectory}'
rm -f "$status_file"
was_running=0
/etc/init.d/zapret2 status >/dev/null 2>&1 && was_running=1

restore_nfqws2() {
  test_status=$?
  trap - EXIT HUP INT TERM
  rm -f "$status_file"
  if [ "$was_running" = 1 ]; then
    if ! /etc/init.d/zapret2 start; then
      echo "failed to restore managed nfqws2 after testing" >&2
      [ "$test_status" -ne 0 ] || test_status=1
    fi
  fi
  exit "$test_status"
}

trap restore_nfqws2 EXIT
trap 'exit 130' HUP INT TERM
/etc/init.d/zapret2 stop

cd "$target"
export DOMAINS='${domains}'
export IPVS=4
export BATCH=1
export TEST=standard
export SCANLEVEL=force
export REPEATS=1
export SECURE_DNS=0
export ENABLE_HTTP=0
export ENABLE_HTTPS_TLS12=1
export ENABLE_HTTPS_TLS13=1
export ENABLE_HTTP3=0

(
  set +e
  ./blockcheck2.sh
  blockcheck_status=$?
  printf '%s\\n' "$blockcheck_status" > "$status_file"
  exit "$blockcheck_status"
) 2>&1 | tee "$log_file"

[ -f "$status_file" ] || {
  echo "nfqws2 test did not report its exit status; full log: $log_file" >&2
  exit 1
}
read -r blockcheck_status < "$status_file"
[ "$blockcheck_status" -eq 0 ] || {
  echo "nfqws2 test failed with status $blockcheck_status; full log: $log_file" >&2
  exit "$blockcheck_status"
}
`;
}

export function buildRemoteNfqws2TestResultsCommand(remoteTmpDirectory) {
  const logPath = getNfqws2TestLogPath(remoteTmpDirectory);

  return `
set -eu

log_file='${logPath}'
[ -f "$log_file" ] || {
  echo "nfqws2 test log is missing: $log_file; run test-nfqws2 first" >&2
  exit 1
}

awk '
/^- curl_test_/ {
  strategy=""
}
/^- curl_test_https_tls(12|13) .* : nfqws2 / {
  strategy=$0
}
/!!!!! AVAILABLE !!!!!/ && strategy != "" {
  sub(/^.* : nfqws2 /, "", strategy)
  print strategy
  strategy=""
}
/^UNAVAILABLE/ {
  strategy=""
}
' "$log_file"
`;
}
