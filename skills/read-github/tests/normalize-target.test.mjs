import test from "node:test";
import assert from "node:assert/strict";
import { normalizeGitHubTarget } from "../scripts/normalize-github-target.mjs";

test("normalizes owner/repo and repository URLs without assuming a branch", () => {
  assert.deepEqual(normalizeGitHubTarget("owner/repo"), { owner: "owner", repo: "repo", ref: null, path: null });
  assert.deepEqual(normalizeGitHubTarget("https://github.com/owner/repo"), { owner: "owner", repo: "repo", ref: null, path: null });
});

test("normalizes GitHub blob and raw file URLs", () => {
  assert.deepEqual(normalizeGitHubTarget("https://github.com/owner/repo/blob/dev/docs/file.md"), { owner: "owner", repo: "repo", ref: "dev", path: "docs/file.md" });
  assert.deepEqual(normalizeGitHubTarget("https://raw.githubusercontent.com/owner/repo/main/README.md"), { owner: "owner", repo: "repo", ref: "main", path: "README.md" });
});

test("rejects missing and non-GitHub targets", () => {
  assert.throws(() => normalizeGitHubTarget(""), /target is required/);
  assert.throws(() => normalizeGitHubTarget("https://example.com/owner/repo"), /unsupported GitHub target/);
});
