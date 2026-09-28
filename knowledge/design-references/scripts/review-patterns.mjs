#!/usr/bin/env node
import { resolve } from "node:path";
import {
  loadPatterns,
  parseArgs,
  readJsonl,
  stripInternal,
  writeJsonl,
} from "./lib.mjs";

const args = parseArgs(process.argv.slice(2));
for (const required of ["input", "output", "review-log"]) {
  if (!args[required]) throw new Error("Missing --" + required);
}

const input = resolve(String(args.input));
const output = resolve(String(args.output));
const reviewLog = resolve(String(args["review-log"]));
const candidates = readJsonl(input);
const reviewRows = readJsonl(reviewLog);
const reviews = new Map();
const errors = [];

for (const review of reviewRows) {
  if (!/^pattern-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(review.id || "")) {
    errors.push((review.id || "review") + ": invalid pattern id");
  }
  if (reviews.has(review.id)) {
    errors.push(review.id + ": duplicate review decision");
  }
  reviews.set(review.id, review);
  if (!["approve", "reject"].includes(review.verdict)) {
    errors.push(review.id + ": invalid verdict");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(review.reviewedAt || "")) {
    errors.push(review.id + ": reviewedAt must be YYYY-MM-DD");
  }
  for (const field of ["sourceChecked", "rightsChecked", "duplicateChecked"]) {
    if (review[field] !== true) {
      errors.push(review.id + ": " + field + " must be true");
    }
  }
  if (!review.reviewer || !review.notes || review.notes.length < 8) {
    errors.push(review.id + ": reviewer and substantive notes required");
  }
}

const candidateIds = new Set();
for (const candidate of candidates) {
  if (candidateIds.has(candidate.id)) {
    errors.push(candidate.id + ": duplicate candidate id");
  }
  candidateIds.add(candidate.id);
  if (candidate.reviewStatus !== "candidate") {
    errors.push(candidate.id + ": input pattern must be a candidate");
  }
  if (candidate.reviewedBy !== null || candidate.reviewedAt !== null) {
    errors.push(candidate.id + ": candidate review fields must be null");
  }
}
for (const id of candidateIds) {
  if (!reviews.has(id)) errors.push(id + ": missing review decision");
}
for (const id of reviews.keys()) {
  if (!candidateIds.has(id)) errors.push(id + ": review has no candidate");
}

const existingIds = new Set(
  loadPatterns()
    .filter((pattern) => resolve(pattern.__file) !== output)
    .map((pattern) => pattern.id),
);
const approved = candidates
  .filter((candidate) => reviews.get(candidate.id)?.verdict === "approve")
  .map((candidate) => {
    const review = reviews.get(candidate.id);
    if (review.reviewer === candidate.synthesizedBy) {
      errors.push(candidate.id + ": reviewer must differ from synthesizer");
    }
    if (existingIds.has(candidate.id)) {
      errors.push(candidate.id + ": id already exists in the library");
    }
    return {
      ...stripInternal(candidate),
      reviewStatus: "reviewed",
      reviewedBy: review.reviewer,
      reviewedAt: review.reviewedAt,
    };
  });

if (errors.length) {
  console.error(JSON.stringify({ ok: false, errors }, null, 2));
  process.exit(1);
}
writeJsonl(output, approved);
console.log(
  JSON.stringify(
    {
      ok: true,
      input,
      reviewLog,
      output,
      approved: approved.length,
      rejected: candidates.length - approved.length,
    },
    null,
    2,
  ),
);
