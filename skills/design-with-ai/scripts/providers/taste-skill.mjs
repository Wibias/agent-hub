// Optional rendered evidence from Taste Skill 2.5.0. Not a DWA gate or design authority.
import { createHash } from "node:crypto";
import {
  existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { Capability, ProviderStatus, assertProviderReport, providerFailure } from "./contract.mjs";
import { runProcess } from "./process-runner.mjs";

const WIDTHS = [1440, 768, 390];
const PAGE_KINDS = new Set(["software", "gaming", "tech", "product", "service", "place"]);
// Conservative *review* hints for the pinned Taste Skill 2.5.0 check IDs.
// Never suppress, downgrade, approve or turn an upstream FAIL into DWA P0.
const CONTEXTUAL_TASTE_RULES = new Set([
  "visual-caption", "section-height", "one-section", "hero-screen", "hero-fill",
  "photo-set", "photo-upscale", "nav-family", "cta", "hover",
  "one-heading", "heading-scale", "copy-headline", "copy-headings",
  "copy-buttons", "copy-length", "section-air", "section-tile",
]);
const GEOMETRY_REVIEW_RULES = new Set([
  "spill", "container-edges", "section-gaps", "row-lines",
  "off-grid", "centre-axis", "tilt", "stagger",
]);
const POTENTIAL_USABILITY_RULES = new Set([
  "contrast", "cut-text", "off-viewport", "overlap-text", "fold-cut", "forms",
  "links", "assets", "empty-visual", "visual-empty", "no-visual",
  "busy-ground", "nav-covers", "fake-button", "broken-image",
]);
function tasteReviewClass(check) {
  if (POTENTIAL_USABILITY_RULES.has(check)) return "POTENTIAL_USABILITY";
  if (GEOMETRY_REVIEW_RULES.has(check)) return "GEOMETRY_NEEDS_VISUAL_REVIEW";
  if (CONTEXTUAL_TASTE_RULES.has(check)) return "CONTEXTUAL_HOUSE_RULE";
  return "UNCLASSIFIED_HEURISTIC";
}
const ENV_KEYS = [
  "PATH", "Path", "SystemRoot", "WINDIR", "HOME", "USERPROFILE", "TMP", "TEMP", "TMPDIR",
  "CHROME_PATH", "LOCALAPPDATA", "PROGRAMFILES",
];
const filled = (value) => typeof value === "string" && value.trim().length > 0;
const isObject = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const inside = (root, file) => {
  const rel = relative(root, file);
  return rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel);
};
const fail = (status, reason) =>
  providerFailure("taste-skill", Capability.RENDERED_AUDIT, status, reason);

function checkedDirectory(path, label) {
  if (!filled(path) || !existsSync(resolve(path))) {
    throw new Error(label + " does not exist");
  }
  const abs = resolve(path);
  if (!lstatSync(abs).isDirectory() || lstatSync(abs).isSymbolicLink()) {
    throw new Error(label + " must be a regular directory, not a symlink");
  }
  return realpathSync(abs);
}

function resolvePage(target, projectRoot) {
  if (!filled(target) || /^(?:[a-z][a-z0-9+.-]*):\/\//i.test(target)) {
    throw new Error("Taste provider requires a local HTML file, never a remote URL");
  }
  const project = checkedDirectory(projectRoot, "projectRoot");
  const abs = resolve(target);
  if (!existsSync(abs) || !lstatSync(abs).isFile() || lstatSync(abs).isSymbolicLink() ||
      ![".html", ".htm"].includes(extname(abs).toLowerCase())) {
    throw new Error("Target must be an existing regular HTML file");
  }
  const page = realpathSync(abs);
  if (!inside(project, page)) throw new Error("HTML target escapes projectRoot");
  return { project, page };
}

function validatedFinding(raw, { width, route, file, reportPath, pointer, runDir, occurrences }) {
  if (!isObject(raw) || !filled(raw.check) ||
      !["FAIL", "WARN"].includes(raw.sev) || !filled(raw.msg) ||
      !filled(raw.sel)) {
    throw new Error("Malformed Taste Skill finding");
  }
  const key = [route, width, raw.check, raw.sel, raw.msg].join("\0");
  const hash = createHash("sha256").update(key).digest("hex").slice(0, 20);
  const index = occurrences.get(hash) ?? 0;
  occurrences.set(hash, index + 1);
  const evidence = [{ kind: "rendered-report", ref: reportPath + "#" + pointer }];
  if (raw.crop !== undefined) {
    if (!filled(raw.crop) || basename(raw.crop) !== raw.crop ||
        !/^[a-zA-Z0-9_.-]+\.jpe?g$/i.test(raw.crop)) {
      throw new Error("Unsafe Taste Skill screenshot reference");
    }
    const screenshot = join(dirname(reportPath), raw.crop);
    if (!inside(runDir, screenshot) || !existsSync(screenshot) ||
        lstatSync(screenshot).isSymbolicLink() || !lstatSync(screenshot).isFile()) {
      throw new Error("Taste Skill referenced screenshot is missing or unsafe");
    }
    evidence.push({ kind: "rendered-crop", ref: screenshot });
  }
  return {
    id: "taste-" + hash + (index ? "-" + index : ""),
    providerRuleId: raw.check,
    category: "rendered",
    priority: raw.sev === "FAIL" ? "P1" : "P2",
    confidence: "heuristic",
    upstreamSeverity: raw.sev,
    reviewClass: tasteReviewClass(raw.check),
    message: raw.msg,
    location: { route, file, width, selector: raw.sel },
    evidence,
  };
}

