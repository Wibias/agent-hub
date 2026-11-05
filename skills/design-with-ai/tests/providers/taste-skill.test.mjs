import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Capability, ProviderStatus } from "../../scripts/providers/contract.mjs";
import { createProviderRegistry, runProviders } from "../../scripts/providers/registry.mjs";
import { createTasteSkillProvider } from "../../scripts/providers/taste-skill.mjs";

const CLI = fileURLToPath(new URL("../../scripts/providers/scan.mjs", import.meta.url));
const WIDTHS = [1440, 768, 390];

async function fixture(fn) {
  const root = mkdtempSync(join(tmpdir(), "taste-provider-test-"));
  const projectRoot = join(root, "site");
  const skillRoot = join(root, "taste");
  const outputRoot = join(root, "evidence");
  const page = join(projectRoot, "index.html");
  mkdirSync(projectRoot);
  mkdirSync(join(skillRoot, "scripts"), { recursive: true });
  mkdirSync(outputRoot);
  writeFileSync(page, "<!doctype html><title>Fixture</title><main>Hi</main>");
  writeFileSync(join(skillRoot, "SKILL.md"), "---\nname: design-taste-frontend\n---\ntasteskill 2.5.0\n");
  writeFileSync(join(skillRoot, "scripts", "consistency.mjs"),
    "// Stubbed by the test runner. No browser/network execution.\n");
  try { return await fn({ root, projectRoot, skillRoot, outputRoot, page }); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

function sampleReport({ page, out, findings = [], sweep = [], notChecked, widths = WIDTHS } = {}) {
  const widthFindings = widths.map((width, index) => ({
    width, height: width === 1440 ? 900 : width === 768 ? 1024 : 844,
    screens: 1, held: 0, errors: [], findings: index ? [] : findings,
  }));
  const combined = [...findings, ...sweep];
  const report = {
    page, url: "http://127.0.0.1:5200/index.html", out,
    widths: widthFindings,
    sweep: { widths: [1280, 1024], errors: [], findings: sweep },
    checks: { "off-viewport": "PASS", "visual-empty": "PASS" },
    counts: {
      FAIL: combined.filter((f) => f.sev === "FAIL").length,
      WARN: combined.filter((f) => f.sev === "WARN").length,
    },
  };
  if (notChecked) report.notChecked = notChecked;
  return report;
}

function mockRunner(fx, override) {
  let invoked = null;
  const runner = async (command) => {
    invoked = command;
    const out = command.args[command.args.indexOf("--out") + 1];
    const report = sampleReport({ page: fx.page, out });
    override?.(report, { command, out });
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "report.json"), JSON.stringify(report));
    return {
      exitCode: report.counts.FAIL ? 1 : 0,
      stdout: JSON.stringify(report),
      stderr: "", error: null, timedOut: false, outputLimitExceeded: false,
    };
  };
  return { runner, lastCommand: () => invoked };
}

function opts(fx) {
  return {
    capability: Capability.RENDERED_AUDIT,
    target: fx.page, route: "/", projectRoot: fx.projectRoot,
    outputRoot: fx.outputRoot,
    pageKind: "software", category: "Testing", primary: "Start trial",
  };
}

test("provider remains unavailable with Node <22 or missing skill, without installing", async () => {
  await fixture(async (fx) => {
    const old = createTasteSkillProvider({ skillRoot: fx.skillRoot, nodeMajor: 20 });
    assert.match((await old.probe()).reason, /Node 22/);
    const missing = createTasteSkillProvider({
      skillRoot: join(fx.root, "not-installed"), nodeMajor: 22,
    });
    assert.equal((await missing.probe()).available, false);
    const [unavailable] = await runProviders(createProviderRegistry([missing]), {
      required: ["taste-skill"], capability: Capability.RENDERED_AUDIT,
    });
    assert.equal(unavailable.status, ProviderStatus.BLOCKED);
  });
});

