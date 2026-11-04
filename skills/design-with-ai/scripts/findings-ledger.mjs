#!/usr/bin/env node
// Project-local append-only UX findings. Assertions check durable history,
// not the truth of screenshots or the completeness of an initial human audit.
import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateIterationReceipt } from "./verify-iteration-receipt.mjs";

const object = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const filled = (x) => typeof x === "string" && x.trim().length > 0;
const kinds = new Set(["NAVIGATION", "WORKFLOW", "DETAIL", "VISUAL", "OTHER"]);
const priorities = new Set(["HIGH", "MEDIUM", "LOW"]);
const statuses = new Set([
  "RESOLVED", "IMPROVED_BUT_OPEN", "PERSISTS", "REGRESSED",
  "KEEP_JUSTIFIED", "DEFERRED", "UNVERIFIED",
]);
const hashEvents = (events) => createHash("sha256").update(JSON.stringify(events)).digest("hex");
const fields = ["id", "route", "kind", "priority", "symptom", "acceptance", "evidenceRef"];
const findingOf = (event) => Object.fromEntries(fields.map(k => [k, event[k]]));

function ensureSafeFile(path) {
  if (!existsSync(path)) throw new Error("Ledger missing; initialize or import findings before editing");
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Unsafe ledger path");
}

export function readLedger(path) {
  ensureSafeFile(path);
  const data = JSON.parse(readFileSync(resolve(path), "utf8"));
  const problems = [];
  if (!object(data) || data.schemaVersion !== 1 || !Array.isArray(data.events)) {
    throw new Error("Ledger requires schemaVersion 1 and an events array");
  }
  const known = new Set();
  for (const [index, event] of data.events.entries()) {
    if (!object(event)) { problems.push("event " + index + " is not an object"); continue; }
    if (event.type === "FOUND") {
      if (!fields.every(k => filled(event[k]))) problems.push("FOUND event missing required fields: " + index);
      if (!kinds.has(event.kind) || !priorities.has(event.priority)) {
        problems.push("FOUND event has invalid kind/priority: " + index);
      }
      if (known.has(event.id)) problems.push("duplicate historical finding id: " + event.id);
      known.add(event.id);
    } else if (event.type === "REVIEWED") {
      if (!known.has(event.id) || !filled(event.runId) ||
          !statuses.has(event.disposition) || !filled(event.reason) || !filled(event.evidenceRef)) {
        problems.push("invalid REVIEWED event: " + index);
      }
    } else {
      problems.push("unsupported ledger event type: " + index);
    }
  }
  if (problems.length) throw new Error(problems.join("; "));
  return data;
}

function saveLedger(path, data) {
  const output = resolve(path);
  const tmp = output + "." + process.pid + ".tmp";
  if (existsSync(tmp)) throw new Error("Temporary ledger output already exists");
  writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", { flag: "wx" });
  try { renameSync(tmp, output); }
  catch (error) { throw new Error("Cannot update ledger: " + error.message); }
}

export function initializeLedger(path) {
  const dest = resolve(path);
  if (existsSync(dest)) throw new Error("Ledger exists; refusing to reset durable history");
  const parent = dirname(dest);
  if (!existsSync(parent)) throw new Error("Create the project .design-with-ai directory first");
  writeFileSync(dest, JSON.stringify({ schemaVersion: 1, events: [] }, null, 2) + "\n", { flag: "wx" });
  return readLedger(dest);
}

export function importFindings(path, source) {
  const ledger = readLedger(path);
  if (!object(source) || !Array.isArray(source.findings)) throw new Error("Import needs findings[]");
  const existing = new Map(ledger.events.filter(e => e.type === "FOUND").map(e => [e.id, e]));
  let added = 0;
  for (const finding of source.findings) {
    if (!object(finding) || !fields.every(k => filled(finding[k])) ||
        !kinds.has(finding.kind) || !priorities.has(finding.priority)) {
      throw new Error("Import finding requires id, route, kind, priority, symptom, acceptance, evidenceRef");
    }
    const normalized = findingOf(finding);
    const prior = existing.get(finding.id);
    if (prior) {
      if (JSON.stringify(findingOf(prior)) !== JSON.stringify(normalized)) {
        throw new Error("Conflicting historical finding ID " + finding.id + "; do not silently overwrite");
      }
      continue;
    }
    ledger.events.push({ type: "FOUND", ...normalized });
    existing.set(finding.id, normalized);
    added++;
  }
  if (added) saveLedger(path, ledger);
  return { added, total: existing.size };
}