function parseReport(report, { exitCode, route, page, project, runDir }) {
  const reportPath = join(runDir, "report", "report.json");
  if (!isObject(report) || resolve(String(report.page ?? "")) !== page ||
      resolve(String(report.out ?? "")) !== dirname(reportPath)) {
    throw new Error("Taste Skill report page/output provenance does not match request");
  }
  let url;
  try { url = new URL(report.url); } catch {
    throw new Error("Taste Skill report has no local browser URL");
  }
  const expectedPath = "/" + relative(project, page).replaceAll("\\", "/").split("/").map(encodeURIComponent).join("/");
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" ||
      decodeURIComponent(url.pathname) !== decodeURIComponent(expectedPath)) {
    throw new Error("Taste Skill browser URL does not match the exact local HTML target");
  }
  if (!Array.isArray(report.widths) || report.widths.length !== WIDTHS.length ||
      report.widths.some((item, i) => !isObject(item) ||
        item.width !== WIDTHS[i] || !Number.isInteger(item.screens) || item.screens <= 0 ||
        item.failed === true || !Array.isArray(item.errors) || item.errors.length ||
        !Array.isArray(item.findings))) {
    throw new Error("Required desktop/tablet/mobile browser coverage is incomplete");
  }
  if (!isObject(report.sweep) || !Array.isArray(report.sweep.widths) ||
      report.sweep.widths.length === 0 || !Array.isArray(report.sweep.errors) ||
      report.sweep.errors.length || !Array.isArray(report.sweep.findings)) {
    throw new Error("Taste Skill first-screen sweep is incomplete");
  }
  if ((Array.isArray(report.notChecked) && report.notChecked.length) ||
      (Array.isArray(report.notCheckedAt) && report.notCheckedAt.length) ||
      !isObject(report.checks) || !Object.keys(report.checks).length ||
      Object.values(report.checks).some((state) =>
        !["PASS", "WARN", "FAIL"].includes(state))) {
    throw new Error("Taste Skill reports skipped or invalid checks");
  }
  const occurrences = new Map(), normalized = [], counters = { FAIL: 0, WARN: 0 };
  const file = (relative(project, page) || ".").replaceAll("\\", "/");
  for (const [windex, w] of report.widths.entries()) {
    for (const [index, finding] of w.findings.entries()) {
      if (finding?.sev === "FAIL" || finding?.sev === "WARN") counters[finding.sev]++;
      normalized.push(validatedFinding(finding, {
        width: w.width, route, file, reportPath,
        pointer: "/widths/" + windex + "/findings/" + index, runDir, occurrences,
      }));
    }
  }
  for (const [index, finding] of report.sweep.findings.entries()) {
    if (finding?.sev === "FAIL" || finding?.sev === "WARN") counters[finding.sev]++;
    normalized.push(validatedFinding(finding, {
      width: finding.width || 0, route, file, reportPath,
      pointer: "/sweep/findings/" + index, runDir, occurrences,
    }));
  }
  if (!isObject(report.counts) || report.counts.FAIL !== counters.FAIL ||
      report.counts.WARN !== counters.WARN ||
      (exitCode === 0 && counters.FAIL !== 0) ||
      (exitCode === 1 && counters.FAIL === 0)) {
    throw new Error("Taste Skill exit status and reported finding counts disagree");
  }
  const reviewClassCounts = {
    POTENTIAL_USABILITY: 0, GEOMETRY_NEEDS_VISUAL_REVIEW: 0,
    CONTEXTUAL_HOUSE_RULE: 0, UNCLASSIFIED_HEURISTIC: 0,
  };
  for (const finding of normalized) reviewClassCounts[finding.reviewClass]++;

  return assertProviderReport({
    provider: "taste-skill",
    capability: Capability.RENDERED_AUDIT,
    status: normalized.length ? ProviderStatus.FINDINGS : ProviderStatus.PASS,
    provenance: {
      upstream: "Leonxlnx/taste-skill",
      version: "2.5.0",
      script: "scripts/consistency.mjs",
      command: "node consistency.mjs <local-html> --json --widths 1440,768,390",
      report: reportPath,
      artifactDirectory: runDir,
      sourceOnly: false,
      manualOptIn: true,
    },
    summary: {
      counts: counters,
      reviewClassCounts,
      widths: [...WIDTHS],
      sweepWidths: report.sweep.widths,
      requiresAdjudication: true,
      productCompletionEligible: false,
      renderedStateVerified: false,
      // The upstream checker waits for its own kit's data-ready convention,
      // not arbitrary React/game session state or backend hydration.
      renderedStateProof: "NOT_PROVIDED_BY_UPSTREAM",
      note: "Raw FAIL/WARN are retained as contextual evidence. A completed Taste scan is not proof the intended runtime state loaded.",
    },
    findings: normalized,
  }, { providerId: "taste-skill", capability: Capability.RENDERED_AUDIT });
}

