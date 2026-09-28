#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  DATA_DIR,
  PATTERN_DIR,
  ROOT,
  TAXONOMY,
  analysisSignature,
  countBy,
  duplicateKey,
  loadRecords,
  loadPatterns,
  listJsonlFiles,
  normalizeUrl,
  parseArgs,
  readJsonl,
  validateRecord,
} from "./lib.mjs";

const args = parseArgs(process.argv.slice(2));
const records = loadRecords();
const errors = [];
const warnings = [];
const ids = new Map();
const duplicateKeys = new Map();
const signatures = new Map();
const patterns = loadPatterns();
const cacheRoot = resolve(
  String(args["cache-root"] || join(homedir(), ".agents", ".cache", "design-references")),
);
let cacheManifests = 0;
const cacheHashes = new Map();

for (const record of records) {
  const recordErrors = validateRecord(record, {
    requireReviewed: Boolean(args.production),
  });
  for (const error of recordErrors) {
    errors.push(record.id + ": " + error);
  }
  if (ids.has(record.id)) {
    errors.push(record.id + ": duplicate id");
  }
  ids.set(record.id, record);

  try {
    const key = duplicateKey(record);
    if (duplicateKeys.has(key)) {
      errors.push(
        record.id + ": duplicate URL and flow state with " + duplicateKeys.get(key),
      );
    }
    duplicateKeys.set(key, record.id);
  } catch {
    // URL validation reports the concrete failure.
  }

  const signature = analysisSignature(record);
  if (signatures.has(signature)) {
    errors.push(
      record.id + ": duplicate normalized analysis with " + signatures.get(signature),
    );
  }
  signatures.set(signature, record.id);
}
for (const record of records) {
  if (record.replacementFor !== null && !ids.has(record.replacementFor)) {
    errors.push(record.id + ": replacementFor references an unknown record");
  }
}

const forbiddenExtensions = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".mp4", ".mov",
]);
function scanForbidden(directory) {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      scanForbidden(full);
      continue;
    }
    const dot = entry.name.lastIndexOf(".");
    const extension = dot >= 0 ? entry.name.slice(dot).toLowerCase() : "";
    if (forbiddenExtensions.has(extension)) {
      errors.push("copyright gate: committed media is forbidden: " + full);
    }
  }
}
scanForbidden(ROOT);

function listCacheManifests(directory) {
  if (!existsSync(directory)) return [];
  const manifests = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      manifests.push(...listCacheManifests(full));
    } else if (entry.name === "manifest.json") {
      manifests.push(full);
    }
  }
  return manifests;
}

for (const manifestPath of listCacheManifests(cacheRoot)) {
  cacheManifests += 1;
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    errors.push(manifestPath + ": invalid cache manifest: " + error.message);
    continue;
  }
  const required = [
    "recordId", "capturedAt", "viewport", "sourceUrl", "sha256", "files",
    "rightsConfirmed", "retentionPolicy",
  ];
  const extras = Object.keys(manifest).filter((key) => !required.includes(key));
  for (const field of required) {
    if (!(field in manifest)) errors.push(manifestPath + ": missing " + field);
  }
  if (extras.length) {
    errors.push(manifestPath + ": unexpected fields: " + extras.join(", "));
  }
  const record = ids.get(manifest.recordId);
  if (!record) {
    errors.push(manifestPath + ": unknown recordId " + manifest.recordId);
    continue;
  }
  if (record.storagePolicy !== "local-cache-permitted") {
    errors.push(manifestPath + ": record storagePolicy forbids local caching");
  }
  if (manifest.rightsConfirmed !== true) {
    errors.push(manifestPath + ": rightsConfirmed must be true");
  }
  if (!["expire", "approved-comparison"].includes(manifest.retentionPolicy)) {
    errors.push(manifestPath + ": invalid retentionPolicy");
  }
  try {
    if (normalizeUrl(manifest.sourceUrl) !== normalizeUrl(record.canonicalUrl)) {
      errors.push(manifestPath + ": sourceUrl does not match the record");
    }
  } catch {
    errors.push(manifestPath + ": sourceUrl must be a valid URL");
  }
  if (!/^\d{4}-\d{2}-\d{2}T/.test(manifest.capturedAt || "")) {
    errors.push(manifestPath + ": capturedAt must be an ISO date-time");
  }
  if (
    !Number.isInteger(manifest.viewport?.width) ||
    manifest.viewport.width < 1 ||
    !Number.isInteger(manifest.viewport?.height) ||
    manifest.viewport.height < 1
  ) {
    errors.push(manifestPath + ": viewport requires positive integer dimensions");
  }
  if (!/^[a-f0-9]{64}$/.test(manifest.sha256 || "")) {
    errors.push(manifestPath + ": sha256 must be lowercase hexadecimal");
  } else if (cacheHashes.has(manifest.sha256)) {
    errors.push(
      manifestPath +
        ": duplicate cache checksum with " +
        cacheHashes.get(manifest.sha256),
    );
  } else {
    cacheHashes.set(manifest.sha256, manifestPath);
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    errors.push(manifestPath + ": files must be a non-empty array");
    continue;
  }
  const manifestDirectory = resolve(manifestPath, "..");
  for (const file of manifest.files) {
    if (typeof file !== "string" || !file || isAbsolute(file)) {
      errors.push(manifestPath + ": cache file paths must be relative strings");
      continue;
    }
    const resolvedFile = resolve(manifestDirectory, file);
    const relativeFile = relative(manifestDirectory, resolvedFile);
    if (relativeFile === ".." || relativeFile.startsWith(".." + sep)) {
      errors.push(manifestPath + ": cache file path escapes its record directory");
    } else if (!existsSync(resolvedFile)) {
      errors.push(manifestPath + ": cache file is missing: " + file);
    }
  }
  const original = resolve(manifestDirectory, String(manifest.files[0] || ""));
  if (existsSync(original) && /^[a-f0-9]{64}$/.test(manifest.sha256 || "")) {
    const actual = createHash("sha256").update(readFileSync(original)).digest("hex");
    if (actual !== manifest.sha256) {
      errors.push(manifestPath + ": sha256 does not match the first cache file");
    }
  }
}

