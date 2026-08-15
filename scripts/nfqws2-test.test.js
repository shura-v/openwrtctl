import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import {
  buildRemoteNfqws2TestCommand,
  buildRemoteNfqws2TestResultsCommand,
  getNfqws2TestLogPath
} from "./lib/nfqws2-test.js";
import { testNfqws2 } from "./test-nfqws2.js";

const execFileAsync = promisify(execFile);

test("rejects test-nfqws2 when its service section is omitted", async () => {
  const calls = [];

  await assert.rejects(
    testNfqws2({
      config: { openwrt: { remoteTmpDir: "/root/tmp" } },
      exec: async (command) => calls.push(command)
    }),
    /test-nfqws2 requires an nfqws2 section/u
  );

  assert.deepEqual(calls, []);
});

test("builds an HTTPS-only nfqws2 strategy test with service restoration", () => {
  const command = buildRemoteNfqws2TestCommand("/tmp/openwrtctl", [
    "www.youtube.com",
    "example.org"
  ]);

  assert.match(command, /export DOMAINS='www\.youtube\.com example\.org'/u);
  assert.match(command, /export ENABLE_HTTP=0/u);
  assert.match(command, /export ENABLE_HTTPS_TLS12=1/u);
  assert.match(command, /export ENABLE_HTTPS_TLS13=1/u);
  assert.match(command, /export ENABLE_HTTP3=0/u);
  assert.match(command, /\/etc\/init\.d\/zapret2 status[\s\S]*was_running=1/u);
  assert.match(command, /trap restore_nfqws2 EXIT/u);
  assert.match(command, /if ! \/etc\/init\.d\/zapret2 start/u);
  assert.equal(
    getNfqws2TestLogPath("/tmp/openwrtctl"),
    "/tmp/openwrtctl/nfqws2-test.log"
  );
});

test("preserves the blockcheck exit status across tee", () => {
  const command = buildRemoteNfqws2TestCommand("/tmp/openwrtctl", ["www.youtube.com"]);

  assert.match(command, /blockcheck_status=\$\?/u);
  assert.match(command, /printf '%s\\n' "\$blockcheck_status" > "\$status_file"/u);
  assert.match(command, /read -r blockcheck_status < "\$status_file"/u);
  assert.match(command, /exit "\$blockcheck_status"/u);
});

test("prints only successful HTTPS nfqws2 strategies from the saved log", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "openwrtctl-nfqws2-test-"));
  const logPath = getNfqws2TestLogPath(directory);
  await writeFile(
    logPath,
    `
- curl_test_http ipv4 www.youtube.com : nfqws2 --http-success
!!!!! AVAILABLE !!!!!
- curl_test_https_tls12 ipv4 www.youtube.com : nfqws2 --tls12-success
!!!!! AVAILABLE !!!!!
- curl_test_https_tls13 ipv4 www.youtube.com : nfqws2 --tls13-failure
UNAVAILABLE code=28
- curl_test_https_tls13 ipv4 www.youtube.com : nfqws2 --tls13-success
diagnostic output
!!!!! AVAILABLE !!!!!
`,
    "utf8"
  );

  const { stdout } = await execFileAsync("/bin/sh", [
    "-c",
    buildRemoteNfqws2TestResultsCommand(directory)
  ]);

  assert.equal(stdout, "--tls12-success\n--tls13-success\n");

  context.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });
});

test("reports the expected log path when no nfqws2 test has run", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "openwrtctl-nfqws2-test-"));

  await assert.rejects(
    execFileAsync("/bin/sh", ["-c", buildRemoteNfqws2TestResultsCommand(directory)]),
    /nfqws2 test log is missing/u
  );

  context.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });
});