function knownFindings(events) {
  return events.filter(e => e.type === "FOUND").map(findingOf);
}
function uniqueRoutes(scope) {
  if (!Array.isArray(scope) || scope.length === 0 ||
      scope.some(s => !filled(s)) || new Set(scope).size !== scope.length) {
    throw new Error("Scope requires unique nonempty routes");
  }
}

export function makeLedgerBaseline(ledger, { scope, intent = "IMPROVE", runId = randomUUID() }) {
  uniqueRoutes(scope);
  if (!["IMPROVE", "RESTYLE", "SCOPED_COSMETIC"].includes(intent)) {
    throw new Error("Unsupported baseline intent");
  }
  if (!filled(runId)) throw new Error("runId required");
  const findings = knownFindings(ledger.events).filter(x => scope.includes(x.route));
  return {
    schemaVersion: 1,
    intent, scope, findings,
    ledgerSnapshot: {
      runId,
      eventCount: ledger.events.length,
      eventsSha256: hashEvents(ledger.events),
    },
  };
}

export function verifyLedgerCoverage(ledger, baseline, receipt, { requireSynced = true } = {}) {
  const problems = [];
  const fail = (s) => problems.push(s);
  const snapshot = baseline?.ledgerSnapshot;
  if (!object(snapshot) || !filled(snapshot.runId) ||
      !Number.isInteger(snapshot.eventCount) || snapshot.eventCount < 0 ||
      snapshot.eventCount > ledger.events.length || !filled(snapshot.eventsSha256)) {
    return { valid: false, problems: ["Missing or invalid durable ledgerSnapshot in baseline"] };
  }
  const priorEvents = ledger.events.slice(0, snapshot.eventCount);
  if (hashEvents(priorEvents) !== snapshot.eventsSha256) {
    fail("Historic findings ledger prefix changed after baseline was frozen");
  }
  const scope = Array.isArray(baseline?.scope) ? baseline.scope : [];
  try { uniqueRoutes(scope); } catch (e) { fail(e.message); }
  const prior = knownFindings(priorEvents).filter(x => scope.includes(x.route));
  const frozen = Array.isArray(baseline?.findings) ? baseline.findings : [];
  const baselineById = new Map(frozen.filter(object).map(x => [x.id, x]));
  if (baselineById.size !== frozen.length) fail("Duplicate baseline finding IDs");
  for (const item of prior) {
    const current = baselineById.get(item.id);
    if (!current || fields.some(k => current[k] !== item[k])) {
      fail("Durable prior finding missing or rewritten in baseline: " + item.id);
    }
  }
  for (const item of frozen) {
    if (!prior.some(x => x.id === item.id)) {
      fail("Baseline finding has no matching pre-edit ledger event: " + item.id);
    }
  }
  const later = ledger.events.slice(snapshot.eventCount);
  const runEvents = later.filter(e => e.type === "REVIEWED" && e.runId === snapshot.runId);
  const seen = new Set();
  for (const item of runEvents) {
    if (seen.has(item.id)) fail("Duplicate assessment for run: " + item.id);
    seen.add(item.id);
  }
  const finalFindings = Array.isArray(receipt?.findings) ? receipt.findings : [];
  const finalIds = new Set(finalFindings.map(x => x.id));
  const allNow = knownFindings(ledger.events);
  // A concurrent newly discovered finding on an in-scope route cannot
  // silently disappear from the current review.
  for (const item of allNow) {
    if (scope.includes(item.route) && !finalIds.has(item.id)) {
      fail("Current ledger finding omitted from final receipt: " + item.id);
    }
  }
  for (const item of finalFindings) {
    if (!allNow.some(x => x.id === item.id && x.route === item.route)) {
      fail("Final finding not persisted in durable ledger: " + item.id);
    }
    if (requireSynced) {
      const evt = runEvents.find(x => x.id === item.id);
      if (!evt || evt.disposition !== item.disposition) {
        fail("Final finding missing matching persisted run assessment: " + item.id);
      }
    }
  }
  if (requireSynced && runEvents.length !== finalFindings.length) {
    fail("Ledger run assessment count differs from receipt finding count");
  }
  return { valid: problems.length === 0, problems, priorCount: prior.length,
    assessedCount: runEvents.length, runId: snapshot.runId };
}

