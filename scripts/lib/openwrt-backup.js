import { access, chmod, mkdir } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { $ } from "zx";

export async function backupOpenwrt({
  remote,
  remoteTmpDirectory,
  destinationDirectory,
  now = new Date()
}) {
  const timestamp = now.toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const fileName = `openwrt-backup-${timestamp}.tar.gz`;
  const remotePath = path.posix.join(remoteTmpDirectory, fileName);
  const localPath = path.join(destinationDirectory, fileName);

  await mkdir(destinationDirectory, { recursive: true });
  await chmod(destinationDirectory, 0o700);
  await remote.exec(`sysupgrade -b '${remotePath}'`);
  await remote.exec(`tar -tzf '${remotePath}' >/dev/null`);

  try {
    await remote.pull(remotePath, localPath);
    await chmod(localPath, 0o600);
  } catch (error) {
    throw new Error(
      `download failed; backup remains on the router at ${remotePath}: ${errorMessage(error)}`
    );
  }

  try {
    await remote.exec(`rm -f '${remotePath}'`);
  } catch (error) {
    throw new Error(
      `backup was saved to ${localPath}, but remote cleanup failed: ${errorMessage(error)}`
    );
  }

  return { localPath, remotePath };
}

export async function restoreOpenwrt({
  remote,
  archivePath,
  remoteTmpDirectory,
  now = new Date(),
  validateArchive = validateLocalBackupArchive
}) {
  await validateArchive(archivePath);
  const timestamp = now.toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const remotePath = path.posix.join(remoteTmpDirectory, `openwrt-restore-${timestamp}.tar.gz`);
  await remote.push(archivePath, remotePath);

  try {
    await remote.exec(`tar -tzf '${remotePath}' >/dev/null`);
    await remote.exec(`sysupgrade -r '${remotePath}'`);
  } catch (error) {
    throw new Error(`restore failed; uploaded archive remains at ${remotePath}: ${errorMessage(error)}`);
  }

  try {
    await remote.exec(`rm -f '${remotePath}'`);
  } catch (error) {
    throw new Error(
      `configuration was restored, but remote cleanup failed for ${remotePath}: ${errorMessage(error)}`
    );
  }

  return { archivePath, remotePath };
}

export async function validateLocalBackupArchive(archivePath) {
  try {
    await access(archivePath, constants.R_OK);
  } catch {
    throw new Error(`backup archive is not readable: ${archivePath}`);
  }

  let entries;

  try {
    entries = (await $({ quiet: true })`tar -tzf ${archivePath}`).lines();
  } catch (error) {
    throw new Error(`invalid backup archive ${archivePath}: ${errorMessage(error)}`);
  }

  validateArchiveEntries(entries, archivePath);
}

export function validateArchiveEntries(entries, archivePath = "backup archive") {
  if (entries.length === 0) {
    throw new Error(`${archivePath} is empty`);
  }

  for (const entry of entries) {
    if (path.posix.isAbsolute(entry) || entry.split("/").includes("..")) {
      throw new Error(`${archivePath} contains an unsafe path: ${entry}`);
    }
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
