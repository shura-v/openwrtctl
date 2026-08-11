import path from "node:path";
import {
  parseNfqws2VersionArgument,
  prepareNfqws2ReleaseArchive
} from "./lib/nfqws2-release.js";
import { updateNfqws2Release } from "./lib/nfqws2-lifecycle.js";
import { createRemote } from "./lib/remote.js";

main().catch(reportFailure);

async function main() {
  const version = parseNfqws2VersionArgument(process.argv.slice(2));
  const remote = await createRemote();
  const { archivePath, release } = await prepareNfqws2ReleaseArchive(
    path.join(remote.localDirectory, ".work"),
    version
  );
  const result = await updateNfqws2Release(remote, archivePath, release);

  console.log(`Updated nfqws2 to zapret2 ${result.version}`);
}

function reportFailure(error) {
  console.error(`openwrt: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
