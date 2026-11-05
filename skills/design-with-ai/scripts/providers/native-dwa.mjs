import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Capability, ProviderStatus, providerFailure, assertProviderReport } from "./contract.mjs";
import { runProcess } from "./process-runner.mjs";

const SCRIPT = fileURLToPath(new URL("../taste-gate.mjs", import.meta.url));
const message = (hit) => String(hit.note || hit.name || "DWA source quality signal");

function normalizeHit(hit, route, projectRoot) {
  const file = hit.relativeFile === "<surface>" ? "<surface>"
    : projectRoot && typeof hit.file === "string" && isAbsolute(hit.file)
      ? relative(projectRoot, hit.file).replaceAll("\\", "/")
      : typeof hit.relativeFile === "string" && hit.relativeFile
        ? hit.relativeFile : "<surface>";
  const rule = String(hit.id ?? "UNKNOWN");
  const line = Number.isInteger(hit.line) && hit.line > 0 ? hit.line : null;
  const fingerprint = [route, rule, file, line ?? "", String(hit.text ?? "")].join("|");
  return {
    id: "dwa-" + createHash("sha256").update(fingerprint).digest("hex").slice(0, 20),
    providerRuleId: rule,
    category: String(hit.family ?? "other"),
    priority: ["P0", "P1", "P2"].includes(hit.severity) ? hit.severity : "P2",
    confidence: hit.hardGate === true ? "deterministic" : "heuristic",
    message: message(hit),
    location: { route, file, line },
    evidence: [{ kind: "source", ref: file + (line ? ":" + line : ""), snippet: String(hit.text ?? "").slice(0, 300) }],
  };
}

export function createNativeDwaProvider({ script = SCRIPT, runner = runProcess } = {}) {
  return {
    id: "native-dwa",
    capabilities: [Capability.STATIC_AUDIT],
    async probe() {
      return existsSync(script)
        ? { available: true }
        : { available: false, reason: "DWA taste-gate script is missing" };
    },
    async inspect({ target, route, projectRoot, intentPath, capability } = {}) {
      if (capability !== Capability.STATIC_AUDIT) {
        return providerFailure("native-dwa", Capability.STATIC_AUDIT,
          ProviderStatus.BLOCKED, "Unsupported native DWA capability");
      }
      if (typeof target !== "string" || !target.trim() ||
          typeof route !== "string" || !route.trim()) {
        return providerFailure("native-dwa", Capability.STATIC_AUDIT,
          ProviderStatus.BLOCKED, "Target and route are required");
      }
      const args = [script, "--path", resolve(target), "--json"];
      if (intentPath) args.push("--intent", resolve(intentPath));
      const run = await runner({
        executable: process.execPath, args, cwd: dirname(resolve(target)),
      });
      if (run.error || run.timedOut || run.outputLimitExceeded) {
        return providerFailure("native-dwa", Capability.STATIC_AUDIT,
          ProviderStatus.ERROR, "Source gate execution failed: " +
          (run.error || (run.timedOut ? "timeout" : "output limit")));
      }
      let payload;
      try { payload = JSON.parse(run.stdout); }
      catch {
        return providerFailure("native-dwa", Capability.STATIC_AUDIT,
          ProviderStatus.ERROR, "Source gate did not return valid JSON");
      }
      if ((run.exitCode !== 0 && run.exitCode !== 1) || !Array.isArray(payload.hits) ||
          !["HOLD", "REVIEW", "REVIEW_CLUSTER", "PASS_MECHANICAL"].includes(payload.verdict)) {
        return providerFailure("native-dwa", Capability.STATIC_AUDIT,
          ProviderStatus.ERROR, String(payload.error || "Source gate returned invalid result"));
      }
      const findings = payload.hits.map((hit) => normalizeHit(hit, route, projectRoot));
      return assertProviderReport({
        provider: "native-dwa",
        capability: Capability.STATIC_AUDIT,
        status: findings.length ? ProviderStatus.FINDINGS : ProviderStatus.PASS,
        verdict: payload.verdict,
        summary: {
          filesScanned: payload.filesScanned,
          p0: payload.p0, p1: payload.p1, p2: payload.p2,
          // REVIEW and REVIEW_CLUSTER still require contextual human adjudication.
          requiresAdjudication: payload.verdict !== "PASS_MECHANICAL",
        },
        findings,
      }, { providerId: "native-dwa", capability: Capability.STATIC_AUDIT });
    },
  };
}
