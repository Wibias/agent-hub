// Provider evidence journal v2 is a SIDE-CAR. The DWA findings-ledger.json v1 is never rewritten.
import { createHash } from "node:crypto";
import {
  existsSync, lstatSync, readFileSync, renameSync, unlinkSync, writeFileSync,
} from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { readLedger } from "../findings-ledger.mjs";
import { assertFusion } from "./fuse.mjs";

const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const filled = (s) => typeof s === "string" && s.trim().length > 0;
const object = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const kinds = new Set(["NAVIGATION", "WORKFLOW", "DETAIL", "VISUAL", "OTHER"]);
const priorities = new Set(["HIGH", "MEDIUM", "LOW"]);
const decisions = new Set(["PROMOTE", "DISMISS", "DEFER"]);
const fields = ["id", "route", "kind", "priority", "symptom", "acceptance", "evidenceRef"];
const foundOf = (f) => Object.fromEntries(fields.map((key) => [key, f[key]]));

function safeReadFile(file, label) {
  const path = resolve(file);
  if (!existsSync(path) || !lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) {
    throw new Error(label + " missing or unsafe");
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

function saveNew(path, data) {
  const dest = resolve(path);
  if (!existsSync(dirname(dest))) throw new Error("Journal parent directory is missing");
  writeFileSync(dest, JSON.stringify(data, null, 2) + "\n", { flag: "wx" });
}

function saveUpdated(path, data) {
  const dest = resolve(path);
  const temp = dest + "." + process.pid + ".tmp";
  if (existsSync(temp)) throw new Error("Uncommitted journal temporary file already exists");
  writeFileSync(temp, JSON.stringify(data, null, 2) + "\n", { flag: "wx" });
  try { renameSync(temp, dest); }
  catch (error) {
    try { unlinkSync(temp); } catch {}
    throw new Error("Could not update provider journal: " + error.message);
  }
}

function legacyAnchor(legacy, path) {
  return {
    ledgerFile: basename(resolve(path)),
    eventCount: legacy.events.length,
    eventsSha256: hash(legacy.events),
  };
}

function validateAnchor(journal, legacyPath) {
  const anchor = journal.legacyAnchor;
  if (!object(anchor) || !Number.isInteger(anchor.eventCount) ||
      anchor.eventCount < 0 || !filled(anchor.eventsSha256) ||
      !filled(anchor.ledgerFile) || anchor.ledgerFile !== basename(resolve(legacyPath))) {
    throw new Error("Invalid legacy v1 ledger anchor");
  }
  const legacy = readLedger(legacyPath);
  if (legacy.events.length < anchor.eventCount ||
      hash(legacy.events.slice(0, anchor.eventCount)) !== anchor.eventsSha256) {
    throw new Error("Legacy v1 ledger prefix changed since provider journal creation");
  }
  return legacy;
}

function checkLegacyFinding(value, route) {
  if (!object(value) || !fields.every((key) => filled(value[key])) ||
      !kinds.has(value.kind) || !priorities.has(value.priority) ||
      value.route !== route) {
    throw new Error("PROMOTE requires a complete, route-matched v1 finding with reviewed acceptance");
  }
  return foundOf(value);
}

function validateEvent(event, previous, sequence, captures, adjudicated) {
  if (!object(event) || event.seq !== sequence || !filled(event.prevSha256) ||
      event.prevSha256 !== previous || !filled(event.sha256)) {
    throw new Error("Invalid append-only provider evidence event chain");
  }
  const { sha256, ...payload } = event;
  if (hash(payload) !== sha256) throw new Error("Provider journal event hash changed");
  if (event.type === "CAPTURED") {
    if (!filled(event.runId) || captures.has(event.runId) ||
        !filled(event.fusionSha256) || !object(event.fusion) ||
        event.fusionSha256 !== event.fusion.contentSha256) {
      throw new Error("Invalid or duplicate provider fusion capture");
    }
    assertFusion(event.fusion);
    captures.set(event.runId, event.fusion);
  } else if (event.type === "ADJUDICATED") {
    const fusion = captures.get(event.runId);
    const found = fusion?.groups.find((g) => g.id === event.groupId);
    const unique = event.runId + "\0" + event.groupId;
    if (!found || adjudicated.has(unique) ||
        !decisions.has(event.decision) || !filled(event.reason) ||
        !filled(event.evidenceRef)) {
      throw new Error("Invalid or repeated provider adjudication");
    }
    if (event.decision === "PROMOTE") {
      checkLegacyFinding(event.legacyFinding, found.route);
    } else if (event.legacyFinding !== undefined) {
      throw new Error("Only PROMOTE may specify a v1 finding");
    }
    adjudicated.add(unique);
  } else {
    throw new Error("Unexpected provider journal event type");
  }
  return sha256;
}

export function initializeEvidenceJournal(path, legacyPath) {
  if (existsSync(resolve(path))) throw new Error("Provider journal already exists; refusing reset");
  const legacy = readLedger(legacyPath);
  const journal = {
    schemaVersion: 2,
    kind: "dwa/provider-evidence-journal",
    legacyAnchor: legacyAnchor(legacy, legacyPath),
    events: [],
  };
  saveNew(path, journal);
  return readEvidenceJournal(path, legacyPath);
}

export function readEvidenceJournal(path, legacyPath) {
  const journal = safeReadFile(path, "Provider evidence journal");
  if (!object(journal) || journal.schemaVersion !== 2 ||
      journal.kind !== "dwa/provider-evidence-journal" || !Array.isArray(journal.events)) {
    throw new Error("Unsupported provider evidence journal schema");
  }
  validateAnchor(journal, legacyPath);
  const captures = new Map(), adjudicated = new Set();
  let previous = "GENESIS";
  for (const [i, event] of journal.events.entries()) {
    previous = validateEvent(event, previous, i + 1, captures, adjudicated);
  }
  return journal;
}

function append(path, legacyPath, source, addition) {
  const events = source.events;
  const last = events.at(-1);
  const payload = {
    seq: events.length + 1,
    prevSha256: last?.sha256 ?? "GENESIS",
    ...addition,
  };
  const event = { ...payload, sha256: hash(payload) };
  const updated = { ...source, events: [...events, event] };
  // Validate the full history AND the v1 prefix before replacing a ledger file.
  const captures = new Map(), adjudicated = new Set();
  let previous = "GENESIS";
  for (const [i, entry] of updated.events.entries()) {
    previous = validateEvent(entry, previous, i + 1, captures, adjudicated);
  }
  validateAnchor(updated, legacyPath);
  saveUpdated(path, updated);
  return event;
}

export function captureProviderFusion(path, legacyPath, { runId, fusion } = {}) {
  const journal = readEvidenceJournal(path, legacyPath);
  if (!filled(runId)) throw new Error("Capture requires runId");
  assertFusion(fusion);
  const prior = journal.events.find((e) => e.type === "CAPTURED" && e.runId === runId);
  if (prior) {
    if (prior.fusionSha256 !== fusion.contentSha256) {
      throw new Error("Run ID already captured different provider evidence; no rewrite");
    }
    return { idempotent: true, runId, groups: fusion.groups.length, sha256: prior.sha256 };
  }
  const event = append(path, legacyPath, journal, {
    type: "CAPTURED", runId, at: new Date().toISOString(),
    fusionSha256: fusion.contentSha256, fusion: structuredClone(fusion),
  });
  return { idempotent: false, runId, groups: fusion.groups.length, sha256: event.sha256 };
}

export function adjudicateProviderGroup(path, legacyPath, {
  runId, groupId, decision, reason, evidenceRef, legacyFinding,
} = {}) {
  const journal = readEvidenceJournal(path, legacyPath);
  const capture = journal.events.find((e) => e.type === "CAPTURED" && e.runId === runId);
  const group = capture?.fusion.groups.find((g) => g.id === groupId);
  if (!group || !decisions.has(decision) || !filled(reason) || !filled(evidenceRef)) {
    throw new Error("Adjudication needs a known run/group, disposition, reason and evidence");
  }
  if (decision === "PROMOTE") {
    checkLegacyFinding(legacyFinding, group.route);
  } else if (legacyFinding !== undefined) {
    throw new Error("Only PROMOTE may provide legacy finding metadata");
  }
  const prior = journal.events.find((e) =>
    e.type === "ADJUDICATED" && e.runId === runId && e.groupId === groupId);
  if (prior) {
    if (prior.decision === decision && prior.reason === reason &&
        prior.evidenceRef === evidenceRef &&
        JSON.stringify(prior.legacyFinding ?? null) === JSON.stringify(legacyFinding ?? null)) {
      return { idempotent: true, sha256: prior.sha256 };
    }
    throw new Error("Existing adjudication differs; refusing to rewrite history");
  }
  const event = append(path, legacyPath, journal, {
    type: "ADJUDICATED", runId, groupId, decision, reason, evidenceRef,
    at: new Date().toISOString(),
    ...(decision === "PROMOTE" ? { legacyFinding: foundOf(legacyFinding) } : {}),
  });
  return { idempotent: false, sha256: event.sha256 };
}

// Read-only bridge: only explicitly PROMOTEd groups are candidates. It never
// calls importFindings(), syncLedger(), or writes a legacy findings file.
export function previewLegacyImport(path, legacyPath, { runId } = {}) {
  const journal = readEvidenceJournal(path, legacyPath);
  const capture = journal.events.find((e) => e.type === "CAPTURED" && e.runId === runId);
  if (!capture) throw new Error("Unknown provider fusion runId");
  const legacy = readLedger(legacyPath);
  const historicalIds = new Set(legacy.events.filter((e) => e.type === "FOUND").map((e) => e.id));
  const used = new Set();
  const promoted = journal.events.filter((e) =>
    e.type === "ADJUDICATED" && e.runId === runId && e.decision === "PROMOTE");
  const findings = [];
  for (const e of promoted) {
    const f = checkLegacyFinding(e.legacyFinding,
      capture.fusion.groups.find((g) => g.id === e.groupId).route);
    if (historicalIds.has(f.id) || used.has(f.id)) {
      throw new Error("Promotion cannot reuse a historical or duplicate v1 finding ID: " + f.id);
    }
    used.add(f.id);
    findings.push(f);
  }
  return {
    findings,
    previewOnly: true,
    runId,
    legacyEventCount: legacy.events.length,
    requiresExplicitLegacyImport: true,
  };
}
