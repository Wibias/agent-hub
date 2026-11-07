#!/usr/bin/env node
// Read-only, bounded comparison of vendored Impeccable static scan modes.
// This diagnostic does not change target source files or the DWA acceptance gate.
import { existsSync, lstatSync, readdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { runProcess } from "./process-runner.mjs";

const SCRIPT = fileURLToPath(new URL("../../../impeccable/scripts/detect.mjs", import.meta.url));
const SELF = fileURLToPath(import.meta.url);
// Node resolves ESM import.meta.url through symlinks; argv[1] may retain its
// symlink spelling. Compare canonical paths for both command entrypoints.
const isMain = (() => {
  try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(SELF); }
  catch { return false; }
})();
const SCOPE_PREFLIGHT_FLAG = "--internal-scope-preflight";
const SCOPE_PREFLIGHT_TIMEOUT_MS = 15_000;
const MODES = Object.freeze([
  { id: "configured", flags: [] },
  { id: "no-inline-ignores", flags: ["--no-inline-ignores"] },
  { id: "no-design-system", flags: ["--no-design-system"] },
  { id: "no-config", flags: ["--no-config"] },
]);
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "__pycache__"]);
const SOURCE_EXT = /\.(?:html?|css|scss|sass|less|jsx?|tsx?|vue|svelte|astro|blade\.php)$/i;
const isInside = (root, path) => {
  const rel = relative(root, path);
  return rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel);
};

function argsFrom(argv) {
  const options = new Map();
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!["--target", "--project-root", "--rounds"].includes(key) ||
        options.has(key) || i + 1 >= argv.length ||
        argv[i + 1].startsWith("--")) {
      throw new Error("Invalid/repeated argument: " + String(key));
    }
    options.set(key, argv[++i]);
  }
  if (!options.has("--target") || !options.has("--project-root")) {
    throw new Error("--target and --project-root are required");
  }
  const rounds = options.has("--rounds") ? Number(options.get("--rounds")) : 1;
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 3) {
    throw new Error("--rounds must be an integer from 1 to 3");
  }
  return { target: options.get("--target"), projectRoot: options.get("--project-root"), rounds };
}

function rejectScannableSymlinks(directory) {
  if (!lstatSync(directory).isDirectory()) return;
  const stack = [directory];
  while (stack.length) {
    const parent = stack.pop();
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name) ||
          (entry.isDirectory() && entry.name.startsWith(".") &&
           ![".storybook", ".vitepress", ".vuepress"].includes(entry.name))) continue;
      const child = join(parent, entry.name);
      if (entry.isSymbolicLink() && SOURCE_EXT.test(entry.name)) {
        throw new Error("Source symlink is outside the trusted benchmark scope: " + child);
      }
      if (entry.isDirectory()) stack.push(child);
    }
  }
}

function trustedScope({ target, projectRoot }) {
  const root = resolve(projectRoot), source = resolve(target);
  if (!existsSync(root) || !existsSync(source) ||
      lstatSync(root).isSymbolicLink() || !lstatSync(root).isDirectory() ||
      lstatSync(source).isSymbolicLink() ||
      !(lstatSync(source).isDirectory() || lstatSync(source).isFile())) {
    throw new Error("A real project directory and regular source target are required");
  }
  const realRoot = realpathSync(root), realSource = realpathSync(source);
  if (!isInside(realRoot, realSource)) throw new Error("Target escapes project root");
  rejectScannableSymlinks(realSource);
  return { root: realRoot, target: realSource };
}

