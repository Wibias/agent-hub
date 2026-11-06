// Explicit, source-only adapter for the pinned Agent Hub Impeccable distribution.
// This executes the existing local JS detector, not the auto-downloading binary launcher.
import { createHash } from "node:crypto";
import { existsSync, lstatSync, realpathSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { assertProviderReport, Capability, ProviderStatus, providerFailure } from "./contract.mjs";
import { runProcess } from "./process-runner.mjs";

const DEFAULT_SCRIPT = fileURLToPath(
  new URL("../../../impeccable/scripts/detect.mjs", import.meta.url),
);
const SCAN_MODULE = "detector/detect-antipatterns.mjs";
const VALID_SEVERITIES = new Set(["error", "warning", "notice", "info", "advisory"]);
const SCAN_PROOF_PREFIX = "DWA_IMPECCABLE_SCAN_PROOF=";
const IMPECCABLE_TIMEOUT_MS = 120_000;

/**
 * The bundled CLI emits this only after every eligible static file has
 * completed. No receipt, zero eligible files or inconsistent counts means
 * there is no defensible source coverage claim. This is not a browser audit.
 */
function readScanProof(stderr) {
  const lines = String(stderr ?? "").split(/\r?\n/)
    .filter((line) => line.startsWith(SCAN_PROOF_PREFIX));
  if (lines.length !== 1) throw new Error("Missing or duplicate scan receipt");
  let proof;
  try { proof = JSON.parse(lines[0].slice(SCAN_PROOF_PREFIX.length)); }
  catch { throw new Error("Invalid scan receipt JSON"); }
  if (!proof || typeof proof !== "object" || Array.isArray(proof) ||
      proof.schemaVersion !== 1 ||
      !["candidateFiles", "eligibleFiles", "scannedFiles", "ignoredFiles", "degradedFiles", "durationMs"]
        .every((key) => Number.isSafeInteger(proof[key]) && proof[key] >= 0) ||
      proof.candidateFiles !== proof.eligibleFiles + proof.ignoredFiles ||
      proof.eligibleFiles === 0 ||
      proof.scannedFiles + proof.degradedFiles !== proof.eligibleFiles ||
      proof.configEnabled !== true ||
      typeof proof.inlineIgnoresEnabled !== "boolean" ||
      typeof proof.designSystemEnabled !== "boolean") {
    throw new Error("Incomplete or contradictory source scan receipt");
  }
  if (proof.degradedFiles > 0) {
    throw new Error("HTML parser fallback degraded " + proof.degradedFiles +
      " file(s); full selector/cascade checks were not run");
  }
  return proof;
}

function safeFile(path) {
  if (!existsSync(path)) return false;
  const stat = lstatSync(path);
  return stat.isFile() && !stat.isSymbolicLink();
}

function inside(root, path) {
  const suffix = relative(root, path);
  return suffix !== ".." && !suffix.startsWith(".." + sep) && !isAbsolute(suffix);
}

// Match the pinned vendored JS walker's scannable suffixes and skip dirs.
const SOURCE_EXTENSION = /\.(?:html?|css|scss|sass|less|jsx?|tsx?|vue|svelte|astro|blade\.php)$/i;
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "__pycache__"]);
const HIDDEN_SOURCE_DIRS = new Set([".vitepress", ".vuepress", ".storybook"]);
function rejectScannableSymlinks(target) {
  if (!lstatSync(target).isDirectory()) return;
  const stack = [target];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;
      if (entry.isDirectory() && entry.name.startsWith(".") &&
          !HIDDEN_SOURCE_DIRS.has(entry.name)) continue;
      const child = join(current, entry.name);
      if (entry.isSymbolicLink() && SOURCE_EXTENSION.test(entry.name)) {
        throw new Error("Symlinked UI source is outside the trusted scan scope: " + child);
      }
      if (entry.isDirectory()) stack.push(child);
    }
  }
}

