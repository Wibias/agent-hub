import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { resolveCloneRootCandidates, resolveWorktreeRoot } from "../scripts/lib/worktree-locations.mjs";

test("clone candidates use explicit root then cwd without machine-specific guesses", () => {
  assert.deepEqual(resolveCloneRootCandidates({ cloneRoot: "/repos/app", cwd: "/work/current" }), ["/repos/app", "/work/current"]);
  assert.deepEqual(resolveCloneRootCandidates({ cloneRoot: null, cwd: "/work/current" }), ["/work/current"]);
});

test("worktree root prefers argument, then environment, then OS temp", () => {
  assert.equal(resolveWorktreeRoot({ configured: "/custom/wt", env: {}, tempRoot: "/tmp" }), "/custom/wt");
  assert.equal(resolveWorktreeRoot({ configured: null, env: { GITHUB_DELIVERY_WORKTREE_ROOT: "/env/wt" }, tempRoot: "/tmp" }), "/env/wt");
  assert.equal(resolveWorktreeRoot({ configured: null, env: {}, tempRoot: "/tmp" }), join("/tmp", "github-delivery-worktrees"));
});
