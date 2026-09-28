import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const DATA_DIR = join(ROOT, "data");
export const PATTERN_DIR = join(ROOT, "patterns");
export const TAXONOMY = JSON.parse(
  readFileSync(join(ROOT, "taxonomy.json"), "utf8"),
);

export const REQUIRED_FIELDS = [
  "id", "title", "canonicalUrl", "product", "surfaceFamily",
  "primaryStratum", "platform", "flowStates", "evidenceClass",
  "accessStatus", "accessMethod", "storagePolicy", "pageRole",
  "firstScreenJob", "topology", "traversal", "density",
  "responsiveBehavior", "motion", "visualWorld", "strengths",
  "weaknesses", "transferableDecisions", "tags", "sourceFamily",
  "sourceKind", "observedAt", "lastVerifiedAt", "ttlDays",
  "reviewStatus", "researchedBy", "reviewedBy", "reviewedAt",
  "rightsNote", "provenanceNote", "ordinaryOrFailureProne",
  "multiStateFlow", "replacementFor",
];

const ARRAY_FIELDS = [
  "flowStates",
  "strengths",
  "weaknesses",
  "transferableDecisions",
  "tags",
];

const STRING_FIELDS = REQUIRED_FIELDS.filter(
  (field) =>
    !ARRAY_FIELDS.includes(field) &&
    ![
      "ttlDays",
      "ordinaryOrFailureProne",
      "multiStateFlow",
      "reviewedBy",
      "reviewedAt",
      "replacementFor",
    ].includes(field),
);

export function parseArgs(argv) {
  const parsed = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      parsed._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
      continue;
    }
    parsed[key] = next;
    index += 1;
  }
  return parsed;
}

export function listJsonlFiles(directory = DATA_DIR) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && extname(entry.name) === ".jsonl")
    .map((entry) => join(directory, entry.name))
    .sort();
}

export function readJsonl(file) {
  const lines = readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim());
  return lines.map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(
        file + ":" + (index + 1) + " invalid JSON: " + error.message,
      );
    }
  });
}

export function loadRecords(directory = DATA_DIR) {
  return listJsonlFiles(directory).flatMap((file) =>
    readJsonl(file).map((record) => ({ ...record, __file: file })),
  );
}

export function loadPatterns(directory = PATTERN_DIR) {
  return listJsonlFiles(directory).flatMap((file) =>
    readJsonl(file).map((pattern) => ({ ...pattern, __file: file })),
  );
}

export function writeJsonl(file, records) {
  const payload =
    records.map((record) => JSON.stringify(stripInternal(record))).join("\n") +
    "\n";
  writeFileSync(file, payload, "utf8");
}

export function stripInternal(record) {
  return Object.fromEntries(
    Object.entries(record).filter(([key]) => !key.startsWith("__")),
  );
}

export function normalizeUrl(value) {
  const url = new URL(value);
  url.hash = "";
  const entries = [...url.searchParams.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  );
  url.search = "";
  for (const [key, item] of entries) url.searchParams.append(key, item);
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.toString();
}

export function duplicateKey(record) {
  const states = [...record.flowStates]
    .map((state) => state.trim().toLowerCase())
    .sort()
    .join("|");
  return normalizeUrl(record.canonicalUrl) + "::" + states;
}

export function analysisSignature(record) {
  const normalized = [
    record.pageRole,
    record.firstScreenJob,
    record.topology,
    record.traversal,
    record.responsiveBehavior,
    record.motion,
    record.visualWorld,
    ...record.transferableDecisions,
  ]
    .join("|")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  return createHash("sha256").update(normalized).digest("hex");
}

export function daysSince(date, now = new Date()) {
  const parsed = new Date(date + "T00:00:00Z");
  return Math.floor((now.getTime() - parsed.getTime()) / 86_400_000);
}

export function isFresh(record, now = new Date()) {
  return daysSince(record.lastVerifiedAt, now) <= record.ttlDays;
}

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const parsed = new Date(value + "T00:00:00Z");
  return !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value;
}