const patternIds = new Set();
for (const pattern of patterns) {
  const required = [
    "id",
    "name",
    "problem",
    "worksWhen",
    "failsWhen",
    "examples",
    "counterexamples",
    "evidenceStrength",
    "lastSynthesizedAt",
    "tags",
    "reviewStatus",
    "synthesizedBy",
    "reviewedBy",
    "reviewedAt",
  ];
  for (const field of required) {
    if (!(field in pattern)) errors.push((pattern.id || "pattern") + ": missing " + field);
  }
  if (!/^pattern-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(pattern.id || "")) {
    errors.push((pattern.id || "pattern") + ": invalid pattern id");
  }
  if (patternIds.has(pattern.id)) errors.push(pattern.id + ": duplicate pattern id");
  patternIds.add(pattern.id);
  for (const field of ["worksWhen", "failsWhen", "examples", "counterexamples", "tags"]) {
    if (!Array.isArray(pattern[field]) || pattern[field].length === 0) {
      errors.push(pattern.id + ": " + field + " must be non-empty");
    }
  }
  if (pattern.tags?.length < 2 || pattern.tags?.length > 10) {
    errors.push(pattern.id + ": tags must contain 2-10 values");
  }
  if (!["low", "medium", "high"].includes(pattern.evidenceStrength)) {
    errors.push(pattern.id + ": invalid evidenceStrength");
  }
  if (!TAXONOMY.status.includes(pattern.reviewStatus)) {
    errors.push(pattern.id + ": invalid reviewStatus");
  }
  if (pattern.reviewStatus === "reviewed") {
    if (!pattern.reviewedBy || !pattern.reviewedAt) {
      errors.push(pattern.id + ": reviewed patterns require reviewer and date");
    }
    if (pattern.reviewedBy === pattern.synthesizedBy) {
      errors.push(pattern.id + ": pattern reviewer must differ from synthesizer");
    }
  }
  for (const referenceId of [
    ...(pattern.examples || []),
    ...(pattern.counterexamples || []),
  ]) {
    if (!ids.has(referenceId)) {
      errors.push(pattern.id + ": unknown reference " + referenceId);
    }
  }
}

const counts = {
  total: records.length,
  reviewStatus: countBy(records, "reviewStatus"),
  primaryStratum: countBy(records, "primaryStratum"),
  platform: countBy(records, "platform"),
  surfaceFamily: countBy(records, "surfaceFamily"),
  multiStateFlow: records.filter((record) => record.multiStateFlow).length,
  ordinaryOrFailureProne: records.filter(
    (record) => record.ordinaryOrFailureProne,
  ).length,
  patterns: patterns.length,
  patternsReviewed: patterns.filter(
    (pattern) => pattern.reviewStatus === "reviewed",
  ).length,
  cacheManifests,
};

if (args.production) {
  if (records.length !== 600) {
    errors.push("production total must be 600, found " + records.length);
  }
  for (const [stratum, policy] of Object.entries(TAXONOMY.primaryStrata)) {
    if ((counts.primaryStratum[stratum] || 0) !== policy.productionTarget) {
      errors.push(
        "production stratum " +
          stratum +
          " must be " +
          policy.productionTarget +
          ", found " +
          (counts.primaryStratum[stratum] || 0),
      );
    }
  }
  for (const [surface, target] of Object.entries(TAXONOMY.surfaceFamilies)) {
    if ((counts.surfaceFamily[surface] || 0) !== target) {
      errors.push(
        "production surface " +
          surface +
          " must be " +
          target +
          ", found " +
          (counts.surfaceFamily[surface] || 0),
      );
    }
  }
  for (const [platform, target] of Object.entries(TAXONOMY.platformTargets)) {
    if ((counts.platform[platform] || 0) !== target) {
      errors.push(
        "production platform " +
          platform +
          " must be " +
          target +
          ", found " +
          (counts.platform[platform] || 0),
      );
    }
  }
  if (counts.multiStateFlow < 3) {
    errors.push("production library needs at least three multi-state flows");
  }
  if (counts.ordinaryOrFailureProne < 2) {
    errors.push("production library needs at least two ordinary/failure records");
  }
  if (counts.patternsReviewed < 24) {
    errors.push("production library needs at least 24 reviewed pattern cards");
  }
}

if (!records.length) {
  warnings.push("library has no records yet");
}
if (!patterns.length) warnings.push("library has no pattern cards yet");

const report = { ok: errors.length === 0, errors, warnings, counts };
console.log(JSON.stringify(report, null, 2));
process.exitCode = errors.length ? 1 : 0;
