#!/usr/bin/env node
// Read-only Codex session trace summary. It reports evidence candidates,
// never infers successful skill activation from mere text mentions.
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const skill = /design-with-ai/i;
const gate = /verify-iteration-receipt\.mjs/i;
const skillDoc = /design-with-ai[\\/]+SKILL\.md/i;
const executionTool = /exec|shell|command|terminal|powershell|run/i;
const gateProcess = /\b(?:node(?:\.exe)?|bun|deno)\b[^\n]{0,450}verify-iteration-receipt\.mjs/i;

function toolArgumentText(p) {
  const fields = [p.arguments, p.input, p.command];
  return fields.map((v) => typeof v === "string" ? v : v == null ? "" : JSON.stringify(v)).join("\n");
}
function processCode(output) {
  if (typeof output !== "string") return null;
  const patterns = [
    /Process exited with code\s+(\d+)/i,
    /(?:Exit code|exit_code|exitCode|exit status)\s*[=:]\s*(\d+)/i,
    /"exit_code"\s*:\s*(\d+)/i,
  ];
  for (const p of patterns) {
    const m = output.match(p);
    if (m) return Number(m[1]);
  }
  return null;
}

export async function inspectRollout(file) {
  const callIds = new Map();
  const relevant = [];
  const summary = {
    logfile: resolve(file),
    project: null,
    totalToolCalls: 0,
    skillReferencedToolCalls: 0,
    skillFileArgumentCalls: 0,
    gateMentionToolCalls: 0,
    gateInvocationCandidates: 0,
    gateInvocationWithObservedExit: 0,
    evidence: [],
    gateExecution: "NOT_OBSERVED_IN_THIS_LOG",
    limitation: "Tool arguments and selected tool-output exit markers are inspected. A text match alone is not proof of file reads or invocation; absence in one log is not proof the gate never ran.",
  };
  let invalidLines = 0;
  const stream = createReadStream(file, { encoding: "utf8" });
  for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) {
    if (!line.trim()) continue;
    let event;
    try { event = JSON.parse(line); }
    catch { invalidLines++; continue; }
    const p = event?.payload;
    if (event.type === "session_meta" && typeof p?.cwd === "string") {
      summary.project = p.cwd;
    }
    if (event.type !== "response_item" || !p || typeof p !== "object") continue;
    if (p.type === "function_call" || p.type === "custom_tool_call") {
      summary.totalToolCalls++;
      const args = toolArgumentText(p);
      const name = String(p.name ?? p.recipient ?? "");
      const mentionsSkill = skill.test(args);
      const mentionsFile = skillDoc.test(args);
      const mentionsGate = gate.test(args);
      const gateCandidate = mentionsGate && executionTool.test(name) && gateProcess.test(args);
      if (mentionsSkill) summary.skillReferencedToolCalls++;
      if (mentionsFile) summary.skillFileArgumentCalls++;
      if (mentionsGate) summary.gateMentionToolCalls++;
      if (gateCandidate) summary.gateInvocationCandidates++;
      if (mentionsSkill || mentionsGate) {
        const item = {
          tool: name,
          callId: String(p.call_id ?? ""),
          referencesSkill: mentionsSkill,
          referencesSkillFile: mentionsFile,
          mentionsGate,
          gateInvocationCandidate: gateCandidate,
          observedExitCode: null,
        };
        relevant.push(item);
        if (item.callId) callIds.set(item.callId, item);
      }
    } else if (p.type === "function_call_output") {
      const item = callIds.get(String(p.call_id ?? ""));
      if (!item || !item.gateInvocationCandidate) continue;
      const code = processCode(typeof p.output === "string" ? p.output : JSON.stringify(p.output ?? ""));
      if (code !== null) {
        item.observedExitCode = code;
        summary.gateInvocationWithObservedExit++;
      }
    }
  }
  summary.invalidLines = invalidLines;
  // No raw commands, user prompts, environment variables, or tool outputs in report.
  summary.evidence = relevant.slice(0, 200);
  if (summary.gateInvocationWithObservedExit > 0) {
    summary.gateExecution = relevant.some((v) => v.gateInvocationCandidate && v.observedExitCode === 0)
      ? "CANDIDATE_WITH_EXIT_ZERO"
      : "CANDIDATE_WITH_NONZERO_EXIT";
  } else if (summary.gateInvocationCandidates > 0) {
    summary.gateExecution = "CANDIDATE_WITHOUT_EXIT_EVIDENCE";
  }
  return summary;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
    process.stdout.write("Usage: node inspect-codex-rollout.mjs --log <rollout.jsonl>\nPrints redacted tool-call evidence, not the full transcript.\n");
    return;
  }
  if (args.length !== 2 || args[0] !== "--log") {
    process.stderr.write("Usage: node inspect-codex-rollout.mjs --log <rollout.jsonl>\n");
    process.exitCode = 2;
    return;
  }
  try { process.stdout.write(JSON.stringify(await inspectRollout(args[1]), null, 2) + "\n"); }
  catch (error) { process.stderr.write("Cannot inspect rollout: " + error.message + "\n"); process.exitCode = 2; }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