export function validateRecord(record, options = {}) {
  const errors = [];
  const keys = Object.keys(record).filter((key) => !key.startsWith("__"));
  const extras = keys.filter((key) => !REQUIRED_FIELDS.includes(key));
  for (const field of REQUIRED_FIELDS) {
    if (!(field in record)) errors.push("missing " + field);
  }
  if (extras.length) errors.push("unexpected fields: " + extras.join(", "));

  for (const field of STRING_FIELDS) {
    if (typeof record[field] !== "string" || !record[field].trim()) {
      errors.push(field + " must be a non-empty string");
    }
  }
  for (const field of ARRAY_FIELDS) {
    if (
      !Array.isArray(record[field]) ||
      record[field].length === 0 ||
      record[field].some((value) => typeof value !== "string" || !value.trim())
    ) {
      errors.push(field + " must be a non-empty string array");
    } else if (new Set(record[field]).size !== record[field].length) {
      errors.push(field + " must not contain duplicate values");
    }
  }
  if (!/^ref-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(record.id || "")) {
    errors.push("id must be a stable ref- kebab slug");
  }
  try {
    if (!normalizeUrl(record.canonicalUrl).startsWith("https://")) {
      errors.push("canonicalUrl must use https");
    }
  } catch {
    errors.push("canonicalUrl must be a valid URL");
  }
  if (!(record.surfaceFamily in TAXONOMY.surfaceFamilies)) {
    errors.push("unknown surfaceFamily");
  }
  if (!(record.primaryStratum in TAXONOMY.primaryStrata)) {
    errors.push("unknown primaryStratum");
  }
  if (!(record.platform in TAXONOMY.platformTargets)) {
    errors.push("unknown platform");
  }
  if (!TAXONOMY.evidenceClasses.includes(record.evidenceClass)) {
    errors.push("unknown evidenceClass");
  }
  if (!TAXONOMY.accessStatuses.includes(record.accessStatus)) {
    errors.push("unknown accessStatus");
  }
  if (!TAXONOMY.sourceKinds.includes(record.sourceKind)) {
    errors.push("unknown sourceKind");
  }
  if (!["text-link-only", "local-cache-permitted"].includes(record.storagePolicy)) {
    errors.push("unknown storagePolicy");
  }
  if (!["low", "medium", "high"].includes(record.density)) {
    errors.push("unknown density");
  }
  const supportedTtlDays = new Set(Object.values(TAXONOMY.ttlDays));
  if (!supportedTtlDays.has(record.ttlDays)) {
    errors.push("ttlDays must use a supported policy value");
  }
  if (!TAXONOMY.status.includes(record.reviewStatus)) {
    errors.push("unknown reviewStatus");
  }
  if (record.tags?.length < 3 || record.tags?.length > 10) {
    errors.push("tags must contain 3-10 values");
  }
  if (typeof record.ordinaryOrFailureProne !== "boolean") {
    errors.push("ordinaryOrFailureProne must be boolean");
  }
  if (typeof record.multiStateFlow !== "boolean") {
    errors.push("multiStateFlow must be boolean");
  }
  for (const field of ["observedAt", "lastVerifiedAt"]) {
    if (!isIsoDate(record[field])) {
      errors.push(field + " must be YYYY-MM-DD");
    }
  }
  if (
    isIsoDate(record.observedAt) &&
    isIsoDate(record.lastVerifiedAt) &&
    record.observedAt > record.lastVerifiedAt
  ) {
    errors.push("observedAt must not be after lastVerifiedAt");
  }
  if (record.reviewedAt !== null && !isIsoDate(record.reviewedAt)) {
    errors.push("reviewedAt must be null or YYYY-MM-DD");
  }
  if (
    record.replacementFor !== null &&
    !/^ref-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(record.replacementFor || "")
  ) {
    errors.push("replacementFor must be null or a reference id");
  }
  if (record.replacementFor === record.id) {
    errors.push("replacementFor must refer to a different record");
  }
  if (record.reviewStatus === "reviewed") {
    if (!record.reviewedBy || !record.reviewedAt) {
      errors.push("reviewed records require reviewedBy and reviewedAt");
    }
    if (record.reviewedBy === record.researchedBy) {
      errors.push("reviewer must differ from researcher");
    }
  }
  if (
    record.storagePolicy === "local-cache-permitted" &&
    !/permit|allowed|owned|license|terms/i.test(record.rightsNote || "")
  ) {
    errors.push("cache permission needs an explicit rights basis");
  }
  if (options.requireReviewed && record.reviewStatus !== "reviewed") {
    errors.push("production records must be reviewed");
  }
  return errors;
}

export function countBy(records, field) {
  return records.reduce((counts, record) => {
    const value = String(record[field]);
    counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {});
}

export function tokenize(value) {
  return new Set(
    String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 1),
  );
}

export function overlap(left, right) {
  let score = 0;
  for (const token of left) {
    if (right.has(token)) score += 1;
  }
  return score;
}

export function recordSearchText(record) {
  return [
    record.title,
    record.product,
    record.surfaceFamily,
    record.pageRole,
    record.firstScreenJob,
    record.topology,
    record.traversal,
    record.responsiveBehavior,
    record.motion,
    record.visualWorld,
    ...record.flowStates,
    ...record.strengths,
    ...record.weaknesses,
    ...record.transferableDecisions,
    ...record.tags,
  ].join(" ");
}