test("scoped PASS requires 1440/768/390 plus first-screen sweep and separate profile", async () => {
  await fixture(async (fx) => {
    const harness = mockRunner(fx);
    const provider = createTasteSkillProvider({
      skillRoot: fx.skillRoot, runner: harness.runner, nodeMajor: 22,
    });
    const [report] = await runProviders(createProviderRegistry([provider]), {
      capability: Capability.RENDERED_AUDIT,
      required: ["taste-skill"], request: opts(fx),
    });
    assert.equal(report.status, ProviderStatus.PASS, report.reason);
    assert.deepEqual(report.summary.widths, WIDTHS);
    assert.equal(report.summary.productCompletionEligible, false);
    assert.equal(report.provenance.version, "2.5.0");
    assert.ok(existsSync(report.provenance.report));
    const cmd = harness.lastCommand();
    assert.equal(cmd.executable, process.execPath);
    assert.equal(cmd.cwd, fx.projectRoot);
    assert.ok(cmd.args.includes("--json"));
    assert.equal(cmd.args[cmd.args.indexOf("--widths") + 1], "1440,768,390");
    assert.equal(cmd.args[cmd.args.indexOf("--rhythm-widths") + 1], "1440,768,390");
    assert.ok(!cmd.args.includes("--quick"));
    assert.ok(!cmd.args.includes("--no-sweep"));
    assert.ok(!cmd.args.includes("npx"));
    assert.ok(cmd.envKeys.includes("CHROME_PATH"));
    assert.ok(cmd.args.includes("--profile"));
    assert.ok(report.provenance.report.startsWith(fx.outputRoot));
  });
});

test("FAIL and WARN remain contextual findings with inspectable crop and report pointers", async () => {
  await fixture(async (fx) => {
    const harness = mockRunner(fx, (report, { out }) => {
      const crop = "1440-01-off-viewport.jpg";
      writeFileSync(join(out, crop), "fake-jpeg");
      report.widths[0].findings.push({
        check: "off-viewport", sev: "FAIL", sel: "(the page)", msg: "sideways overflow",
        crop,
      });
      report.sweep.findings.push({
        check: "copy-length", sev: "WARN", sel: "section", msg: "copy may be long",
        width: 1280,
      });
      report.counts.FAIL = 1;
      report.counts.WARN = 1;
      report.checks["off-viewport"] = "FAIL";
    });
    const provider = createTasteSkillProvider({
      skillRoot: fx.skillRoot, runner: harness.runner, nodeMajor: 22,
    });
    const report = await provider.inspect(opts(fx));
    assert.equal(report.status, ProviderStatus.FINDINGS, report.reason);
    assert.deepEqual(report.findings.map((f) => f.priority), ["P1", "P2"]);
    assert.equal(report.findings[0].providerRuleId, "off-viewport");
    assert.equal(report.findings[0].location.width, 1440);
    assert.ok(report.findings[0].evidence[0].ref.includes("#/widths/0/findings/0"));
    assert.ok(report.findings[0].evidence[1].ref.endsWith("1440-01-off-viewport.jpg"));
    assert.equal(report.findings[1].location.width, 1280);
  });
});

test("advisory-only warning is reported as FINDINGS with upstream exit 0", async () => {
  await fixture(async (fx) => {
    const harness = mockRunner(fx, (report) => {
      report.widths[1].findings.push({
        check: "copy-headline", sev: "WARN", sel: "h1", msg: "Review copy",
      });
      report.counts.WARN = 1;
      report.checks["copy-headline"] = "WARN";
    });
    const provider = createTasteSkillProvider({
      skillRoot: fx.skillRoot, runner: harness.runner, nodeMajor: 22,
    });
    const result = await provider.inspect(opts(fx));
    assert.equal(result.status, ProviderStatus.FINDINGS, result.reason);
    assert.equal(result.summary.counts.WARN, 1);
  });
});

