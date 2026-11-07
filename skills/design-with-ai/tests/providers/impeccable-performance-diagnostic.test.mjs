import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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

test("symlinked diagnostic CLI runs both bounded preflight and normal error entrypoints", async () => {
  await fixture(({ root, project, source }) => {
    const script = fileURLToPath(new URL(
      "../../scripts/providers/impeccable-performance-diagnostic.mjs", import.meta.url));
    const linkDirectory = join(root, "linked-provider-scripts");
    symlinkSync(dirname(script), linkDirectory,
      process.platform === "win32" ? "junction" : "dir");
    const linked = join(linkDirectory, "impeccable-performance-diagnostic.mjs");
    const preflight = spawnSync(process.execPath, [linked,
      "--internal-scope-preflight", "--target", source, "--project-root", project],
    { encoding: "utf8", timeout: 15_000 });
    assert.equal(preflight.status, 0, preflight.stderr);
    const scoped = JSON.parse(preflight.stdout);
    assert.equal(scoped.target, realpathSync(source));
    assert.equal(scoped.root, realpathSync(project));
    const invalid = spawnSync(process.execPath, [linked, "--unknown"],
      { encoding: "utf8", timeout: 15_000 });
    assert.equal(invalid.status, 2,
      "a symlinked normal invocation must not exit zero with no report");
    assert.match(invalid.stderr, /Invalid\/repeated argument/);
  });
});

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
    ]) {
      await assert.rejects(() => compareImpeccableModes(args), /rounds|argument/i);
    }
    const escaped = await compareImpeccableModes(
      ["--target", root, "--project-root", project]);
    assert.equal(escaped.status, "INCOMPLETE");
    assert.deepEqual(escaped.runs, []);
    assert.match(escaped.note, /preflight/);
  });
});

test("scope preflight failure, timeout and stalled transport stay INCOMPLETE", async () => {
  await fixture(async ({ project, source, root }) => {
    const script = join(root, "fake-detector.mjs");
    writeFileSync(script, "// must not run\n");
    let detectorCalls = 0;
    for (const preflightRunner of [
      async () => ({ timedOut: true }),
      async () => ({ exitCode: 2, stdout: "", stderr: "CANARY_SCOPE_SECRET_20261107" }),
      () => new Promise(() => {}),
    ]) {
      const result = await compareImpeccableModes(
        ["--target", source, "--project-root", project], {
          script,
          preflightRunner,
          preflightTimeoutMs: 25,
          runner: async () => { detectorCalls++; throw new Error("detector should not run"); },
        });
      assert.equal(result.status, "INCOMPLETE");
      assert.deepEqual(result.runs, []);
      assert.match(result.note, /preflight/);
      assert.ok(!JSON.stringify(result).includes("CANARY_"));
    }
    assert.equal(detectorCalls, 0);
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
