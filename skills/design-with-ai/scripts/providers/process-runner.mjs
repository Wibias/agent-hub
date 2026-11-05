// Fixed executable + argument arrays only. This does not sandbox the child.
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const DEFAULT_ENV_KEYS = Object.freeze([
  "PATH", "Path", "SystemRoot", "WINDIR", "HOME", "USERPROFILE",
  "TMP", "TEMP", "TMPDIR",
]);

export async function runProcess({
  executable, args = [], cwd, timeoutMs = 20_000, maxOutputBytes = 1_048_576,
  envKeys = DEFAULT_ENV_KEYS,
} = {}) {
  if (typeof executable !== "string" || !executable.trim() || executable.includes("\0") ||
      !Array.isArray(args) || !args.every((arg) => typeof arg === "string" && !arg.includes("\0")) ||
      typeof cwd !== "string" || !cwd.trim() ||
      !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000 ||
      !Number.isInteger(maxOutputBytes) || maxOutputBytes < 1 || maxOutputBytes > 16_777_216 ||
      !Array.isArray(envKeys) || !envKeys.every((key) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key))) {
    throw new TypeError("Invalid bounded process invocation");
  }
  const env = {};
  for (const key of envKeys) if (Object.hasOwn(process.env, key)) env[key] = process.env[key];

  return new Promise((done) => {
    let child;
    try {
      child = spawn(executable, args, {
        cwd: resolve(cwd), env, shell: false, windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      done({ exitCode: null, signal: null, stdout: "", stderr: "",
        error: error.code ?? "SPAWN_ERROR", timedOut: false, outputLimitExceeded: false });
      return;
    }
    const stdout = [];
    const stderr = [];
    let used = 0;
    let outputLimitExceeded = false;
    let timedOut = false;
    let spawnError = null;
    let ended = false;
    const append = (list, chunk) => {
      if (outputLimitExceeded) return;
      used += chunk.length;
      if (used > maxOutputBytes) {
        outputLimitExceeded = true;
        child.kill("SIGKILL");
        return;
      }
      list.push(chunk);
    };
    child.stdout.on("data", (chunk) => append(stdout, chunk));
    child.stderr.on("data", (chunk) => append(stderr, chunk));
    child.on("error", (error) => { spawnError = error.code ?? "SPAWN_ERROR"; });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    timer.unref();
    child.on("close", (exitCode, signal) => {
      if (ended) return;
      ended = true;
      clearTimeout(timer);
      done({
        exitCode, signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        error: spawnError,
        timedOut, outputLimitExceeded,
      });
    });
  });
}
