import { TAXONOMY } from "./lib.mjs";

const VERDICTS = new Set(["confirm", "stale", "archive"]);
const ID_RE = /^ref-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function requireObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(name + " must be an object");
  }
  return value;
}

function requireString(value, name) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(name + " must be a non-empty string");
  }
  return value.trim();
}

function requireDate(value, name) {
  const date = requireString(value, name);
  if (!DATE_RE.test(date)) {
    throw new TypeError(name + " must be YYYY-MM-DD");
  }
  const parsed = new Date(date + "T00:00:00Z");
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new TypeError(name + " must be YYYY-MM-DD");
  }
  return date;
}

function requireChecked(value, name) {
  if (value !== true) {
    throw new TypeError(name + " must be true");
  }
  return true;
}

export function validateRevalidationDecision(input) {
  const decision = requireObject(input, "decision");
  const id = requireString(decision.id, "decision.id");
  if (!ID_RE.test(id)) {
    throw new TypeError("decision.id must be a stable ref- kebab slug");
  }

  const verdict = requireString(decision.verdict, "decision.verdict");
  if (!VERDICTS.has(verdict)) {
    throw new TypeError("decision.verdict must be confirm, stale, or archive");
  }

  const accessStatus = requireString(decision.accessStatus, "decision.accessStatus");
  if (!TAXONOMY.accessStatuses.includes(accessStatus)) {
    throw new TypeError("decision.accessStatus is not supported");
  }

  const notes = requireString(decision.notes, "decision.notes");
  if (notes.length < 8) {
    throw new TypeError("decision.notes must be substantive");
  }

  return {
    id,
    verdict,
    verifiedAt: requireDate(decision.verifiedAt, "decision.verifiedAt"),
    verifier: requireString(decision.verifier, "decision.verifier"),
    sourceChecked: requireChecked(decision.sourceChecked, "decision.sourceChecked"),
    analysisChecked: requireChecked(decision.analysisChecked, "decision.analysisChecked"),
    rightsChecked: requireChecked(decision.rightsChecked, "decision.rightsChecked"),
    accessStatus,
    notes,
  };
}

export function applyRevalidationDecisions(records, decisions) {
  if (!Array.isArray(records)) throw new TypeError("records must be an array");
  if (!Array.isArray(decisions)) throw new TypeError("decisions must be an array");

  const recordIds = new Set();
  for (const record of records) {
    requireObject(record, "record");
    const id = requireString(record.id, "record.id");
    if (recordIds.has(id)) throw new Error("duplicate record id: " + id);
    recordIds.add(id);
  }

  const normalized = new Map();
  for (const input of decisions) {
    const decision = validateRevalidationDecision(input);
    if (normalized.has(decision.id)) {
      throw new Error("duplicate revalidation decision: " + decision.id);
    }
    if (!recordIds.has(decision.id)) {
      throw new Error("unknown revalidation decision id: " + decision.id);
    }
    normalized.set(decision.id, decision);
  }

  const summary = {
    total_records: records.length,
    decision_count: normalized.size,
    confirmed: 0,
    stale: 0,
    archived: 0,
    untouched: records.length - normalized.size,
  };

  const output = records.map((record) => {
    const decision = normalized.get(record.id);
    if (!decision) return record;
    if (record.reviewStatus !== "reviewed") {
      throw new Error("revalidation requires an existing reviewed record: " + record.id);
    }

    const nextStatus = {
      confirm: "reviewed",
      stale: "stale",
      archive: "archived",
    }[decision.verdict];

    if (decision.verdict === "confirm") summary.confirmed += 1;
    if (decision.verdict === "stale") summary.stale += 1;
    if (decision.verdict === "archive") summary.archived += 1;

    return {
      ...record,
      lastVerifiedAt: decision.verifiedAt,
      accessStatus: decision.accessStatus,
      reviewStatus: nextStatus,
    };
  });

  return { records: output, summary };
}
