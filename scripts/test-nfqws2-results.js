import { buildRemoteNfqws2TestResultsCommand } from "./lib/nfqws2-test.js";
import { createRemote } from "./lib/remote.js";

async function main() {
  const remote = await createRemote();

  await remote.exec(
    buildRemoteNfqws2TestResultsCommand(remote.config.openwrt.remoteTmpDir),
    { verbose: false }
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
