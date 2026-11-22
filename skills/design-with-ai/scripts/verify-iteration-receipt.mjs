#!/usr/bin/env node
// Checks internal consistency of a design iteration handoff. It cannot authenticate
// screenshots, source claims, or real behavior; the human/render review remains required.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateDesktopRenderEvidence } from "./desktop-render-evidence.mjs";

const dispositions = new Set([
  "RESOLVED", "IMPROVED_BUT_OPEN", "PERSISTS", "REGRESSED",
  "KEEP_JUSTIFIED", "DEFERRED", "UNVERIFIED",
]);
const closed = new Set(["RESOLVED", "KEEP_JUSTIFIED"]);
const verdicts = new Set(["COMPLETE", "PARTIAL", "NOT_VERIFIED"]);
const semanticVerdicts = new Set(["PASS", "REVISE", "NOT_VERIFIED"]);
const semanticKinds = ["phase", "filter", "count", "readiness", "action"];
const interactionKinds = new Set(["filter", "count", "readiness", "action"]);
const reliableMethods = new Set(["RUNTIME", "TEST"]);
const populated = (v) => typeof v === "string" && v.trim().length > 0;
const record = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function matchedCandidate(before, after) {
  return ["route", "viewport", "stateKey", "dataKey"].every(
    (key) => populated(before?.[key]) && before[key] === after?.[key],
  );
}

// A separate pre-edit baseline is supplied by the task/previous review.
 // It is intentionally not sourced from the post-edit receipt being judged.