function scanLocation({ target, projectRoot }) {
  if (typeof target !== "string" || !target.trim() ||
      /^(?:https?|file):\/\//i.test(target)) {
    throw new Error("A local file or directory target is required (URLs and CDP are disabled)");
  }
  const absolute = resolve(target);
  if (!existsSync(absolute)) throw new Error("Source target does not exist");
  const stat = lstatSync(absolute);
  if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
    throw new Error("Source target must be a regular file or directory, not a symlink");
  }
  const root = projectRoot ? resolve(projectRoot)
    : stat.isDirectory() ? absolute : dirname(absolute);
  if (!existsSync(root) || !lstatSync(root).isDirectory() ||
      lstatSync(root).isSymbolicLink()) {
    throw new Error("Project root must be an existing directory, not a symlink");
  }
  const realRoot = realpathSync(root);
  const realTarget = realpathSync(absolute);
  if (!inside(realRoot, realTarget)) throw new Error("Source target is outside the project root");
  rejectScannableSymlinks(realTarget);
  return { absolute: realTarget, root: realRoot };
}

function normalizedFile(file, root) {
  if (typeof file !== "string" || !file.trim()) {
    throw new Error("Impeccable finding has no file");
  }
  const absolute = isAbsolute(file) ? resolve(file) : resolve(root, file);
  if (!inside(root, absolute)) {
    throw new Error("Impeccable finding refers outside the scanned project");
  }
  return (relative(root, absolute) || ".").replaceAll("\\", "/");
}

function parseFinding(raw, root, route, occurrences) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) ||
      typeof raw.antipattern !== "string" || !raw.antipattern.trim() ||
      typeof raw.name !== "string" || !raw.name.trim() ||
      typeof raw.severity !== "string" ||
      !VALID_SEVERITIES.has(raw.severity) ||
      (raw.line !== undefined && (!Number.isInteger(raw.line) || raw.line < 0))) {
    throw new Error("Malformed Impeccable finding");
  }
  const file = normalizedFile(raw.file, root);
  const line = raw.line > 0 ? raw.line : null;
  const advisory = raw.advisory === true || raw.severity === "advisory";
  const content = String(raw.snippet ?? "");
  const key = [route, raw.antipattern, file, line ?? "", content].join("\0");
  const hash = createHash("sha256").update(key).digest("hex").slice(0, 20);
  const ordinal = occurrences.get(hash) ?? 0;
  occurrences.set(hash, ordinal + 1);
  return {
    id: "impeccable-" + hash + (ordinal ? "-" + ordinal : ""),
    providerRuleId: raw.antipattern,
    category: typeof raw.category === "string" ? raw.category : "other",
    priority: advisory ? "P2" : raw.severity === "error" ? "P1" : "P2",
    confidence: "heuristic",
    advisory,
    message: typeof raw.description === "string" && raw.description.trim()
      ? raw.description : raw.name,
    location: { route, file, line },
    evidence: [{ kind: "source", ref: file + (line ? ":" + line : "") }],
  };
}

