import { fileURLToPath } from "node:url";
import { createRemote } from "./lib/remote.js";
import {
  buildRemoteNfqws2TestCommand,
  getNfqws2TestLogPath
} from "./lib/nfqws2-test.js";

export async function testNfqws2(remote) {
  if (!remote.config.nfqws2) {
    throw new Error("test-nfqws2 requires an nfqws2 section in the project config");
  }

  const remoteTmpDirectory = remote.config.openwrt.remoteTmpDir;

  await remote.exec(
    buildRemoteNfqws2TestCommand(
      remoteTmpDirectory,
      remote.config.nfqws2.test.httpsDomains
    )
  );
  console.log(
    `Saved full nfqws2 test log on the router: ${getNfqws2TestLogPath(remoteTmpDirectory)}`
  );
}

export async function main() {
  await testNfqws2(await createRemote());
}

function reportFailure(error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(reportFailure);
}
