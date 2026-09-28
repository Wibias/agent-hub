#!/usr/bin/env node
import { resolve } from "node:path";
import {
  analysisSignature,
  duplicateKey,
  loadRecords,
  parseArgs,
  readJsonl,
  validateRecord,
  writeJsonl,
} from "./lib.mjs";

const args = parseArgs(process.argv.slice(2));
for (const required of ["input", "output", "review-log"]) {
  if (!args[required]) throw new Error("Missing --" + required);
}

const input = resolve(String(args.input));
const output = resolve(String(args.output));
const reviewLog = resolve(String(args["review-log"]));
const reviewRows = readJsonl(reviewLog);
const reviews = new Map();
const reviewErrors = [];

for (const review of reviewRows) {
  if (!/^ref-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(review.id || "")) {
    reviewErrors.push((review.id || "review") + ": invalid reference id");
  }
  if (reviews.has(review.id)) {
    reviewErrors.push(review.id + ": duplicate review decision");
  }
  reviews.set(review.id, review);
  if (!["approve", "reject"].includes(review.verdict)) {
    reviewErrors.push(review.id + ": invalid verdict");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(review.reviewedAt || "")) {
    reviewErrors.push(review.id + ": reviewedAt must be YYYY-MM-DD");
  }
  for (const field of ["sourceChecked", "rightsChecked", "duplicateChecked"]) {
    if (review[field] !== true) {
      reviewErrors.push(review.id + ": " + field + " must be true");
    }
  }
  if (!review.reviewer || !review.notes || review.notes.length < 8) {
    reviewErrors.push(review.id + ": reviewer and substantive notes required");
  }
}
if (reviewErrors.length) {
  console.error(JSON.stringify({ ok: false, errors: reviewErrors }, null, 2));
  process.exit(1);
}

const candidates = readJsonl(input);
const candidateIdCounts = new Map();
for (const record of candidates) {
  candidateIdCounts.set(record.id, (candidateIdCounts.get(record.id) || 0) + 1);
}
const duplicateCandidateIds = [...candidateIdCounts]
  .filter(([, count]) => count > 1)
  .map(([id]) => id);
if (duplicateCandidateIds.length) {
  throw new Error("Duplicate candidate IDs: " + duplicateCandidateIds.join(", "));
}
const candidateIds = new Set(candidates.map((record) => record.id));
const unknownReviews = [...reviews.keys()].filter((id) => !candidateIds.has(id));
if (unknownReviews.length) {
  throw new Error("Review decisions without candidates: " + unknownReviews.join(", "));
}
const missingReviews = candidates
  .filter((record) => !reviews.has(record.id))
  .map((record) => record.id);
if (missingReviews.length) {
  throw new Error("Missing review decisions: " + missingReviews.join(", "));
}

const records = candidates
  .filter((record) => reviews.get(record.id).verdict === "approve")
  .map((record) => {
    const review = reviews.get(record.id);
    return {
      ...record,
      lastVerifiedAt: review.reviewedAt,
      reviewStatus: "reviewed",
      reviewedBy: review.reviewer,
      reviewedAt: review.reviewedAt,
    };
  });
const errors = [];
const existing = loadRecords().filter(
  (record) => resolve(record.__file) !== output,
);
const existingIds = new Map(existing.map((record) => [record.id, record]));
const existingDuplicateKeys = new Map(
  existing.map((record) => [duplicateKey(record), record]),
);
const existingSignatures = new Map(
  existing.map((record) => [analysisSignature(record), record]),
);
for (const record of records) {
  for (const error of validateRecord(record, { requireReviewed: true })) {
    errors.push(record.id + ": " + error);
  }
  if (existingIds.has(record.id)) {
    errors.push(record.id + ": id already exists in the library");
  }
  const duplicate = existingDuplicateKeys.get(duplicateKey(record));
  if (duplicate) {
    errors.push(record.id + ": duplicates URL and flow states of " + duplicate.id);
  }
  const matchingAnalysis = existingSignatures.get(analysisSignature(record));
  if (matchingAnalysis) {
    errors.push(record.id + ": duplicates normalized analysis of " + matchingAnalysis.id);
  }
}
if (errors.length) {
  console.error(JSON.stringify({ ok: false, errors }, null, 2));
  process.exit(1);
}

writeJsonl(output, records);
console.log(
  JSON.stringify(
    {
      ok: true,
      input,
      reviewLog,
      output,
      approved: records.length,
      rejected: candidates.length - records.length,
    },
    null,
    2,
  ),
);