export function syncLedger(path, baseline, receipt) {
  const ledger = readLedger(path);
  const comparison = validateIterationReceipt(receipt, baseline);
  if (!comparison.valid) throw new Error("Receipt is invalid: " + comparison.problems.join("; "));
  const before = verifyLedgerCoverage(ledger, baseline, receipt, { requireSynced: false });
  if (!before.valid) {
    // New issues are legitimately absent before sync, but old ones may not be.
    const expectedNew = new Set((receipt.findings ?? []).map(x => x.id)
      .filter(id => !ledger.events.some(e => e.type === "FOUND" && e.id === id)));
    const genuine = before.problems.filter(p => ![...expectedNew].some(id =>
      p === "Final finding not persisted in durable ledger: " + id));
    if (genuine.length) throw new Error(genuine.join("; "));
  }
  const runId = baseline.ledgerSnapshot.runId;
  const existing = ledger.events.filter(x => x.type === "REVIEWED" && x.runId === runId);
  if (existing.length) {
    const result = verifyLedgerCoverage(ledger, baseline, receipt);
    if (!result.valid) throw new Error("Existing run assessment differs; refusing to rewrite history");
    return { added: 0, assessed: existing.length, idempotent: true };
  }
  const known = new Set(knownFindings(ledger.events).map(x => x.id));
  let added = 0;
  for (const f of receipt.findings) {
    if (!known.has(f.id)) {
      if (!fields.every(k => filled(f[k])) || !kinds.has(f.kind) || !priorities.has(f.priority)) {
        throw new Error("New finding " + f.id + " lacks history metadata");
      }
      ledger.events.push({ type: "FOUND", ...findingOf(f) });
      known.add(f.id);
      added++;
    }
    const reason = f.reassessment?.reason ?? f.reason ?? f.justification ??
      f.decision ?? "Reviewed current state";
    const evidenceRef = f.verification?.evidenceRef ?? f.reassessment?.evidenceRef ??
      f.after?.ref ?? f.evidenceRef;
    if (!filled(reason) || !filled(evidenceRef)) {
      throw new Error(f.id + ": review needs a reason and evidence reference");
    }
    ledger.events.push({
      type: "REVIEWED", runId, id: f.id, disposition: f.disposition,
      reason, evidenceRef,
    });
  }
  const verified = verifyLedgerCoverage(ledger, baseline, receipt);
  if (!verified.valid) throw new Error(verified.problems.join("; "));
  saveLedger(path, ledger);
  return { added, assessed: receipt.findings.length, idempotent: false };
}

export function isGitProject(start = process.cwd()) {
  let current = resolve(start);
  while (true) {
    if (existsSync(join(current, ".git"))) return true;
    const parent = dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

export function discoverProjectLedger(start = process.cwd()) {
  let current = resolve(start);
  while (true) {
    const candidate = join(current, ".design-with-ai", "findings-ledger.json");
    if (existsSync(candidate)) return candidate;
    if (existsSync(join(current, ".git"))) return null;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function cli() {
  const args = process.argv.slice(2);
  const command = args.shift();
  const opts = new Map();
  for (let i = 0; i < args.length; i += 2) {
    if (!/^--[\w-]+$/.test(args[i]) || !filled(args[i+1]) || opts.has(args[i])) {
      throw new Error("Expected unique --option value pairs");
    }
    opts.set(args[i], args[i+1]);
  }
  const ledgerPath = opts.get("--ledger");
  if (!ledgerPath) throw new Error("Usage: findings-ledger.mjs init|import|snapshot|sync|check --ledger <json> [options]");
  if (command === "init") { initializeLedger(ledgerPath); return { initialized: true }; }
  if (command === "import") {
    return importFindings(ledgerPath, JSON.parse(readFileSync(resolve(opts.get("--source")), "utf8")));
  }
  const ledger = readLedger(ledgerPath);
  if (command === "snapshot") {
    const scope = opts.get("--scope")?.split(",").map(x => x.trim());
    const baseline = makeLedgerBaseline(ledger, { scope, intent: opts.get("--intent") || "IMPROVE" });
    const output = resolve(opts.get("--baseline"));
    if (existsSync(output)) throw new Error("Snapshot file exists; never overwrite a frozen baseline");
    writeFileSync(output, JSON.stringify(baseline, null, 2) + "\n", { flag: "wx" });
    return { baseline: output, carried: baseline.findings.map(x => x.id), runId: baseline.ledgerSnapshot.runId };
  }
  const baseline = JSON.parse(readFileSync(resolve(opts.get("--baseline")), "utf8"));
  const receipt = JSON.parse(readFileSync(resolve(opts.get("--receipt")), "utf8"));
  if (command === "sync") return syncLedger(ledgerPath, baseline, receipt);
  if (command === "check") return verifyLedgerCoverage(ledger, baseline, receipt);
  throw new Error("Unknown ledger command");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = cli();
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    if (result.valid === false) process.exitCode = 1;
  } catch (e) {
    process.stderr.write("Findings ledger: " + e.message + "\n");
    process.exitCode = 2;
  }
}