export function createTasteSkillProvider({ skillRoot, runner = runProcess, nodeMajor = Number(process.versions.node.split(".")[0]) } = {}) {
  return {
    id: "taste-skill",
    capabilities: [Capability.RENDERED_AUDIT],
    async probe() {
      const major = nodeMajor;
      if (!Number.isFinite(major) || major < 22) {
        return { available: false, reason: "Taste Skill 2.5.0 needs Node 22+" };
      }
      if (!filled(skillRoot)) {
        return { available: false, reason: "An explicit locally installed Taste Skill root is required" };
      }
      try {
        const root = realpathSync(resolve(skillRoot));
        const script = join(root, "scripts", "consistency.mjs");
        const manifest = join(root, "SKILL.md");
        if (!existsSync(script) || !existsSync(manifest) ||
            !lstatSync(script).isFile() || lstatSync(script).isSymbolicLink() ||
            !lstatSync(manifest).isFile() ||
            !readFileSync(manifest, "utf8").includes("tasteskill 2.5.0")) {
          return { available: false, reason: "Taste Skill v2.5.0 consistency.mjs is not installed" };
        }
        return { available: true, implementation: "consistency-2.5.0" };
      } catch {
        return { available: false, reason: "Taste Skill root cannot be read" };
      }
    },
    async inspect({
      capability, target, route, projectRoot, outputRoot, pageKind, category, primary,
    } = {}) {
      if (capability !== Capability.RENDERED_AUDIT) {
        return fail(ProviderStatus.BLOCKED, "Only rendered-audit is supported");
      }
      if (!filled(route) || !filled(projectRoot)) {
        return fail(ProviderStatus.BLOCKED, "Route and projectRoot are required");
      }
      if (pageKind !== undefined && !PAGE_KINDS.has(pageKind)) {
        return fail(ProviderStatus.BLOCKED, "Unsupported pageKind");
      }
      for (const value of [category, primary]) {
        if (value !== undefined && (!filled(value) || value.startsWith("--"))) {
          return fail(ProviderStatus.BLOCKED, "Invalid category or primary action");
        }
      }
      const probe = await this.probe();
      if (!probe.available) return fail(ProviderStatus.UNAVAILABLE, probe.reason);
      let page, project, output;
      try {
        ({ page, project } = resolvePage(target, projectRoot));
        output = outputRoot ? checkedDirectory(outputRoot, "outputRoot") : tmpdir();
      } catch (error) {
        return fail(ProviderStatus.BLOCKED, String(error.message ?? error));
      }
      // Each check gets a separate directory, so upstream cleanup cannot erase an earlier run.
      let runDir;
      try {
        runDir = mkdtempSync(join(output, "dwa-taste-"));
        mkdirSync(join(runDir, "report"));
        mkdirSync(join(runDir, "chrome"));
      } catch (error) {
        return fail(ProviderStatus.ERROR, "Could not allocate isolated Taste Skill artifacts: " +
          String(error.message ?? error));
      }
      const reportPath = join(runDir, "report", "report.json");
      const args = [
        join(realpathSync(resolve(skillRoot)), "scripts", "consistency.mjs"),
        page, "--json", "--widths", WIDTHS.join(","),
        "--rhythm-widths", WIDTHS.join(","),
        "--root", project, "--out", dirname(reportPath), "--profile", join(runDir, "chrome"),
      ];
      if (pageKind) args.push("--page", pageKind);
      if (category) args.push("--category", category);
      if (primary) args.push("--primary", primary);
      const processResult = await runner({
        executable: process.execPath, args, cwd: project,
        envKeys: ENV_KEYS, timeoutMs: 600_000, maxOutputBytes: 8_388_608,
      });
      if (processResult.error || processResult.timedOut ||
          processResult.outputLimitExceeded || ![0, 1].includes(processResult.exitCode)) {
        return fail(ProviderStatus.ERROR,
          "Taste Skill browser check failed or could not finish; evidence directory: " + runDir);
      }
      try {
        if (!existsSync(reportPath) || !lstatSync(reportPath).isFile() ||
            lstatSync(reportPath).isSymbolicLink()) {
          throw new Error("Browser report.json is missing or unsafe");
        }
        const disk = readFileSync(reportPath, "utf8");
        const report = JSON.parse(disk);
        if (JSON.stringify(JSON.parse(processResult.stdout)) !== JSON.stringify(report)) {
          throw new Error("Browser stdout and on-disk report disagree");
        }
        return parseReport(report, {
          exitCode: processResult.exitCode, route, page, project, runDir,
        });
      } catch (error) {
        return fail(ProviderStatus.ERROR,
          "Taste Skill report is incomplete or invalid: " + String(error.message ?? error) +
          "; evidence directory: " + runDir);
      }
    },
  };
}