// The recursive symlink scope walk must never execute in the parent event
// loop. Run it as a bounded subprocess before any measured detector mode.
// A separate deadline guarantees an INCOMPLETE JSON report even when a
// mocked/broken process transport never settles.
async function runBoundedScopePreflight(opts, {
  preflightRunner = runProcess,
  preflightTimeoutMs = SCOPE_PREFLIGHT_TIMEOUT_MS,
} = {}) {
  if (!Number.isInteger(preflightTimeoutMs) ||
      preflightTimeoutMs < 1 || preflightTimeoutMs > 60_000) {
    throw new TypeError("Invalid scope preflight deadline");
  }
  let timer;
  try {
    const result = await Promise.race([
      preflightRunner({
        executable: process.execPath,
        args: [SELF, SCOPE_PREFLIGHT_FLAG, "--target", opts.target,
          "--project-root", opts.projectRoot],
        cwd: process.cwd(),
        timeoutMs: preflightTimeoutMs,
        maxOutputBytes: 8_192,
      }),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve({ timedOut: true }), preflightTimeoutMs + 500);
      }),
    ]);
    if (result?.error || result?.timedOut || result?.outputLimitExceeded ||
        result?.exitCode !== 0 || result?.stderr?.trim()) return null;
    const scope = JSON.parse(result.stdout);
    if (!scope || typeof scope.root !== "string" ||
        typeof scope.target !== "string" ||
        !isAbsolute(scope.root) || !isAbsolute(scope.target) ||
        !isInside(scope.root, scope.target)) return null;
    return scope;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const SCAN_PROOF_PREFIX = "DWA_IMPECCABLE_SCAN_PROOF=";

function readCompleteProof(stderr, mode) {
  const receipts = String(stderr ?? "").split(/\r?\n/)
    .filter((line) => line.startsWith(SCAN_PROOF_PREFIX));
  if (receipts.length !== 1) {
    throw new Error("Missing or duplicate Impeccable completed-file receipt");
  }
  let proof;
  try { proof = JSON.parse(receipts[0].slice(SCAN_PROOF_PREFIX.length)); }
  catch { throw new Error("Invalid Impeccable scan receipt JSON"); }
  const numbers = ["candidateFiles", "eligibleFiles", "ignoredFiles",
    "scannedFiles", "degradedFiles", "durationMs", "designSystemResolvedFiles"];
  if (!proof || typeof proof !== "object" || Array.isArray(proof) ||
      proof.schemaVersion !== 1 ||
      numbers.some((key) => !Number.isSafeInteger(proof[key]) || proof[key] < 0) ||
      proof.eligibleFiles === 0 ||
      proof.candidateFiles !== proof.eligibleFiles + proof.ignoredFiles ||
      proof.scannedFiles !== proof.eligibleFiles ||
      proof.degradedFiles !== 0 ||
      proof.designSystemResolvedFiles > proof.scannedFiles ||
      !["configEnabled", "inlineIgnoresEnabled", "designSystemEnabled"]
        .every((key) => typeof proof[key] === "boolean")) {
    throw new Error("Incomplete, degraded or contradictory Impeccable source coverage");
  }
  const configured = mode.id !== "no-config";
  const inline = configured && mode.id !== "no-inline-ignores";
  if (proof.configEnabled !== configured ||
      proof.inlineIgnoresEnabled !== inline ||
      (!configured && proof.designSystemEnabled) ||
      (mode.id === "no-design-system" && proof.designSystemEnabled) ||
      (!proof.designSystemEnabled && proof.designSystemResolvedFiles !== 0)) {
    throw new Error("Impeccable receipt contradicts benchmark scan mode");
  }
  return proof;
}

function validateDetectorResult(result, mode) {
  if (result.error || result.timedOut || result.outputLimitExceeded ||
      ![0, 2].includes(result.exitCode)) {
    throw new Error("Detector failed, timed out, or returned a partial result");
  }
  const proof = readCompleteProof(result.stderr, mode);
  let findings;
  try { findings = JSON.parse(result.stdout); } catch {
    throw new Error("Detector stdout is not JSON");
  }
  if (!Array.isArray(findings) || findings.some((f) =>
    !f || typeof f !== "object" || !f.antipattern ||
    !["error", "warning", "notice", "info", "advisory"].includes(f.severity))) {
    throw new Error("Detector returned malformed findings");
  }
  const primary = findings.filter((f) => f.advisory !== true && f.severity !== "advisory");
  if ((result.exitCode === 0 && primary.length) ||
      (result.exitCode === 2 && !primary.length)) {
    throw new Error("Detector exit code contradicts findings");
  }
  return {
    filesScanned: proof.scannedFiles,
    candidateFiles: proof.candidateFiles,
    ignoredFiles: proof.ignoredFiles,
    degradedFiles: proof.degradedFiles,
    designSystemEnabled: proof.designSystemEnabled,
    designSystemResolvedFiles: proof.designSystemResolvedFiles,
    findings: findings.length,
    primary: primary.length,
    advisory: findings.length - primary.length,
    byRule: Object.fromEntries([...new Set(findings.map((f) => f.antipattern))]
      .sort().map((rule) => [rule, findings.filter((f) => f.antipattern === rule).length])),
  };
}

