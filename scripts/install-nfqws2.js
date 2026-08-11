import path from "node:path";
import {
  installNfqws2Release,
  parseNfqws2VersionArgument,
  prepareNfqws2ReleaseArchive
} from "./lib/nfqws2-release.js";
import { createRemote } from "./lib/remote.js";

main().catch(reportFailure);

async function main() {
  const version = parseNfqws2VersionArgument(process.argv.slice(2));
  const remote = await createRemote();
  const { archivePath, release } = await prepareNfqws2ReleaseArchive(
    path.join(remote.localDirectory, ".work"),
    version
  );
  const result = await installNfqws2Release(remote, archivePath, release);

  console.log(`Installed nfqws2 from zapret2 ${result.version}`);
  console.log("nfqws2 is disabled until sync-nfqws2 applies a managed config.");
}

function reportFailure(error) {
  console.error(`openwrt: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
