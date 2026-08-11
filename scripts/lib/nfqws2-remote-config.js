export async function applyRemoteNfqws2Bundle(remote, paths) {
  await remote.exec(`
set -eu

staged_config='${paths.stagedConfigPath}'
staged_user_list='${paths.stagedUserListPath}'
staged_ipset_list='${paths.stagedIpsetListPath}'
config=/opt/zapret2/config
lists_dir=/etc/nfqws2/lists
user_list="$lists_dir/user.list"
ipset_list="$lists_dir/ipset.list"

sh -n "$staged_config"
. "$staged_config"
init_script=/opt/zapret2/init.d/openwrt/zapret2
grep -Fq 'zapret-lib.lua' "$init_script"
grep -Fq 'zapret-antidpi.lua' "$init_script"
grep -Fq 'zapret-auto.lua' "$init_script"
grep -Fq 'quic_initial_www_google_com.bin' "$init_script"
mkdir -p "$lists_dir"
chmod 0755 /etc/nfqws2 "$lists_dir"
cp "$staged_user_list" "$user_list.new"
cp "$staged_ipset_list" "$ipset_list.new"
cp "$staged_config" "$config.new"
chmod 0644 "$user_list.new" "$ipset_list.new"
chmod 0600 "$config.new"
validation_opt="$(printf '%s\n' "$NFQWS2_OPT" | sed \
  -e "s|${paths.userListPath}|$user_list.new|g" \
  -e "s|${paths.ipsetListPath}|$ipset_list.new|g")"
validate_nfqws2() {
  /opt/zapret2/nfq2/nfqws2 "$1" --qnum=300 --user=daemon \
    --fwmark=0x40000000 \
    --lua-init=@/opt/zapret2/lua/zapret-lib.lua \
    --lua-init=@/opt/zapret2/lua/zapret-antidpi.lua \
    --lua-init=@/opt/zapret2/lua/zapret-auto.lua \
    --blob=quic_initial:@/opt/zapret2/files/fake/quic_initial_www_google_com.bin \
    $validation_opt
}
validate_nfqws2 --dry-run
validate_nfqws2 --intercept=0

mv -f "$user_list.new" "$user_list"
mv -f "$ipset_list.new" "$ipset_list"
mv -f "$config.new" "$config"
/etc/init.d/zapret2 restart || {
  echo "nfqws2 restart failed; managed config and lists remain installed for diagnostics" >&2
  exit 1
}
/etc/init.d/zapret2 enable
rm -f "$staged_config" "$staged_user_list" "$staged_ipset_list"
`);
}