export function validateIterationReceipt(input, baseline = null, desktopEvidence = null) {
  const problems = [];
  const fail = (message) => problems.push(message);
  if (!record(input) || input.schemaVersion !== 1) {
    return { valid: false, verdict: null, problems: ["Expected schemaVersion: 1 receipt object"] };
  }

  if (input.requiresPriorBaseline === true && baseline === null) {
    fail("iterative receipt requires an independent pre-edit baseline");
  }
  const scope = Array.isArray(input.scope) ? input.scope : [];
  const findings = Array.isArray(input.findings) ? input.findings : [];
  const carryover = Array.isArray(input.openCarryover) ? input.openCarryover : [];
  if (scope.length === 0) fail("scope must list at least one route or component");
  if (!Array.isArray(input.findings)) fail("findings must be an array");
  if (!Array.isArray(input.openCarryover)) fail("openCarryover must be an array");
  if (!verdicts.has(input.iterationVerdict)) fail("iterationVerdict must be COMPLETE, PARTIAL or NOT_VERIFIED");

  const scoped = new Set();
  for (const item of scope) {
    if (!record(item) || !populated(item.route)) {
      fail("every scope entry requires a nonempty route"); continue;
    }
    if (scoped.has(item.route)) fail("duplicate scope route: " + item.route);
    scoped.add(item.route);
    if (!populated(item.task)) fail(item.route + ": missing user task");
    if (!["INSPECTED", "DEFERRED", "NOT_INSPECTED"].includes(item.coverage)) {
      fail(item.route + ": invalid coverage");
    }
    if (item.coverage !== "INSPECTED" && !populated(item.coverageReason)) {
      fail(item.route + ": uninspected/deferred coverage requires a reason");
    }
    const semantics = item.semantics;
    if (!record(semantics) || typeof semantics.applicable !== "boolean") {
      fail(item.route + ": explicitly classify whether workflow semantics applies");
      continue;
    }
    if (!semantics.applicable) {
      if (!populated(semantics.reason)) fail(item.route + ": non-applicable semantics needs rationale");
      continue;
    }
    if (!semanticVerdicts.has(semantics.verdict)) fail(item.route + ": invalid semantics verdict");
    if (semantics.verdict === "PASS") {
      if (!populated(semantics.contractSource)) fail(item.route + ": PASS semantics needs a product contract source");
      const checks = Array.isArray(semantics.checks) ? semantics.checks : [];
      for (const kind of semanticKinds) {
        const matches = checks.filter((check) => record(check) && check.kind === kind);
        if (matches.length !== 1) {
          fail(item.route + ": PASS semantics needs exactly one " + kind + " check");
          continue;
        }
        const check = matches[0];
        if (check.result !== "PASS" || !populated(check.evidenceRef)) {
          fail(item.route + ": PASS " + kind + " requires passing evidence");
        }
        if (interactionKinds.has(kind) && !reliableMethods.has(check.method)) {
          fail(item.route + ": " + kind + " requires RUNTIME/TEST evidence, not a screenshot-only claim");
        }
      }
      const states = Array.isArray(semantics.testedStates) ? semantics.testedStates : [];
      if (states.length < 2 || states.some((v) => !populated(v))) {
        fail(item.route + ": PASS semantics needs at least two named representative states");
      }
    } else if (!populated(semantics.reason)) {
      fail(item.route + ": unresolved semantics needs a concrete reason");
    }
  }

  const seenFindings = new Set();
  const open = new Set();
  for (const item of findings) {
    if (!record(item) || !populated(item.id)) { fail("finding requires a stable id"); continue; }
    if (seenFindings.has(item.id)) fail("duplicate finding id: " + item.id);
    seenFindings.add(item.id);
    if (!scoped.has(item.route)) fail(item.id + ": finding route not in scope");
    for (const field of ["symptom", "acceptance", "decision"]) {
      if (!populated(item[field])) fail(item.id + ": missing " + field);
    }
    if (!dispositions.has(item.disposition)) {
      fail(item.id + ": invalid disposition");
      continue;
    }
    if (!closed.has(item.disposition)) open.add(item.id);
    if (item.disposition === "RESOLVED") {
      if (!record(item.before) || !record(item.after) ||
          !populated(item.before.ref) || !populated(item.after.ref) ||
          !matchedCandidate(item.before, item.after)) {
        fail(item.id + ": RESOLVED requires matched before/after route, viewport, stateKey, dataKey and evidence refs");
      }
      if (!record(item.verification) || item.verification.result !== "PASS" ||
          !populated(item.verification.evidenceRef)) {
        fail(item.id + ": RESOLVED requires a passing acceptance check with evidence");
      }
    } else if (item.disposition === "KEEP_JUSTIFIED") {
      if (!populated(item.justification) || !populated(item.after?.ref)) {
        fail(item.id + ": KEEP_JUSTIFIED needs a reason and inspected current-state reference");
      }
    } else if (!populated(item.reason)) {
      fail(item.id + ": an open/deferred finding needs a reason");
    }
  }

  if (new Set(carryover).size !== carryover.length ||
      carryover.some((id) => !populated(id))) fail("openCarryover must contain unique nonempty finding IDs");
  for (const id of open) if (!carryover.includes(id)) fail("open finding omitted from carryover: " + id);
  for (const id of carryover) if (!open.has(id)) fail("carryover references closed/unknown finding: " + id);


  // Historical repetition is determined by the ledger. A supplied action
  // must name real code and render evidence, or an explicit unresolved
  // blocker. This is a consistency check, not a source-diff verifier.
  if (input.persistentRepairActions !== undefined) {
    if (!Array.isArray(input.persistentRepairActions)) {
      fail("persistentRepairActions must be an array");
    } else {
      const actionIds = new Set();
      for (const action of input.persistentRepairActions) {
        if (!record(action) || !populated(action.findingId)) {
          fail("persistentRepairActions entry requires a findingId"); continue;
        }
        if (actionIds.has(action.findingId)) fail("duplicate persistent repair action " + action.findingId);
        actionIds.add(action.findingId);
        const finding = findings.find(x => x?.id === action.findingId);
        if (!finding || closed.has(finding.disposition)) {
          fail("persistent repair action must reference an open finding: " + action.findingId);
          continue;
        }
        if (action.action === "SOURCE_REPAIR") {
          const summary = input.changeSummary;
          if (!record(summary) || summary.kind !== "TASK_REPAIR" ||
              !summary.addressedFindingIds?.includes(action.findingId) ||
              !populated(summary.evidenceRef) ||
              !populated(action.sourceFile) ||
              !/\.(?:cs|xaml|resx|tsx|jsx|ts|js|css|html)$/i.test(action.sourceFile) ||
              !populated(action.beforeRef) || !populated(action.afterRef) ||
              action.beforeRef === action.afterRef ||
              !["PASS", "REVISE", "NOT_VERIFIED"].includes(action.renderResult)) {
            fail("SOURCE_REPAIR_UNPROVEN " + action.findingId +
              ": require addressed source edit, separate before/after refs and truthful render outcome");
          }
        } else if (action.action === "BLOCKED") {
          if (!populated(action.blocker) || !populated(action.nextStep) ||
              input.iterationVerdict === "COMPLETE") {
            fail("REPAIR_BLOCKER_UNEXPLAINED " + action.findingId +
              ": document actual constraint and next action; keep verdict incomplete");
          }
        } else {
          fail("Unsupported persistent repair action for " + action.findingId);
        }
      }
    }
  }

  if (baseline !== null) {
    const baselineIssues = Array.isArray(baseline?.findings) ? baseline.findings : [];
    const baselineScope = Array.isArray(baseline?.scope) ? baseline.scope : [];
    const intent = baseline?.intent;
    if (!record(baseline) || baseline.schemaVersion !== 1 ||
        !["IMPROVE", "RESTYLE", "SCOPED_COSMETIC"].includes(intent)) {
      fail("baseline must declare schemaVersion: 1 and a supported intent");
    }
    if (baselineScope.length === 0 || baselineScope.some((route) => !populated(route)) ||
        new Set(baselineScope).size !== baselineScope.length) {
      fail("baseline scope must contain unique nonempty in-scope routes");
    }
    const priorIds = new Set();
    const priorById = new Map();
    for (const issue of baselineIssues) {
      if (!record(issue) || !populated(issue.id)) {
        fail("baseline finding requires a stable id");
        continue;
      }
      if (priorIds.has(issue.id)) fail("duplicate baseline finding id: " + issue.id);
      priorIds.add(issue.id);
      priorById.set(issue.id, issue);
      if (!baselineScope.includes(issue.route)) fail(issue.id + ": baseline route not in baseline scope");
      if (!["HIGH", "MEDIUM", "LOW"].includes(issue.priority) ||
          !populated(issue.symptom) || !populated(issue.acceptance) ||
          !populated(issue.evidenceRef) ||
          !["NAVIGATION", "WORKFLOW", "DETAIL", "VISUAL", "OTHER"].includes(issue.kind)) {
        fail(issue.id + ": baseline needs kind, priority, symptom, acceptance and evidenceRef");
      }
      const matching = findings.filter((f) => f?.id === issue.id);
      if (matching.length !== 1) {
        fail("prior finding missing from final receipt: " + issue.id);
        continue;
      }
      const current = matching[0];
      // Stable IDs identify the original issue, not a free slot for later UI
      // observations. Priority, resolution and evidence may evolve.
      const identityFields = ["route", "kind", "symptom", "acceptance"];
      if (identityFields.some(key => current[key] !== issue[key])) {
        fail(issue.id + ": FINDING_IDENTITY_CHANGED: original route/kind/symptom/acceptance changed; allocate a new ID");
      }
      if (current.disposition === "RESOLVED" &&
          ["NAVIGATION", "WORKFLOW"].includes(issue.kind) &&
          !reliableMethods.has(current.verification?.method)) {
        fail(issue.id + ": navigation/workflow resolution needs TEST or RUNTIME behavior evidence");
      }
      if (current.disposition === "KEEP_JUSTIFIED") {
        if (!record(current.reassessment) ||
            !populated(current.reassessment.reason) ||
            !populated(current.reassessment.evidenceRef)) {
          fail(issue.id + ": a pre-existing defect cannot become KEEP_JUSTIFIED without reassessment evidence");
        }
        if (["NAVIGATION", "WORKFLOW"].includes(issue.kind) &&
            !reliableMethods.has(current.reassessment?.method)) {
          fail(issue.id + ": navigation/workflow KEEP_JUSTIFIED needs TEST or RUNTIME reassessment of actual behavior");
        }
      }
    }
    for (const route of baselineScope) {
      if (!scoped.has(route)) fail("baseline scope omitted from final receipt: " + route);
    }
    const summary = input.changeSummary;
    if (!record(summary) ||
        !["TASK_REPAIR", "COSMETIC_ONLY", "NO_CHANGE"].includes(summary.kind) ||
        !populated(summary.rationale)) {
      fail("baseline comparison requires changeSummary with kind and rationale");
    } else {
      const addressed = Array.isArray(summary.addressedFindingIds) ? summary.addressedFindingIds : [];
      if (new Set(addressed).size !== addressed.length ||
          addressed.some((id) => !populated(id) || !priorById.has(id))) {
        fail("changeSummary addressedFindingIds must be unique known baseline IDs");
      }
      if (summary.kind === "TASK_REPAIR" && addressed.length === 0) {
        fail("TASK_REPAIR must name at least one addressed prior finding");
      }
      if (summary.kind !== "TASK_REPAIR" && addressed.length > 0) {
        fail("only TASK_REPAIR may claim addressed prior findings");
      }
      if (summary.kind === "TASK_REPAIR" && !populated(summary.evidenceRef)) {
        fail("TASK_REPAIR needs actual implementation or runtime evidence");
      }
      const highOpen = baselineIssues.some((issue) => record(issue) && issue.priority === "HIGH" &&
        findings.some((f) => f?.id === issue.id && !closed.has(f.disposition)));

      // In a broad IMPROVE run, older medium/high findings retain priority
      // even when their latest status is UNVERIFIED or DEFERRED. Those statuses
      // require investigation or a documented deferral, NOT speculative edits.
      // Only evidenced closure removes an old finding from this priority set.
      const prioritized = baselineIssues.filter(issue => record(issue) &&
        ["HIGH", "MEDIUM"].includes(issue.priority) &&
        findings.some(f => f?.id === issue.id &&
          !closed.has(f.disposition)));
      const addressedPriority = prioritized.some(issue => addressed.includes(issue.id));
      const cosmeticDetour = intent === "IMPROVE" && prioritized.length > 0 &&
        (summary.kind === "COSMETIC_ONLY" ||
          (summary.kind === "TASK_REPAIR" && !addressedPriority));
      if (cosmeticDetour) {
        const deferrals = Array.isArray(input.priorityDeferrals) ? input.priorityDeferrals : [];
        const seenDeferrals = new Set();
        for (const exception of deferrals) {
          if (!record(exception) || !populated(exception.findingId) ||
              seenDeferrals.has(exception.findingId)) {
            fail("priorityDeferrals requires distinct findingIds"); continue;
          }
          seenDeferrals.add(exception.findingId);
        }
        for (const issue of prioritized) {
          const exception = deferrals.find(x => x?.findingId === issue.id);
          if (!exception || !["EXPLICIT_USER_SCOPE", "BLOCKED", "DEPENDENCY"].includes(exception.basis) ||
              !populated(exception.reason) || !populated(exception.evidenceRef) ||
              (exception.basis === "BLOCKED" && !populated(exception.nextStep))) {
            fail("UNRESOLVED_FINDING_DEPRIORITIZED " + issue.id +
              ": address the older medium/high finding first, or document an explicit requested scope/dependency/real blocker with evidence");
          }
        }
      }

      if (intent === "IMPROVE" && summary.kind === "COSMETIC_ONLY" && highOpen &&
          !Array.isArray(input.priorityDeferrals)) {
        fail("IMPROVE cannot substitute cosmetic-only changes for unresolved HIGH prior findings");
      }
      if (input.iterationVerdict === "COMPLETE" && summary.kind === "COSMETIC_ONLY" &&
          intent === "IMPROVE" && baselineIssues.length > 0) {
        fail("IMPROVE cannot claim prior finding closure from cosmetic changes alone");
      }
    }
  }

  if (input.iterationVerdict === "COMPLETE") {
    for (const item of scope) {
      if (!record(item)) continue;
      if (item.coverage !== "INSPECTED") fail(item.route + ": COMPLETE cannot include uninspected/deferred scope");
      if (!findings.some((f) => f.route === item.route)) {
        fail(item.route + ": COMPLETE requires at least one disposition (including KEEP_JUSTIFIED)");
      }
      if (item.semantics?.applicable && item.semantics.verdict !== "PASS") {
        fail(item.route + ": COMPLETE cannot claim unverified/failed workflow semantics");
      }
    }
    for (const id of open) fail("COMPLETE cannot include open finding: " + id);
    if (!record(input.gates) || !["PASS"].every((v) =>
      input.gates.render === v && input.gates.functional === v)) {
      fail("COMPLETE requires passing functional and rendered checks");
    }
  } else if (!populated(input.verdictReason)) {
    fail("PARTIAL/NOT_VERIFIED requires verdictReason");
  }

  let desktopEvidenceChecked = false;
  // Closure is a distinct claim from the overall verdict. A PARTIAL receipt
  // may honestly carry open visual issues, but it must not silently close
  // existing visual/detail findings based only on source edits or old screenshots.
  const visuallyClosed = findings.filter(f => {
    if (!record(f) || !closed.has(f.disposition)) return false;
    const historic = Array.isArray(baseline?.findings)
      ? baseline.findings.find(x => x?.id === f.id) : null;
    const kind = historic?.kind ?? f.kind;
    return !["WORKFLOW", "NAVIGATION"].includes(kind);
  });
  if (input.surfaceKind === "DENSE_DESKTOP_MONITOR") {
    // A PARTIAL overall result does not authorize a detached visual PASS.
    // If any rendered QA is claimed as PASS, bind it to current source and
    // the minimally inspected compact KPI state, even without full E2E.
    if (input.gates?.render === "PASS" && desktopEvidence?.schemaVersion !== 2) {
      fail("DESKTOP_RENDER_PASS_UNBOUND: reported render PASS requires a current v2 compact KPI screenshot and measurements even in PARTIAL");
    }
    if (desktopEvidence === null) {
      if (input.iterationVerdict === "COMPLETE") {
        fail("Dense desktop monitor COMPLETE requires final render evidence");
      }
      for (const f of visuallyClosed) {
        fail("VISUAL_CLOSURE_UNVERIFIED " + f.id +
          ": a visually closed finding needs current, multi-viewport rendered evidence even in PARTIAL");
      }
    } else {
      const desktop = validateDesktopRenderEvidence(desktopEvidence, input);
      desktopEvidenceChecked = desktop.valid;
      if (!desktop.valid) problems.push(...desktop.problems.map(x => "desktop render: " + x));
      if (desktopEvidence.schemaVersion !== 2) {
        for (const f of visuallyClosed) {
          fail("VISUAL_CLOSURE_UNVERIFIED " + f.id +
            ": single-viewport evidence cannot prove visual closure");
        }
      }
    }
  }
  return {
    desktopEvidenceChecked,
    valid: problems.length === 0,
    verdict: input.iterationVerdict ?? null,
    inScope: scope.length,
    findings: findings.length,
    openCarryover: [...open],
    problems,
    baselineChecked: baseline !== null,
    limitation: "This checks receipt consistency, not the authenticity or accuracy of cited evidence.",
  };
}

