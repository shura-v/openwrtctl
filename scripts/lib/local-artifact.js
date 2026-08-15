import { spawn } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const DEFAULT_ARTIFACT_TIMEOUT_MS = 30_000;

const OUTPUT_MARKER = "{output}";
const PROCESS_CLEANUP_TIMEOUT_MS = 2_000;
const PROCESS_KILL_GRACE_MS = 250;
const PROCESS_POLL_INTERVAL_MS = 10;
const STAGING_DIRECTORY_PREFIX = ".openwrtctl-artifact-";

export function resolveLocalArtifactSource(
  source,
  configPath,
  fieldName = "artifact"
) {
  if (!isRecord(source)) {
    throw new Error(`${fieldName} must be a mapping`);
  }

  if (typeof source.path !== "string" || source.path.length === 0) {
    throw new Error(`${fieldName}.path must be a non-empty path`);
  }

  const resolvedConfigPath = path.resolve(configPath);
  const resolved = {
    path: resolveConfigRelativePath(source.path, resolvedConfigPath)
  };

  if (source.prepare === undefined) {
    return resolved;
  }

  if (!isRecord(source.prepare)) {
    throw new Error(`${fieldName}.prepare must be a mapping`);
  }

  const command = source.prepare.command;
  if (
    !Array.isArray(command) ||
    command.length === 0 ||
    command.some((argument) => typeof argument !== "string") ||
    command[0].length === 0
  ) {
    throw new Error(`${fieldName}.prepare.command must be a non-empty argv list`);
  }

  const exactMarkers = command.filter((argument) => argument === OUTPUT_MARKER);
  const embeddedMarker = command.some(
    (argument) => argument !== OUTPUT_MARKER && argument.includes(OUTPUT_MARKER)
  );
  if (exactMarkers.length !== 1 || embeddedMarker) {
    throw new Error(
      `${fieldName}.prepare.command must contain exactly one standalone ${OUTPUT_MARKER} argument`
    );
  }

  const configuredCwd = source.prepare.cwd;
  if (
    configuredCwd !== undefined &&
    (typeof configuredCwd !== "string" || configuredCwd.length === 0)
  ) {
    throw new Error(`${fieldName}.prepare.cwd must be a non-empty path`);
  }

  resolved.prepare = {
    command: [...command],
    cwd:
      configuredCwd === undefined
        ? path.dirname(resolvedConfigPath)
        : resolveConfigRelativePath(configuredCwd, resolvedConfigPath)
  };
  return resolved;
}

export async function prepareLocalArtifact(
  source,
  {
    configPath = path.join(process.cwd(), "config.yaml"),
    fieldName = "artifact",
    label = fieldName,
    validate,
    timeoutMs = DEFAULT_ARTIFACT_TIMEOUT_MS
  } = {}
) {
  if (typeof validate !== "function") {
    throw new Error(`${label} validator must be a function`);
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`${label} timeout must be a positive integer`);
  }

  const resolved = resolveLocalArtifactSource(source, configPath, fieldName);
  if (!resolved.prepare) {
    const snapshot = await readRegularUtf8File(resolved.path, label);
    const validated = await validateSnapshot(validate, snapshot, resolved.path, label);
    return createArtifactResult(resolved.path, snapshot, validated);
  }

  const parentPath = path.dirname(resolved.path);
  await ensurePrivateParent(parentPath);
  const stagingPath = await mkdtemp(
    path.join(parentPath, STAGING_DIRECTORY_PREFIX)
  );
  await chmod(stagingPath, 0o700);
  const candidatePath = path.join(stagingPath, "output");
  const command = resolved.prepare.command.map((argument) =>
    argument === OUTPUT_MARKER ? candidatePath : argument
  );

  try {
    await executeProducer(command, {
      cwd: resolved.prepare.cwd,
      label,
      timeoutMs
    });
    const snapshot = await readRegularUtf8File(candidatePath, `${label} producer output`);
    const validated = await validateSnapshot(validate, snapshot, candidatePath, label);
    await chmod(candidatePath, 0o600);
    await rename(candidatePath, resolved.path);
    return createArtifactResult(resolved.path, snapshot, validated);
  } finally {
    await rm(stagingPath, { recursive: true, force: true });
  }
}

function resolveConfigRelativePath(value, configPath) {
  if (value === "~") {
    return os.homedir();
  }
  if (value.startsWith("~/")) {
    return path.join(os.homedir(), value.slice(2));
  }

  return path.resolve(path.dirname(configPath), value);
}

