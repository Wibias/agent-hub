#!/usr/bin/env node
// Phase 5 DWA Gate supplement. Never substitutes for canonical DWA verification.
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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
      throw new Error("Unknown, repeated or missing option " + String(arg));
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
  const paths = {};
  for (const report of evaluated.reports) {
    const file = join(runDir, report.provider + ".json");
    writeFresh(file, report);
    paths[report.provider] = file;
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
    coverage: evaluated.fusion.coverage,
    counts: evaluated.fusion.counts,
    artifacts: { directory: runDir, reports: paths, fusion: fusionPath },
    ...(journalCapture ? { journalCapture } : {}),
    next: evaluated.next,
  };
  writeFresh(join(runDir, "summary.json"), summary);
  return summary;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await runQualityAudit();
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    process.exitCode = ["BLOCKED", "INCOMPLETE"].includes(result.status) ? 1 : 0;
  } catch (error) {
    process.stderr.write("DWA provider audit: " + String(error.message ?? error) + "\n");
    process.exitCode = 2;
  }
}
