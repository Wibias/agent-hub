#!/usr/bin/env node
import { resolve, relative } from "node:path";
import {
  ROOT,
  loadRecords,
  parseArgs,
  readJsonl,
  validateRecord,
  writeJsonl,
} from "./lib.mjs";
import {
  applyRevalidationDecisions,
  validateRevalidationDecision,
} from "./revalidation-lib.mjs";

function usage() {
  return [
    "Usage:",
    "  node knowledge/design-references/scripts/revalidate-batch.mjs --plan --review-log <jsonl>",
    "  node knowledge/design-references/scripts/revalidate-batch.mjs --apply --review-log <jsonl>",
    "",
    "--plan validates decisions and reports affected records without writing files.",
    "--apply rewrites only data shards containing revalidated records.",
  ].join("\n");
}

function displayFile(file) {
  return relative(ROOT, file).replaceAll("\\", "/");
}

function validateResult(records) {
  const errors = [];
  for (const record of records) {
    for (const error of validateRecord(record)) {
      errors.push(record.id + ": " + error);
    }
  }
  if (errors.length) {
    throw new Error("revalidated catalog is invalid:\n" + errors.join("\n"));
  }
}

function changedFiles(records, changedIds) {
  const files = new Set();
  for (const record of records) {
    if (!changedIds.has(record.id)) continue;
    if (typeof record.__file !== "string" || !record.__file) {
      throw new Error("record is missing source shard: " + record.id);
    }
    files.add(resolve(record.__file));
  }
  return [...files].sort();
}

function outputSummary({ mode, reviewLog, result, changedIds, files }) {
  return {
    mode,
    applied: mode === "apply",
    review_log: reviewLog,
    touched_ids: [...changedIds].sort(),
    touched_files: files.map(displayFile),
    summary: result.summary,
  };
}

const args = parseArgs(process.argv.slice(2));
const planMode = args.plan === true;
const applyMode = args.apply === true;
if (planMode === applyMode) {
  throw new Error("Choose exactly one of --plan or --apply.\n\n" + usage());
}
if (!args["review-log"] || args["review-log"] === true) {
  throw new Error("--review-log <jsonl> is required.\n\n" + usage());
}

const reviewLog = resolve(String(args["review-log"]));
const decisions = readJsonl(reviewLog).map(validateRevalidationDecision);
const records = loadRecords();
const result = applyRevalidationDecisions(records, decisions);
validateResult(result.records);

const changedIds = new Set(decisions.map((decision) => decision.id));
const files = changedFiles(records, changedIds);

if (applyMode) {
  for (const file of files) {
    writeJsonl(
      file,
      result.records.filter((record) => resolve(record.__file) === file),
    );
  }
}

console.log(JSON.stringify(outputSummary({
  mode: planMode ? "plan" : "apply",
  reviewLog,
  result,
  changedIds,
  files,
}), null, 2));
