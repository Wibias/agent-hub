import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { checkActivation, requiredFiles } from "../scripts/check-activation.mjs";

const cli = resolve(dirname(fileURLToPath(import.meta.url)), "../scripts/check-activation.mjs");

function skillAt(root, label = "v2") {
  for (const file of requiredFiles) {
    const path = join(root, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, file + ":" + label + "\n");
  }
  return root;
}

function fixture(run) {
  const tmp = mkdtempSync(join(tmpdir(), "design-skill-activation-"));
  try {
    const canonical = skillAt(join(tmp, "hub", "skills", "design-with-ai"));
    const workspace = join(tmp, "product");
    const deepWorkspace = join(workspace, "ui", "src");
    const home = join(tmp, "home");
    mkdirSync(join(workspace, ".git"), { recursive: true });
    mkdirSync(deepWorkspace, { recursive: true });
    mkdirSync(home, { recursive: true });
    const installUser = () => skillAt(join(home, ".agents", "skills", "design-with-ai"));
    const installRepo = (at = workspace) => skillAt(join(at, ".agents", "skills", "design-with-ai"));
    return run({ tmp, canonical, workspace, deepWorkspace, home, installUser, installRepo });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

test("reports matching user skill but never claims the model actually invoked it", () => fixture((f) => {
  f.installUser();
  const result = checkActivation({ workspace: f.deepWorkspace, canonical: f.canonical, home: f.home });
  assert.equal(result.status, "MATCHING_COPY_FOUND");
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].source, "user");
  assert.equal(result.modelInvokedThisSkill, "NOT_VERIFIED");
  assert.equal(result.gateExecutedInUserProject, "NOT_VERIFIED");
  assert.equal(result.gitBoundaryFound, true);
}));

test("detects stale copy even if SKILL.md matches but a critical reference does not", () => fixture((f) => {
  const installed = f.installUser();
  writeFileSync(join(installed, "references", "verification-contract.md"), "old receipt rules\n");
  const result = checkActivation({ workspace: f.workspace, canonical: f.canonical, home: f.home });
  assert.equal(result.status, "DIFFERENT_OR_STALE");
  assert.deepEqual(result.candidates[0].differences, [
    { file: "references/verification-contract.md", reason: "different" },
  ]);
}));

test("detects multiple discoverable physical copies without guessing host precedence", () => fixture((f) => {
  f.installUser();
  f.installRepo();
  const result = checkActivation({ workspace: f.deepWorkspace, canonical: f.canonical, home: f.home });
  assert.equal(result.status, "MULTIPLE_CANDIDATES");
  assert.equal(result.candidates.length, 2);
  assert.equal(result.modelInvokedThisSkill, "NOT_VERIFIED");
}));

test("finds project skill in workspace ancestor, not only exact current directory", () => fixture((f) => {
  f.installRepo();
  const result = checkActivation({ workspace: f.deepWorkspace, canonical: f.canonical, home: f.home });
  assert.equal(result.status, "MATCHING_COPY_FOUND");
  assert.equal(result.candidates[0].source, "repository");
}));

test("does not follow unrelated skill copies above the repository boundary", () => fixture((f) => {
  skillAt(join(f.tmp, ".agents", "skills", "design-with-ai"));
  const result = checkActivation({ workspace: f.deepWorkspace, canonical: f.canonical, home: f.home });
  assert.equal(result.status, "NOT_DISCOVERABLE");
  assert.equal(result.candidates.length, 0);
}));

test("same physical install exposed by symlink aliases is not counted as two versions", () => fixture((f) => {
  const installed = f.installUser();
  const repoPath = join(f.workspace, ".agents", "skills", "design-with-ai");
  mkdirSync(dirname(repoPath), { recursive: true });
  symlinkSync(installed, repoPath, process.platform === "win32" ? "junction" : "dir");
  const result = checkActivation({ workspace: f.workspace, canonical: f.canonical, home: f.home });
  assert.equal(result.status, "MATCHING_COPY_FOUND");
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].discoveredAt.length, 2);
}));

test("missing canonical file is a hard input error, not a false green result", () => fixture((f) => {
  const empty = join(f.tmp, "empty");
  mkdirSync(empty);
  assert.throws(() => checkActivation({ workspace: f.workspace, canonical: empty, home: f.home }), /not a skill root/);
}));

test("CLI returns JSON and correct exit codes for matching, stale, and missing copies", () => fixture((f) => {
  const run = () => spawnSync(process.execPath, [
    cli, "--workspace", f.deepWorkspace, "--canonical", f.canonical, "--home", f.home,
  ], { encoding: "utf8" });
  const missing = run();
  assert.equal(missing.status, 1);
  assert.equal(JSON.parse(missing.stdout).status, "NOT_DISCOVERABLE");
  const installed = f.installUser();
  const good = run();
  assert.equal(good.status, 0, good.stderr);
  assert.equal(JSON.parse(good.stdout).status, "MATCHING_COPY_FOUND");
  writeFileSync(join(installed, "SKILL.md"), "outdated\n");
  const stale = run();
  assert.equal(stale.status, 1);
  assert.equal(JSON.parse(stale.stdout).status, "DIFFERENT_OR_STALE");
}));

test("CLI requires an independently chosen canonical root", () => {
  const r = spawnSync(process.execPath, [cli, "--workspace", process.cwd()], { encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Both --workspace and --canonical are required/);
});

test("CLI --help does not mutate or require a workspace", () => {
  const r = spawnSync(process.execPath, [cli, "--help"], { encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /NOT proof|not proof|not prove|not proof/i);
});