export async function compareImpeccableModes(argv, {
  runner = runProcess, script = SCRIPT,
  preflightRunner = runProcess,
  preflightTimeoutMs = SCOPE_PREFLIGHT_TIMEOUT_MS,
} = {}) {
  const opts = argsFrom(argv);
  const scope = await runBoundedScopePreflight(opts, {
    preflightRunner, preflightTimeoutMs,
  });
  if (!scope) {
    return {
      schemaVersion: 1,
      kind: "dwa/impeccable-performance-diagnostic",
      status: "INCOMPLETE",
      target: resolve(opts.target),
      roundsRequested: opts.rounds,
      runs: [],
      note: "Source-scope preflight failed or timed out; no measured detector runs started.",
    };
  }
  if (!existsSync(script) || !lstatSync(script).isFile() || lstatSync(script).isSymbolicLink()) {
    throw new Error("Vendored detector script does not exist");
  }
  const runs = [];
  for (let round = 0; round < opts.rounds; round++) {
    // Reverse alternating rounds to expose obvious warm-cache/order effects.
    const order = round % 2 ? [...MODES].reverse() : [...MODES];
    for (const mode of order) {
      const started = performance.now();
      const run = await runner({
        executable: process.execPath,
        args: [resolve(script), "--json", "--dwa-scan-proof", ...mode.flags, scope.target],
        cwd: scope.root,
        timeoutMs: 120_000,
        maxOutputBytes: 4_194_304,
      });
      const elapsedMs = Math.round(performance.now() - started);
      const row = { round: round + 1, mode: mode.id, elapsedMs };
      try {
        Object.assign(row, validateDetectorResult(run, mode));
        row.status = "COMPLETE";
      } catch (error) {
        row.status = "ERROR";
        row.error = String(error.message ?? error);
        runs.push(row);
        return {
          schemaVersion: 1,
          kind: "dwa/impeccable-performance-diagnostic",
          status: "INCOMPLETE",
          target: scope.target,
          roundsRequested: opts.rounds,
          runs,
          note: "A failed run invalidates comparative timing. No product-quality verdict.",
        };
      }
      runs.push(row);
    }
  }
  const designSystemComparison = runs
    .filter((r) => ["configured", "no-inline-ignores"].includes(r.mode))
    .every((r) => r.designSystemEnabled && r.designSystemResolvedFiles === r.filesScanned)
    ? "ESTABLISHED" : "NOT_ESTABLISHED";
  return {
    schemaVersion: 1,
    kind: "dwa/impeccable-performance-diagnostic",
    status: "COMPLETE",
    designSystemComparison,
    target: scope.target,
    roundsRequested: opts.rounds,
    runs,
    note: (designSystemComparison === "ESTABLISHED"
      ? "Modes isolate inline exceptions and resolved DESIGN.md interpretation. "
      : "DESIGN.md comparison NOT ESTABLISHED: design-system disabled, unresolved or only partially resolved. Inline ignores remain isolated. ") +
      "Wall-clock differences can still reflect JIT, file caches, OS scheduling and run order. This is not a rendered UI audit or a DWA completion proof.",
  };
}

if (isMain && process.argv[2] === SCOPE_PREFLIGHT_FLAG) {
  try {
    const scope = trustedScope(argsFrom(process.argv.slice(3)));
    process.stdout.write(JSON.stringify(scope) + "\n");
  } catch {
    // Untrusted paths and filesystem errors never enter the parent report.
    process.stderr.write("Source-scope preflight failed\n");
    process.exitCode = 2;
  }
} else if (isMain) {
  try {
    const report = await compareImpeccableModes(process.argv.slice(2));
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    if (report.status !== "COMPLETE") process.exitCode = 1;
  } catch (error) {
    process.stderr.write("Impeccable performance diagnostic: " +
      String(error.message ?? error) + "\n");
    process.exitCode = 2;
  }
}