async function ensurePrivateParent(parentPath) {
  try {
    await lstat(parentPath);
    return;
  } catch (error) {
    if (!hasErrorCode(error, "ENOENT")) {
      throw error;
    }
  }

  await mkdir(parentPath, { recursive: true, mode: 0o700 });
  await chmod(parentPath, 0o700);
}

async function readRegularUtf8File(filePath, label) {
  let stats;
  try {
    stats = await lstat(filePath);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      throw new Error(`${label} is missing: ${filePath}`);
    }
    throw error;
  }

  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error(`${label} must be a non-symlink regular file: ${filePath}`);
  }

  const bytes = await readFile(filePath);
  const snapshot = bytes.toString("utf8");
  if (!Buffer.from(snapshot, "utf8").equals(bytes)) {
    throw new Error(`${label} must contain valid UTF-8 text`);
  }
  return snapshot;
}

async function validateSnapshot(validate, snapshot, filePath, label) {
  try {
    return await validate(snapshot, { path: filePath });
  } catch {
    throw new Error(`${label} artifact validation failed`);
  }
}

function executeProducer(command, { cwd, label, timeoutMs }) {
  const [executable, ...argumentsList] = command;
  const executableName = path.basename(executable);

  return new Promise((resolve, reject) => {
    let childClosed = false;
    let timedOut = false;
    let killTimer;
    const detached = process.platform !== "win32";
    const child = spawn(executable, argumentsList, {
      cwd,
      detached,
      shell: false,
      stdio: "ignore"
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      terminateProcess(child, detached, "SIGTERM");
      killTimer = setTimeout(() => {
        terminateProcess(child, detached, "SIGKILL");
        waitForProcessCleanup(child, detached, () => childClosed).then(
          () =>
            reject(
              new Error(
                `${label} producer ${executableName} timed out after ${timeoutMs} ms`
              )
            ),
          () =>
            reject(
              new Error(
                `${label} producer ${executableName} timed out after ${timeoutMs} ms and process cleanup did not finish`
              )
            )
        );
      }, PROCESS_KILL_GRACE_MS);
    }, timeoutMs);
    timeout.unref();

    child.once("error", (error) => {
      if (timedOut) {
        return;
      }
      clearTimeout(timeout);
      clearTimeout(killTimer);
      const condition = hasErrorCode(error, "ENOENT")
        ? "was not found"
        : `failed to start (${error.code ?? "unknown error"})`;
      reject(new Error(`${label} producer ${executableName} ${condition}`));
    });

    child.once("close", (code, signal) => {
      childClosed = true;
      clearTimeout(timeout);
      if (timedOut) {
        // Keep the referenced escalation timer alive: the leader may exit on
        // SIGTERM while a descendant in the same process group ignores it.
        return;
      }

      clearTimeout(killTimer);
      if (code === 0) {
        resolve();
      } else if (signal) {
        reject(
          new Error(`${label} producer ${executableName} terminated by ${signal}`)
        );
      } else {
        reject(
          new Error(`${label} producer ${executableName} exited with code ${code}`)
        );
      }
    });
  });
}

async function waitForProcessCleanup(child, detached, isChildClosed) {
  const deadline = Date.now() + PROCESS_CLEANUP_TIMEOUT_MS;

  while (isProducerProcessRunning(child, detached, isChildClosed)) {
    if (Date.now() >= deadline) {
      throw new Error("producer process cleanup timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, PROCESS_POLL_INTERVAL_MS));
  }
}

function isProducerProcessRunning(child, detached, isChildClosed) {
  if (!detached) {
    return !isChildClosed();
  }
  if (child.pid === undefined) {
    return false;
  }

  try {
    process.kill(-child.pid, 0);
    return true;
  } catch (error) {
    if (hasErrorCode(error, "ESRCH")) {
      return false;
    }
    if (hasErrorCode(error, "EPERM")) {
      return true;
    }
    throw error;
  }
}

function terminateProcess(child, detached, signal) {
  if (child.pid === undefined) {
    return;
  }

  try {
    if (detached) {
      process.kill(-child.pid, signal);
    } else {
      child.kill(signal);
    }
  } catch (error) {
    // A process may exit between the close check and the signal delivery.
    // Other signal errors are non-recoverable here; the close listener remains
    // the single place that settles producer execution.
  }
}

function createArtifactResult(artifactPath, snapshot, validated) {
  return Object.freeze({ path: artifactPath, snapshot, validated });
}

function hasErrorCode(error, code) {
  return error && typeof error === "object" && error.code === code;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
