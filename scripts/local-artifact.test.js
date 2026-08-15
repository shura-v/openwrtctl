import assert from "node:assert/strict";
import {
  lstat,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import os, { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  prepareLocalArtifact,
  resolveLocalArtifactSource
} from "./lib/local-artifact.js";

const validText = (snapshot) => {
  if (!snapshot.startsWith("valid:")) {
    throw new Error("invalid payload");
  }
  return snapshot.slice("valid:".length);
};

test("resolves artifact paths and producer cwd from the config location", () => {
  const configPath = path.join(tmpdir(), "openwrt config", "config.yaml");

  assert.deepEqual(
    resolveLocalArtifactSource(
      {
        path: "generated/artifact.json",
        prepare: { command: ["producer", "{output}"] }
      },
      configPath,
      "singbox.config"
    ),
    {
      path: path.join(tmpdir(), "openwrt config", "generated/artifact.json"),
      prepare: {
        command: ["producer", "{output}"],
        cwd: path.join(tmpdir(), "openwrt config")
      }
    }
  );
  assert.equal(
    resolveLocalArtifactSource({ path: "~/artifact.json" }, configPath).path,
    path.join(os.homedir(), "artifact.json")
  );
  assert.equal(
    resolveLocalArtifactSource(
      {
        path: "artifact.json",
        prepare: { command: ["producer", "{output}"], cwd: "producer tools" }
      },
      configPath
    ).prepare.cwd,
    path.join(tmpdir(), "openwrt config", "producer tools")
  );
});

test("requires path and a command when prepare is configured", () => {
  const configPath = path.join(tmpdir(), "config.yaml");

  assert.throws(
    () => resolveLocalArtifactSource({}, configPath, "service.artifact"),
    /service\.artifact\.path must be a non-empty path/u
  );
  assert.throws(
    () =>
      resolveLocalArtifactSource(
        { path: "artifact", prepare: { cwd: "." } },
        configPath,
        "service.artifact"
      ),
    /service\.artifact\.prepare\.command must be a non-empty argv list/u
  );
});

test("rejects invalid output marker placement before producer execution", () => {
  const configPath = path.join(tmpdir(), "config.yaml");
  const invalidCommands = [
    ["producer"],
    ["producer", "{output}", "{output}"],
    ["producer", "--output={output}"]
  ];

  for (const command of invalidCommands) {
    assert.throws(
      () =>
        resolveLocalArtifactSource(
          { path: "artifact", prepare: { command } },
          configPath,
          "service.artifact"
        ),
      /exactly one standalone \{output\}/u
    );
  }
});

test("reads and validates a static file without modifying it", async (context) => {
  const fixture = await createFixture(context, "static");
  const artifactPath = path.join(fixture, "static artifact.yaml");
  await writeFile(artifactPath, "valid:static", { mode: 0o644 });

  const artifact = await prepareLocalArtifact(
    { path: "static artifact.yaml" },
    {
      configPath: path.join(fixture, "config.yaml"),
      label: "static artifact",
      validate: validText
    }
  );

  assert.equal(artifact.path, artifactPath);
  assert.equal(artifact.snapshot, "valid:static");
  assert.equal(artifact.validated, "static");
  assert.equal(Object.isFrozen(artifact), true);
  assert.equal((await lstat(artifactPath)).mode & 0o777, 0o644);
});

test("does not create a missing parent for a static source", async (context) => {
  const fixture = await createFixture(context, "static-missing");
  const parentPath = path.join(fixture, "missing parent");

  await assert.rejects(
    prepareLocalArtifact(
      { path: "missing parent/artifact.yaml" },
      {
        configPath: path.join(fixture, "config.yaml"),
        label: "static artifact",
        validate: validText
      }
    ),
    /static artifact is missing/u
  );
  await assert.rejects(lstat(parentPath), { code: "ENOENT" });
});

test("runs a producer without a shell and atomically persists mode 0600", async (context) => {
  const fixture = await createFixture(context, "producer space");
  const targetPath = path.join(fixture, "generated parent", "artifact with space.txt");
  const shellArgument = `$(touch ${path.join(fixture, "shell-ran")}); * & top-secret`;
  const script = [
    'const fs = require("node:fs");',
    'fs.writeFileSync(process.argv[1], `valid:${process.argv[2]}`);'
  ].join("");

  const artifact = await prepareLocalArtifact(
    {
      path: targetPath,
      prepare: {
        command: [process.execPath, "-e", script, "{output}", shellArgument],
        cwd: fixture
      }
    },
    { label: "generated artifact", validate: validText }
  );

  assert.equal(artifact.snapshot, `valid:${shellArgument}`);
  assert.equal(artifact.validated, shellArgument);
  assert.equal(await readFile(targetPath, "utf8"), artifact.snapshot);
  assert.equal((await lstat(targetPath)).mode & 0o777, 0o600);
  assert.equal((await lstat(path.dirname(targetPath))).mode & 0o777, 0o700);
  await assert.rejects(lstat(path.join(fixture, "shell-ran")), { code: "ENOENT" });
  await assertNoStagingDirectories(path.dirname(targetPath));
});

test("keeps an immutable snapshot when the persisted file changes", async (context) => {
  const fixture = await createFixture(context, "snapshot");
  const targetPath = path.join(fixture, "artifact.txt");
  const artifact = await prepareLocalArtifact(
    {
      path: targetPath,
      prepare: { command: writeProducer("valid:before") }
    },
    { label: "snapshot artifact", validate: validText }
  );

  await writeFile(targetPath, "valid:after");

  assert.equal(artifact.snapshot, "valid:before");
  assert.equal(artifact.validated, "before");
});

test("preserves the previous file and hides producer output on non-zero exit", async (context) => {
  const fixture = await createFixture(context, "nonzero");
  const targetPath = path.join(fixture, "artifact.txt");
  await writeFile(targetPath, "valid:previous");
  const script = [
    'process.stdout.write("top-secret stdout");',
    'process.stderr.write("top-secret stderr");',
    "process.exit(7);"
  ].join("");

  await assert.rejects(
    prepareLocalArtifact(
      {
        path: targetPath,
        prepare: {
          command: [process.execPath, "-e", script, "{output}", "top-secret arg"]
        }
      },
      { label: "sing-box", validate: validText }
    ),
    (error) => {
      assert.match(error.message, /sing-box producer node exited with code 7/u);
      assert.doesNotMatch(error.message, /top-secret/u);
      return true;
    }
  );
  assert.equal(await readFile(targetPath, "utf8"), "valid:previous");
  await assertNoStagingDirectories(fixture);
});

test("times out a producer, cleans it up, and preserves the previous file", async (context) => {
  const fixture = await createFixture(context, "timeout");
  const targetPath = path.join(fixture, "artifact.txt");
  await writeFile(targetPath, "valid:previous");

  await assert.rejects(
    prepareLocalArtifact(
      {
        path: targetPath,
        prepare: {
          command: [
            process.execPath,
            "-e",
            "setInterval(() => {}, 1_000);",
            "{output}"
          ]
        }
      },
      { label: "timed artifact", timeoutMs: 50, validate: validText }
    ),
    /timed artifact producer node timed out after 50 ms/u
  );
  assert.equal(await readFile(targetPath, "utf8"), "valid:previous");
  await assertNoStagingDirectories(fixture);
});

test("kills descendants when the timed-out producer leader exits on SIGTERM", async (context) => {
  const fixture = await createFixture(context, "timeout-descendant");
  const targetPath = path.join(fixture, "artifact.txt");
  const workerPidPath = path.join(fixture, "worker.pid");
  const workerScript = [
    'const fs = require("node:fs");',
    'fs.writeFileSync(process.argv[1], String(process.pid));',
    'process.on("SIGTERM", () => {});',
    "setInterval(() => {}, 1_000);"
  ].join("");
  const leaderScript = [
    'const { spawn } = require("node:child_process");',
    `const workerScript = ${JSON.stringify(workerScript)};`,
    "const worker = spawn(process.execPath,",
    '["-e", workerScript, process.argv[2]], { stdio: "ignore" });',
    "worker.unref();",
    'process.on("SIGTERM", () => process.exit(0));',
    "setInterval(() => {}, 1_000);"
  ].join("");
  let workerPid;

  try {
    await assert.rejects(
      prepareLocalArtifact(
        {
          path: targetPath,
          prepare: {
            command: [
              process.execPath,
              "-e",
              leaderScript,
              "{output}",
              workerPidPath
            ]
          }
        },
        { label: "descendant artifact", timeoutMs: 250, validate: validText }
      ),
      /descendant artifact producer node timed out after 250 ms/u
    );

    workerPid = Number(await readFile(workerPidPath, "utf8"));
    assert.equal(Number.isSafeInteger(workerPid), true);
    assert.equal(isProcessRunning(workerPid), false);
    await assertNoStagingDirectories(fixture);
  } finally {
    if (workerPid !== undefined && isProcessRunning(workerPid)) {
      process.kill(workerPid, "SIGKILL");
    }
  }
});

for (const [kind, script, expectedMessage] of [
  ["missing", "", /producer output is missing/u],
  [
    "directory",
    'require("node:fs").mkdirSync(process.argv[1]);',
    /non-symlink regular file/u
  ],
  [
    "symlink",
    'require("node:fs").symlinkSync(process.argv[2], process.argv[1]);',
    /non-symlink regular file/u
  ]
]) {
  test(`rejects and cleans up ${kind} producer output`, async (context) => {
    const fixture = await createFixture(context, `output-${kind}`);
    const targetPath = path.join(fixture, "artifact.txt");
    const symlinkTarget = path.join(fixture, "symlink-target.txt");
    await writeFile(symlinkTarget, "valid:target");

    await assert.rejects(
      prepareLocalArtifact(
        {
          path: targetPath,
          prepare: {
            command: [process.execPath, "-e", script, "{output}", symlinkTarget]
          }
        },
        { label: `${kind} artifact`, validate: validText }
      ),
      expectedMessage
    );
    await assert.rejects(lstat(targetPath), { code: "ENOENT" });
    await assertNoStagingDirectories(fixture);
  });
}

test("rejects malformed output before persistence and preserves the previous file", async (context) => {
  const fixture = await createFixture(context, "malformed");
  const targetPath = path.join(fixture, "artifact.txt");
  await writeFile(targetPath, "valid:previous");

  await assert.rejects(
    prepareLocalArtifact(
      {
        path: targetPath,
        prepare: { command: writeProducer("malformed") }
      },
      { label: "validated artifact", validate: validText }
    ),
    /validated artifact artifact validation failed/u
  );
  assert.equal(await readFile(targetPath, "utf8"), "valid:previous");
  await assertNoStagingDirectories(fixture);
});

test("rejects a symlink static source", async (context) => {
  const fixture = await createFixture(context, "static-symlink");
  await writeFile(path.join(fixture, "target"), "valid:target");
  await symlink("target", path.join(fixture, "artifact"));

  await assert.rejects(
    prepareLocalArtifact(
      { path: path.join(fixture, "artifact") },
      { label: "static artifact", validate: validText }
    ),
    /non-symlink regular file/u
  );
});

function writeProducer(contents) {
  return [
    process.execPath,
    "-e",
    `require("node:fs").writeFileSync(process.argv[1], ${JSON.stringify(contents)});`,
    "{output}"
  ];
}

async function createFixture(context, name) {
  const fixture = await mkdtemp(path.join(tmpdir(), `openwrtctl-${name}-`));
  context.after(() => rm(fixture, { recursive: true, force: true }));
  return fixture;
}

async function assertNoStagingDirectories(parentPath) {
  const entries = await readdir(parentPath);
  assert.equal(
    entries.some((entry) => entry.startsWith(".openwrtctl-artifact-")),
    false
  );
}

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ESRCH") {
      return false;
    }
    throw error;
  }
}
