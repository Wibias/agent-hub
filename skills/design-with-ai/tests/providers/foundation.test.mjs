import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  Capability, ProviderStatus, assertProviderReport,
} from "../../scripts/providers/contract.mjs";
import { runProcess } from "../../scripts/providers/process-runner.mjs";
import { createProviderRegistry, runProviders } from "../../scripts/providers/registry.mjs";
import { createNativeDwaProvider } from "../../scripts/providers/native-dwa.mjs";

test("provider contract rejects fabricated passing reports and missing provenance", () => {
  assert.throws(() => assertProviderReport({
    provider: "native-dwa", capability: Capability.STATIC_AUDIT,
    status: ProviderStatus.PASS,
    findings: [{ id: "fake" }],
  }), /Non-finding/);
  assert.throws(() => assertProviderReport({
    provider: "native-dwa", capability: Capability.STATIC_AUDIT,
    status: ProviderStatus.FINDINGS,
    findings: [{ id: "x", providerRuleId: "G22", priority: "P0", message: "x",
      location: { file: "x.tsx", route: "/" }, evidence: [] }],
  }), /evidence/);
});

test("registry rejects duplicate identifiers", () => {
  const provider = createNativeDwaProvider();
  assert.throws(() => createProviderRegistry([provider, provider]), /Duplicate/);
});

test("missing required providers block, while optional providers remain unavailable", async () => {
  const registry = createProviderRegistry();
  const result = await runProviders(registry, {
    required: ["impeccable"], optional: ["taste-skill"],
  });
  assert.deepEqual(result.map((item) => item.status),
    [ProviderStatus.BLOCKED, ProviderStatus.UNAVAILABLE]);
});

test("a provider with an invalid result fails closed instead of silently passing", async () => {
  const registry = createProviderRegistry([{
    id: "invalid", capabilities: [Capability.STATIC_AUDIT],
    probe: async () => ({ available: true }),
    inspect: async () => ({ provider: "invalid", capability: Capability.STATIC_AUDIT,
      status: ProviderStatus.PASS, findings: [{ id: "invalid" }] }),
  }]);
  const [result] = await runProviders(registry, { required: ["invalid"] });
  assert.equal(result.status, ProviderStatus.ERROR);
});

test("process runner never starts a shell or inherits undeclared secrets", async () => {
  const key = "DWA_SECRET_SENTINEL_FOR_TESTS";
  process.env[key] = "do-not-inherit";
  try {
    const command = [
      "-e",
      "process.stdout.write(JSON.stringify({secret:process.env.DWA_SECRET_SENTINEL_FOR_TESTS ?? null,arg:process.argv[1]}))",
      "hello;echo injected",
    ];
    const run = await runProcess({
      executable: process.execPath, args: command, cwd: tmpdir(),
    });
    assert.equal(run.exitCode, 0, run.stderr);
    assert.deepEqual(JSON.parse(run.stdout), { secret: null, arg: "hello;echo injected" });
  } finally {
    delete process.env[key];
  }
});

test("process runner limits output and execution time", async () => {
  const loud = await runProcess({
    executable: process.execPath, args: ["-e", "process.stdout.write('a'.repeat(10000))"],
    cwd: tmpdir(), maxOutputBytes: 32,
  });
  assert.equal(loud.outputLimitExceeded, true);
  const slow = await runProcess({
    executable: process.execPath, args: ["-e", "setInterval(()=>{},1000)"],
    cwd: tmpdir(), timeoutMs: 200,
  });
  assert.equal(slow.timedOut, true);
});

test("native provider retains a source HOLD without pretending it is a completion verdict", async () => {
  const root = mkdtempSync(join(tmpdir(), "dwa-native-provider-"));
  try {
    const target = join(root, "page.tsx");
    writeFileSync(target, '<button className="transition-all">Save</button>', "utf8");
    const registry = createProviderRegistry([createNativeDwaProvider()]);
    const [report] = await runProviders(registry, {
      required: ["native-dwa"], request: { target, route: "/settings" },
    });
    assert.equal(report.status, ProviderStatus.FINDINGS, report.reason);
    assert.equal(report.verdict, "HOLD");
    const hit = report.findings.find((finding) => finding.providerRuleId === "G22");
    assert.ok(hit);
    assert.equal(hit.priority, "P0");
    assert.equal(hit.location.route, "/settings");
    assert.equal(hit.evidence[0].kind, "source");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a missing source target is an error, never a green check", async () => {
  const registry = createProviderRegistry([createNativeDwaProvider()]);
  const [report] = await runProviders(registry, {
    required: ["native-dwa"],
    request: { target: join(tmpdir(), "dwa-provider-no-such-file"), route: "/" },
  });
  assert.equal(report.status, ProviderStatus.ERROR);
});
