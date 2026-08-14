import { createRemote } from "./lib/remote.js";
import {
  buildRemoteNfqws2TestCommand,
  getNfqws2TestLogPath
} from "./lib/nfqws2-test.js";

async function main() {
  const remote = await createRemote();
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

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