async function main(argv) {
  const args = argv.slice(2);
  const options = new Map();
  for (let i = 0; i < args.length; i += 2) {
    if (!["--receipt", "--baseline", "--ledger", "--render-evidence"].includes(args[i]) ||
        typeof args[i + 1] !== "string" || args[i + 1].startsWith("--") ||
        options.has(args[i])) {
      process.stderr.write("Usage: node verify-iteration-receipt.mjs --receipt <json> [--baseline <json>] [--ledger <json>]\n");
      process.exitCode = 2;
      return;
    }
    options.set(args[i], resolve(args[i + 1]));
  }
  if (!options.has("--receipt") || (options.has("--ledger") && !options.has("--baseline"))) {
    process.stderr.write("Receipt path required; --ledger also requires --baseline\n");
    process.exitCode = 2;
    return;
  }
  try {
    const data = JSON.parse(readFileSync(options.get("--receipt"), "utf8"));
    const baseline = options.has("--baseline")
      ? JSON.parse(readFileSync(options.get("--baseline"), "utf8")) : null;
    if (data.requiresPriorBaseline === true && baseline === null) {
      process.stderr.write("This iterative receipt requires --baseline from the pre-edit review\n");
      process.exitCode = 2;
      return;
    }
    const desktopEvidence = options.has("--render-evidence")
      ? JSON.parse(readFileSync(options.get("--render-evidence"), "utf8")) : null;
    const result = validateIterationReceipt(data, baseline, desktopEvidence);
    if (options.has("--ledger")) {
      const { readLedger, verifyLedgerCoverage } = await import("./findings-ledger.mjs");
      const ledger = readLedger(options.get("--ledger"));
      const coverage = verifyLedgerCoverage(ledger, baseline, data);
      result.ledgerChecked = true;
      result.ledgerRunId = coverage.runId ?? null;
      if (!coverage.valid) {
        result.valid = false;
        result.problems.push(...coverage.problems);
      }
    } else if (data.requiresFindingsLedger === true) {
      result.valid = false;
      result.problems.push("Receipt requires an independent durable findings ledger");
    }
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    if (!result.valid) process.exitCode = 1;
  } catch (error) {
    process.stderr.write("Cannot validate receipt: " + error.message + "\n");
    process.exitCode = 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv);
}