test("missing browser coverage, skipped checks, falsified counts and wrong source report fail closed", async () => {
  await fixture(async (fx) => {
    const cases = [
      (r) => { r.widths.pop(); },
      (r) => { r.widths[0].screens = 0; },
      (r) => { r.widths[0].errors.push("CDP timeout"); },
      (r) => { r.notChecked = ["reduced-motion"]; },
      (r) => { r.checks["motion-layer"] = "not checked"; },
      (r) => { delete r.sweep; },
      (r) => { r.counts.WARN = 1; },
      (r) => { r.page = "/another/project/index.html"; },
      (r) => { r.out = "/another/location"; },
      (r) => { r.url = "https://example.com"; },
      (r) => { r.url = "http://127.0.0.1:5200/another-page.html"; },
      (r) => { r.widths[0].findings.push({ check: "visual-empty", sev: "FAIL",
        sel: "canvas", msg: "Blank" }); },
      (r) => { r.widths[0].findings.push({ check: "visual-empty", sev: "WARN",
        sel: "canvas", msg: "Blank", crop: "../escape.jpg" }); r.counts.WARN = 1; },
    ];
    for (const makeInvalid of cases) {
      const harness = mockRunner(fx, makeInvalid);
      const provider = createTasteSkillProvider({
        skillRoot: fx.skillRoot, runner: harness.runner, nodeMajor: 22,
      });
      const report = await provider.inspect(opts(fx));
      assert.equal(report.status, ProviderStatus.ERROR,
        JSON.stringify({ reason: report.reason, makeInvalid: String(makeInvalid) }));
    }
  });
});

test("remote page, non-HTML target, path escape and unsupported page kind are blocked before runner", async () => {
  await fixture(async (fx) => {
    let executed = 0;
    const provider = createTasteSkillProvider({
      skillRoot: fx.skillRoot,
      nodeMajor: 22,
      runner: async () => { executed++; return {}; },
    });
    const requests = [
      { ...opts(fx), target: "https://example.com" },
      { ...opts(fx), target: fx.root },
      { ...opts(fx), projectRoot: fx.skillRoot },
      { ...opts(fx), pageKind: "generic-website" },
      { ...opts(fx), target: join(fx.root, "missing.html") },
    ];
    for (const request of requests) {
      const report = await provider.inspect(request);
      assert.equal(report.status, ProviderStatus.BLOCKED, report.reason);
    }
    assert.equal(executed, 0);
  });
});

test("missing runner result, unparseable stdout and unsupported capability cannot pass", async () => {
  await fixture(async (fx) => {
    for (const result of [
      { exitCode: 2, stdout: "{}" },
      { exitCode: null, error: "ENOENT" },
      { exitCode: 0, stdout: "not json" },
      { exitCode: 0, stdout: "{}", timedOut: true },
      { exitCode: 0, stdout: "{}", outputLimitExceeded: true },
    ]) {
      const p = createTasteSkillProvider({
        skillRoot: fx.skillRoot, nodeMajor: 22, runner: async () => result,
      });
      const report = await p.inspect(opts(fx));
      assert.equal(report.status, ProviderStatus.ERROR);
    }
    const p = createTasteSkillProvider({ skillRoot: fx.skillRoot, nodeMajor: 22 });
    const report = await p.inspect({ ...opts(fx), capability: Capability.STATIC_AUDIT });
    assert.equal(report.status, ProviderStatus.BLOCKED);
  });
});

test("explicit CLI requires a local, installed Taste Skill; existing static CLI remains unchanged", () => {
  const proc = spawnSync(process.execPath, [CLI, "--provider", "taste-skill",
    "--path", "index.html", "--route", "/"], { encoding: "utf8" });
  assert.equal(proc.status, 2);
  assert.match(JSON.parse(proc.stdout).error, /requires --project-root and --skill-root/);
  const other = spawnSync(process.execPath, [CLI, "--provider", "impeccable",
    "--path", "index.html", "--route", "/", "--page-kind", "place"], { encoding: "utf8" });
  assert.equal(other.status, 2);
  assert.match(JSON.parse(other.stdout).error, /Rendered-only/);
});
