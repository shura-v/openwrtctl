import { constants } from "node:fs";
import { chmod, copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { CONFIG_DIRECTORY, CONFIG_PATH } from "./lib/config-path.js";

export { CONFIG_DIRECTORY, CONFIG_PATH };
const TEMPLATE_PATH = fileURLToPath(
  new URL("../config.example.yaml", import.meta.url)
);

export async function initConfig({
  configDirectory = CONFIG_DIRECTORY,
  configPath = CONFIG_PATH,
  templatePath = TEMPLATE_PATH
} = {}) {
  await mkdir(configDirectory, { recursive: true });

  try {
    await copyFile(templatePath, configPath, constants.COPYFILE_EXCL);
    await chmod(configPath, 0o600);
    return { created: true, configPath };
  } catch (error) {
    if (error && typeof error === "object" && error.code === "EEXIST") {
      return { created: false, configPath };
    }

    throw error;
  }
}

async function main() {
  const result = await initConfig();
  console.log(
    result.created
      ? `Created ${result.configPath}`
      : `Config already exists: ${result.configPath}`
  );
}

function reportFailure(error) {
  console.error(`openwrtctl: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(reportFailure);
}
