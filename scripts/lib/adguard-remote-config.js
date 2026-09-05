export async function applyRemoteConfig(remote, stagedPath, configPath) {
  const candidatePath = `${configPath}.new`;

  await remote.exec(`
set -eu
candidate='${candidatePath}'
trap 'rm -f "$candidate"' EXIT
cp '${stagedPath}' "$candidate"
chmod 600 "$candidate"
AdGuardHome --check-config -c "$candidate"
mv -f "$candidate" '${configPath}'
/etc/init.d/adguardhome restart
rm -f '${stagedPath}'
`);
}

export async function restoreRemoteConfig(remote, rollbackPath, stagedPath, configPath, applyError) {
  console.error(
    `AdGuard Home apply failed; restoring previous configuration from temporary rollback file: ${rollbackPath}`
  );

  try {
    await remote.push(rollbackPath, stagedPath);
    await remote.exec(`AdGuardHome --check-config -c '${stagedPath}'`);
    await applyRemoteConfig(remote, stagedPath, configPath);
  } catch (restoreError) {
    throw new Error(
      `apply failed (${errorMessage(applyError)}); restore from temporary rollback file ${rollbackPath} also failed: ${errorMessage(restoreError)}`
    );
  }

  throw new Error(
    `apply failed and previous configuration from temporary rollback file ${rollbackPath} was restored: ${errorMessage(applyError)}`
  );
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