export function createImpeccableProvider({ script = DEFAULT_SCRIPT, runner = runProcess } = {}) {
  return {
    id: "impeccable",
    capabilities: [Capability.STATIC_AUDIT],
    async probe() {
      const scriptPath = resolve(script);
      const enginePath = resolve(dirname(scriptPath), SCAN_MODULE);
      if (!safeFile(scriptPath) || !safeFile(enginePath)) {
        return { available: false, reason: "Pinned, bundled Impeccable JS detector is unavailable" };
      }
      return { available: true, implementation: "bundled-js" };
    },
    async inspect({ target, route, projectRoot, capability } = {}) {
      if (capability !== Capability.STATIC_AUDIT) {
        return providerFailure("impeccable", Capability.STATIC_AUDIT,
          ProviderStatus.BLOCKED, "Only local static source audits are enabled");
      }
      if (typeof route !== "string" || !route.trim()) {
        return providerFailure("impeccable", capability, ProviderStatus.BLOCKED,
          "A non-empty route is required");
      }
      let location;
      try {
        location = scanLocation({ target, projectRoot });
      } catch (error) {
        return providerFailure("impeccable", capability, ProviderStatus.BLOCKED,
          String(error.message ?? error));
      }

      // Do not invoke scripts/impeccable, npx, an installer or an arbitrary PATH binary.
      const run = await runner({
        executable: process.execPath,
        args: [resolve(script), "--json", "--dwa-scan-proof", location.absolute],
        cwd: location.root,
        timeoutMs: IMPECCABLE_TIMEOUT_MS,
        maxOutputBytes: 4_194_304,
      });
      if (run.error || run.timedOut || run.outputLimitExceeded) {
        return providerFailure("impeccable", capability, ProviderStatus.ERROR,
          "Impeccable detector execution failed or exceeded its resource limit");
      }
      if (![0, 2].includes(run.exitCode)) {
        // The released Rust engine uses exit 1 for incomplete scans, even when
        // JSON contains valid findings from other targets. Never promote that to PASS.
        const stderrTail = String(run.stderr ?? "").trim()
          .replace(/[\x00-\x1f\x7f]/g, " ").slice(-240);
        return providerFailure("impeccable", capability, ProviderStatus.ERROR,
          "Impeccable detector did not complete (exit " + String(run.exitCode) + ")" +
          (stderrTail ? ": " + stderrTail : ""));
      }
      let raw;
      try { raw = JSON.parse(run.stdout); } catch {
        return providerFailure("impeccable", capability, ProviderStatus.ERROR,
          "Impeccable detector did not return valid JSON");
      }
      if (!Array.isArray(raw)) {
        return providerFailure("impeccable", capability, ProviderStatus.ERROR,
          "Impeccable detector JSON must be a findings array");
      }
      try {
        const proof = readScanProof(run.stderr);
        const occurrences = new Map();
        const findings = raw.map((entry) =>
          parseFinding(entry, location.root, route, occurrences));
        const primary = findings.filter((item) => !item.advisory);
        if ((run.exitCode === 0 && primary.length > 0) ||
            (run.exitCode === 2 && primary.length === 0)) {
          throw new Error("Detector exit code disagrees with primary findings");
        }
        return assertProviderReport({
          provider: "impeccable",
          capability,
          status: findings.length ? ProviderStatus.FINDINGS : ProviderStatus.PASS,
          provenance: {
            distribution: "Agent Hub vendored Impeccable",
            implementation: "bundled-js",
            command: "node scripts/detect.mjs --json --dwa-scan-proof <local-target>",
            executable: resolve(script),
            networkRequired: false,
            externalInstall: false,
          },
          summary: {
            primary: primary.length,
            advisory: findings.length - primary.length,
            sourceOnly: true,
            // Upstream findings JSON has no per-file scan-progress report.
            filesScanned: proof.scannedFiles,
            eligibleFiles: proof.eligibleFiles,
            candidateFiles: proof.candidateFiles,
            ignoredFiles: proof.ignoredFiles,
            degradedFiles: proof.degradedFiles,
            coverageCountVerified: true,
            coverageMethod: "bundled-detector-completed-source-file-count",
            // Explicit modes, not a count of findings suppressed by waivers.
            inlineIgnoresEnabled: proof.inlineIgnoresEnabled,
            designSystemEnabled: proof.designSystemEnabled,
            scanDurationMs: proof.durationMs,
            timeoutBudgetMs: IMPECCABLE_TIMEOUT_MS,
            requiresRenderedReview: true,
            // 2 means findings, not a tool failure, per Impeccable CLI.
            detectorExitCode: run.exitCode,
          },
          findings,
        }, { providerId: "impeccable", capability });
      } catch (error) {
        return providerFailure("impeccable", capability, ProviderStatus.ERROR,
          "Impeccable detector output validation failed: " + String(error.message ?? error));
      }
    },
  };
}
