import { join } from "node:path";
import { tmpdir } from "node:os";

export function resolveCloneRootCandidates({ cloneRoot = null, cwd = process.cwd() } = {}) {
  return [...new Set([cloneRoot, cwd].filter(Boolean))];
}

export function resolveWorktreeRoot({ configured = null, env = process.env, tempRoot = tmpdir() } = {}) {
  return configured || env.GITHUB_DELIVERY_WORKTREE_ROOT || join(tempRoot, "github-delivery-worktrees");
}
