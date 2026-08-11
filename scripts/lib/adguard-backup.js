import { chmod, copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

export async function createLocalAdguardBackup(sourcePath, backupsRoot, now = new Date()) {
  const backupDirectory = path.join(backupsRoot, "adguard");
  const timestamp = now.toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const backupPath = path.join(backupDirectory, `adguardhome-${timestamp}.yaml`);

  await mkdir(backupDirectory, { recursive: true });
  await chmod(backupDirectory, 0o700);
  await copyFile(sourcePath, backupPath);
  await chmod(backupPath, 0o600);

  return backupPath;
}
