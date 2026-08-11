import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);

export function resolvePackageBin(packageName, binName = packageName) {
  const packagePath = require.resolve(`${packageName}/package.json`);
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  const relativeBinPath =
    typeof packageJson.bin === "string" ? packageJson.bin : packageJson.bin?.[binName];

  if (typeof relativeBinPath !== "string" || relativeBinPath.length === 0) {
    throw new Error(`${packageName} does not expose the ${binName} executable`);
  }

  return path.resolve(path.dirname(packagePath), relativeBinPath);
}
