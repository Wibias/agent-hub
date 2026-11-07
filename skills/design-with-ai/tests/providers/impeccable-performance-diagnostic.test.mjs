import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { compareImpeccableModes } from "../../scripts/providers/impeccable-performance-diagnostic.mjs";

function receiptFor(args = [], overrides = {}) {
  const noConfig = args.includes("--no-config");
  return "DWA_IMPECCABLE_SCAN_PROOF=" + JSON.stringify({
    schemaVersion: 1, candidateFiles: 1, eligibleFiles: 1,
    ignoredFiles: 0, scannedFiles: 1, degradedFiles: 0, durationMs: 1,
    configEnabled: !noConfig,
    inlineIgnoresEnabled: !noConfig && !args.includes("--no-inline-ignores"),
    designSystemEnabled: !noConfig && !args.includes("--no-design-system"),
    designSystemResolvedFiles: !noConfig && !args.includes("--no-design-system") ? 1 : 0,
    ...overrides,
  }) + "\n";
}

async function fixture(fn) {
  const root = mkdtempSync(join(tmpdir(), "dwa-impeccable-perf-"));
  const project = join(root, "project");
  mkdirSync(project);
  const source = join(project, "source.css");
  writeFileSync(source,
    'font-family: "Space Grotesk"; /* impeccable-disable-line overused-font: deliberate */\n' +
    ".banner { animation: bounce 2s infinite; }\n");
  try { return await fn({ root, project, source }); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

test("four independent modes preserve configured and isolated ignore/design flags", async () => {
  await fixture(async ({ project, source, root }) => {
    const calls = [];
    const fake = join(root, "fake-detector.mjs");
    writeFileSync(fake, "// read only fixture\n");
    const runner = async (options) => {
      calls.push(options);
      return {
        stdout: "[]", stderr: receiptFor(options.args), exitCode: 0, error: null,
        timedOut: false, outputLimitExceeded: false,
      };
    };
    const report = await compareImpeccableModes(
      ["--target", source, "--project-root", project],
      { runner, script: fake },
    );
    assert.equal(report.status, "COMPLETE");
    assert.equal(report.designSystemComparison, "ESTABLISHED");
    assert.deepEqual(report.runs.map((r) => r.mode),
      ["configured", "no-inline-ignores", "no-design-system", "no-config"]);
    assert.deepEqual(calls.map((c) => c.args.slice(1, -1)),
      [
        ["--json", "--dwa-scan-proof"],
        ["--json", "--dwa-scan-proof", "--no-inline-ignores"],
        ["--json", "--dwa-scan-proof", "--no-design-system"],
        ["--json", "--dwa-scan-proof", "--no-config"],
      ]);
    for (const c of calls) {
      assert.equal(c.cwd, realpathSync(project));
      assert.equal(c.timeoutMs, 120_000);
      assert.equal(c.maxOutputBytes, 4_194_304);
      assert.ok(!c.args.includes("npx"));
    }
  });
});

test("alternating rounds reverse mode order without making product claims", async () => {
  await fixture(async ({ project, source, root }) => {
    const fake = join(root, "fake-detector.mjs");
    writeFileSync(fake, "// test\n");
    const runner = async (options) => ({
      stdout: "[]", stderr: receiptFor(options.args), exitCode: 0, error: null,
      timedOut: false, outputLimitExceeded: false,
    });
    const out = await compareImpeccableModes(
      ["--target", source, "--project-root", project, "--rounds", "2"],
      { runner, script: fake },
    );
    assert.equal(out.runs.length, 8);
    assert.deepEqual(out.runs.slice(4).map((r) => r.mode),
      ["no-config", "no-design-system", "no-inline-ignores", "configured"]);
    assert.match(out.note, /run order/);
  });
});

test("detector timeout, partial status or malformed output is INCOMPLETE, never PASS", async () => {
  await fixture(async ({ project, source, root }) => {
    const fake = join(root, "fake-detector.mjs");
    writeFileSync(fake, "// test\n");
    const results = [
      { exitCode: 1, stdout: "[]" },
      { exitCode: 0, stdout: "garbage" },
      { exitCode: 2, stdout: "[]" },
      { exitCode: 0, stdout: "[]", timedOut: true },
    ];
    for (const mock of results) {
      const output = await compareImpeccableModes(
        ["--target", source, "--project-root", project],
        {
          script: fake,
          runner: async () => ({
            stdout: "[]", stderr: receiptFor([]), exitCode: 0,
            error: null, timedOut: false, outputLimitExceeded: false, ...mock,
          }),
        },
      );
      assert.equal(output.status, "INCOMPLETE");
      assert.equal(output.runs.length, 1);
      assert.equal(output.runs[0].status, "ERROR");
    }
  });
});

test("missing, degraded and contradictory scan receipts invalidate every timing mode", async () => {
  await fixture(async ({ root, project, source }) => {
    const fake = join(root, "fake-detector.mjs");
    writeFileSync(fake, "// test\n");
    const invalid = [
      "",
      receiptFor([], { degradedFiles: 1, scannedFiles: 0 }),
      receiptFor([], { scannedFiles: 0 }),
      receiptFor([], { ignoredFiles: 2 }),
      receiptFor([], { designSystemEnabled: "unknown" }),
      receiptFor([], { configEnabled: false }),
      receiptFor([], { designSystemResolvedFiles: 2 }),
      receiptFor([], { designSystemEnabled: false, designSystemResolvedFiles: 1 }),
    ];
    for (const stderr of invalid) {
      const r = await compareImpeccableModes(
        ["--target", source, "--project-root", project],
        { script: fake, runner: async () => ({
          stdout: "[]", stderr, exitCode: 0, error: null,
          timedOut: false, outputLimitExceeded: false,
        }) },
      );
      assert.equal(r.status, "INCOMPLETE");
      assert.equal(r.runs.length, 1);
      assert.equal(r.runs[0].status, "ERROR");
    }
  });
});

test("disabled or unresolved DESIGN.md is reported as unestablished without failing configured scans", async () => {
  await fixture(async ({ project, source, root }) => {
    const fake = join(root, "fake-detector.mjs");
    writeFileSync(fake, "// mock\n");
    for (const disabled of [true, false]) {
      const out = await compareImpeccableModes(
        ["--target", source, "--project-root", project],
        { script: fake, runner: async (options) => ({
          stdout: "[]", stderr: receiptFor(options.args, {
            designSystemEnabled: !disabled && !options.args.includes("--no-design-system") &&
              !options.args.includes("--no-config"),
            designSystemResolvedFiles: 0,
          }), exitCode: 0, error: null, timedOut: false, outputLimitExceeded: false,
        }) },
      );
      assert.equal(out.status, "COMPLETE");
      assert.equal(out.designSystemComparison, "NOT_ESTABLISHED");
      assert.match(out.note, /NOT ESTABLISHED/);
      assert.equal(out.runs[0].designSystemResolvedFiles, 0);
    }
  });
});

test("invalid invocation or escaped scope is rejected", async () => {
  await fixture(async ({ project, source, root }) => {
    for (const args of [
      ["--target", source, "--project-root", project, "--rounds", "0"],
      ["--target", source, "--project-root", project, "--rounds", "4"],
      ["--target", source, "--project-root", project, "--unknown", "yes"],
      ["--target", root, "--project-root", project],
    ]) {
      await assert.rejects(() => compareImpeccableModes(args), /rounds|argument|scope|escapes project root/i);
    }
  });
});

test("vendored detector really finds waived vs raw source rule while leaving input unchanged", async () => {
  await fixture(async ({ project, source }) => {
    const before = readFileSync(source, "utf8");
    const out = await compareImpeccableModes(
      ["--target", source, "--project-root", project],
    );
    assert.equal(out.status, "COMPLETE", JSON.stringify(out));
    assert.equal(out.designSystemComparison, "NOT_ESTABLISHED");
    const byMode = Object.fromEntries(out.runs.map((r) => [r.mode, r]));
    assert.equal(byMode.configured.byRule["overused-font"] ?? 0, 0);
    assert.equal(byMode["no-inline-ignores"].byRule["overused-font"], 1);
    assert.equal(byMode["no-design-system"].byRule["overused-font"] ?? 0, 0);
    assert.equal(byMode["no-config"].byRule["overused-font"], 1);
    assert.equal(readFileSync(source, "utf8"), before);
  });
});

test("real detector enforces DESIGN.md separately from inline waivers", async () => {
  await fixture(async ({ project, source }) => {
    // Space Grotesk is deliberately undocumented, but the existing
    // overused-font waiver is still valid when inline ignores are enabled.
    writeFileSync(join(project, "DESIGN.md"),
      "---\ntypography:\n  body:\n    fontFamily: Arial\n---\n");
    const before = readFileSync(source, "utf8");
    const out = await compareImpeccableModes(
      ["--target", source, "--project-root", project],
    );
    assert.equal(out.status, "COMPLETE", JSON.stringify(out));
    assert.equal(out.designSystemComparison, "ESTABLISHED",
      "A resolved DESIGN.md must establish the policy comparison");
    const byMode = Object.fromEntries(out.runs.map((r) => [r.mode, r]));
    assert.equal(byMode.configured.byRule["design-system-font"], 1,
      "configured mode must enforce the real DESIGN.md font contract");
    assert.equal(byMode["no-inline-ignores"].byRule["design-system-font"], 1,
      "disabling inline waivers must not disable DESIGN.md enforcement");
    assert.equal(byMode["no-design-system"].byRule["design-system-font"] ?? 0, 0,
      "--no-design-system must suppress the design policy finding");
    assert.equal(byMode["no-config"].byRule["design-system-font"] ?? 0, 0,
      "--no-config must disable design policy discovery");
    assert.equal(byMode.configured.byRule["overused-font"] ?? 0, 0,
      "the existing inline waiver must still apply in configured mode");
    assert.equal(byMode["no-inline-ignores"].byRule["overused-font"], 1,
      "disabling inline waivers must reveal the source-only rule");
    assert.equal(byMode["no-design-system"].byRule["overused-font"] ?? 0, 0,
      "the source-only waiver must survive disabling DESIGN.md");
    assert.equal(byMode["no-config"].byRule["overused-font"], 1,
      "--no-config must disable the source-only waiver");
    assert.equal(readFileSync(source, "utf8"), before,
      "diagnostic must not change the source file");
  });
});

test("real diagnostic accepts a DESIGN.md-permitted font in every mode", async () => {
  await fixture(async ({ project, source }) => {
    writeFileSync(join(project, "DESIGN.md"),
      "---\ntypography:\n  body:\n    fontFamily: Arial\n---\n");
    writeFileSync(source, ".allowed { font-family: Arial; }\n");
    const before = readFileSync(source, "utf8");
    const out = await compareImpeccableModes(
      ["--target", source, "--project-root", project],
    );
    assert.equal(out.status, "COMPLETE", JSON.stringify(out));
    assert.equal(out.designSystemComparison, "ESTABLISHED",
      "A resolved DESIGN.md must establish the policy comparison");
    assert.deepEqual(out.runs.map((r) => r.mode),
      ["configured", "no-inline-ignores", "no-design-system", "no-config"]);
    for (const { mode, byRule } of out.runs) {
      assert.equal(byRule["design-system-font"] ?? 0, 0,
        `Allowed Arial must not be reported as a design-system violation in ${mode}`);
    }
    assert.equal(readFileSync(source, "utf8"), before,
      "the four-mode diagnostic must leave permitted-font sources unchanged");
  });
});
