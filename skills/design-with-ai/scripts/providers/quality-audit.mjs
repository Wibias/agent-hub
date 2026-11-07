#!/usr/bin/env node
// Phase 5 DWA Gate supplement. Never substitutes for canonical DWA verification.
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { captureProviderFusion } from "./evidence-journal.mjs";
import { runProfileProviders } from "./workflow.mjs";

const allowedOptions = new Set([
  "--profile", "--path", "--route", "--project-root", "--html", "--browser-root",
  "--taste-root", "--output-root", "--intent", "--page-kind", "--category",
  "--primary", "--journal", "--ledger", "--run-id",
]);
const allowedFlags = new Set(["--with-taste", "--require-taste", "--no-impeccable"]);
// Most audit failures originate in files, child processes or optional tools.
// Their raw messages can contain arbitrary paths, URLs or credentials.
// Keep only explicitly recognized, fixed public diagnostics.
// Safe, path-free labels from our own workflow and scope-validation code.
// Never forward a generic filesystem, browser, detector or provider exception.
const SAFE_WORKFLOW_ERRORS = Object.freeze([
  "Local source target, /route and project root are required",
  "Project root and source must exist without symlink targets",
  "Source target is outside the project scope",
  "A local built HTML page is required when Taste Skill is selected",
  "Browser target must be a local regular HTML file",
  "Browser asset root must be an existing regular directory",
  "Use an isolated built-site subtree inside projectRoot for browser assets",
  "Requested route does not match the built HTML path; SPA routes require verified route-specific HTML",
  "Browser output cannot reside inside the served asset root",
  "Source scope escapes project",
  "Source scope has no eligible files",
  "Detector DESIGN.md resolves outside projectRoot",
  "Detector context dependency must be a regular in-project file",
  "Audited source changed during provider execution; evidence invalid",
]);
const PUBLIC_CLI_ERRORS = new Set([
  ...SAFE_WORKFLOW_ERRORS,
  "Quick profile cannot initiate a browser provider",
  "Output root must already exist",
  "Invalid DWA provider profile or selection",
  "A required Taste Skill scan must be explicitly enabled",
  "Unknown, repeated or missing option",
  "--path is required",
  "--route is required",
  "--project-root is required",
  "Taste-specific options require --with-taste",
  "--with-taste requires --html (a local built page)",
  "Journal capture requires --journal, --ledger and --run-id together",
  ...[...allowedFlags].map((flag) => "Repeated flag " + flag),
]);

function parseArgs(argv) {
  const values = new Map(), flags = new Set();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (allowedFlags.has(arg)) {
      if (flags.has(arg)) throw new Error("Repeated flag " + arg);
      flags.add(arg);
      continue;
    }
    if (!allowedOptions.has(arg) || values.has(arg) ||
        i + 1 >= argv.length || argv[i + 1].startsWith("--") ||
        !argv[i + 1].trim()) {
      throw new Error("Unknown, repeated or missing option");
    }
    values.set(arg, argv[++i]);
  }
  for (const arg of ["--path", "--route", "--project-root"]) {
    if (!values.has(arg)) throw new Error(arg + " is required");
  }
  const withTaste = flags.has("--with-taste") || flags.has("--require-taste");
  if (!withTaste && ["--html", "--browser-root", "--taste-root", "--page-kind", "--category", "--primary"]
    .some((key) => values.has(key))) {
    throw new Error("Taste-specific options require --with-taste");
  }
  if (withTaste && !values.has("--html")) {
    throw new Error("--with-taste requires --html (a local built page)");
  }
  const journalParams = ["--journal", "--ledger", "--run-id"];
  const selectedJournal = journalParams.filter((key) => values.has(key));
  if (selectedJournal.length && selectedJournal.length !== journalParams.length) {
    throw new Error("Journal capture requires --journal, --ledger and --run-id together");
  }
  return {
    profile: values.get("--profile") ?? "standard",
    target: resolve(values.get("--path")), route: values.get("--route"),
    projectRoot: resolve(values.get("--project-root")),
    withImpeccable: !flags.has("--no-impeccable"),
    withTaste, requireTaste: flags.has("--require-taste"),
    ...(values.has("--html") ? { html: resolve(values.get("--html")) } : {}),
    ...(values.has("--browser-root") ? { browserRoot: resolve(values.get("--browser-root")) } : {}),
    ...(values.has("--taste-root") ? { tasteRoot: resolve(values.get("--taste-root")) } : {}),
    ...(values.has("--intent") ? { intentPath: resolve(values.get("--intent")) } : {}),
    ...(values.has("--page-kind") ? { pageKind: values.get("--page-kind") } : {}),
    ...(values.has("--category") ? { category: values.get("--category") } : {}),
    ...(values.has("--primary") ? { primary: values.get("--primary") } : {}),
    outputRoot: values.has("--output-root") ? resolve(values.get("--output-root")) : tmpdir(),
    journal: selectedJournal.length ? {
      journalPath: resolve(values.get("--journal")),
      legacyPath: resolve(values.get("--ledger")),
      runId: values.get("--run-id"),
    } : null,
  };
}

function writeFresh(path, obj) {
  writeFileSync(path, JSON.stringify(obj, null, 2) + "\n", { flag: "wx" });
}

export async function runQualityAudit(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (!existsSync(opts.outputRoot)) {
    throw new Error("Output root must already exist");
  }
  // Never share a fixed output directory with another checker or iteration.
  const runDir = mkdtempSync(join(opts.outputRoot, "dwa-provider-"));
  const evaluated = await runProfileProviders({
    ...opts, outputRoot: runDir,
  });
  const scopePath = join(runDir, "source-scope.json");
  writeFresh(scopePath, evaluated.sourceManifest);
  const paths = {}, hashes = {};
  for (const report of evaluated.reports) {
    const file = join(runDir, report.provider + ".json");
    writeFresh(file, report);
    paths[report.provider] = file;
    hashes[report.provider] = createHash("sha256").update(JSON.stringify(report, null, 2) + "\n").digest("hex");
  }
  const fusionPath = join(runDir, "fusion.json");
  writeFresh(fusionPath, evaluated.fusion);
  let journalCapture = null;
  if (opts.journal) {
    journalCapture = captureProviderFusion(
      opts.journal.journalPath, opts.journal.legacyPath,
      { runId: opts.journal.runId, fusion: evaluated.fusion },
    );
  }
  const summary = {
    schemaVersion: 1,
    profile: opts.profile,
    status: evaluated.fusion.status,
    completionEligible: false,
    selected: evaluated.selection,
    scope: evaluated.scope,
    coverage: evaluated.fusion.coverage,
    counts: evaluated.fusion.counts,
    artifacts: { directory: runDir, reports: paths, fusion: fusionPath, sourceScope: scopePath, reportSha256: hashes },
    ...(journalCapture ? { journalCapture } : {}),
    next: evaluated.next,
  };
  writeFresh(join(runDir, "summary.json"), summary);
  return summary;
}

// A public diagnostic must match one complete, authored label. A similar
// untrusted error with extra paths/tokens is never surfaced verbatim.
export function safeQualityAuditError(error) {
  const message = error?.message;
  return typeof message === "string" && PUBLIC_CLI_ERRORS.has(message)
    ? message : "Audit failed; untrusted error details redacted";
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await runQualityAudit();
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    process.exitCode = ["BLOCKED", "INCOMPLETE"].includes(result.status) ? 1 : 0;
  } catch (error) {
    const reason = safeQualityAuditError(error);
    process.stderr.write("DWA provider audit: " + reason + "\n");
    process.exitCode = 2;
  }
}
