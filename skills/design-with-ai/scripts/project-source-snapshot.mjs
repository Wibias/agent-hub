#!/usr/bin/env node
// Content-derived fingerprint of product source files at the moment of a
// design iteration gate. Records only a digest and count, not file contents.
// This is a freshness check, not a cryptographic proof of honest tool use.
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";

const MAX_FILES = 12000;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const MAX_GIT_OUTPUT = 8 * 1024 * 1024;
const SOURCE = /\.(?:ts|tsx|js|jsx|mjs|cjs|html|css|scss|sass|less|json|jsonl|md|mdx|yaml|yml|toml|xml|svg|py|sh|ps1|psm1|sql|svelte|vue|astro|php|go|rs|java|kt|swift|rb|txt|ini|graphql|gql|png|jpe?g|webp|gif|ico)$/i;
const SPECIAL = /^(?:Dockerfile|Makefile|Containerfile|\.gitignore|\.prettierignore|\.editorconfig|\.npmrc)$/i;
const GENERATED = /^(?:node_modules|\.git|\.next|\.nuxt|\.cache|coverage|dist|build|test-results|playwright-report|tmp|temp|artifacts|screenshots|\.codex|\.design-with-ai)(?:\/|$)/i;

function git(cwd, ...args) {
  const result = spawnSync("git", ["-C", cwd, ...args], {
    encoding: "buffer", shell: false, maxBuffer: MAX_GIT_OUTPUT,
    windowsHide: true,
  });
  if (result.error) throw new Error("Cannot inspect Git workspace: " + result.error.message);
  if (result.status !== 0) throw new Error("Cannot inspect Git workspace: git " + args[0] + " failed");
  return result.stdout;
}

function gitRoot(cwd) {
  const result = spawnSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], {
    encoding: "utf8", shell: false, windowsHide: true, maxBuffer: 4096,
  });
  if (result.status !== 0) {
    // A plain temporary test directory with no repository does not need a
    // worktree fingerprint. An installed Git failure inside a repository
    // must not silently disable protection.
    let parent = resolve(cwd);
    while (true) {
      try {
        const st = lstatSync(join(parent, ".git"));
        if (st.isDirectory() || st.isFile()) {
          throw new Error("Git project detected but workspace fingerprint is unavailable");
        }
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      const next = resolve(parent, "..");
      if (next === parent) break;
      parent = next;
    }
    return null;
  }
  if (result.error) throw new Error("Git executable is unavailable");
  return resolve(result.stdout.trim());
}

function eligible(path) {
  const unix = path.replaceAll("\\", "/");
  if (GENERATED.test(unix)) return false;
  const name = basename(unix);
  if (/^\.env(?:\.|$)/i.test(name) && name !== ".env.example") return false;
  return SOURCE.test(name) || SPECIAL.test(name);
}

function excluded(path, ignored) {
  const resolved = resolve(path);
  return ignored.has(process.platform === "win32" ? resolved.toLowerCase() : resolved);
}

export function snapshotProjectSource(cwd = process.cwd(), { ignorePaths = [] } = {}) {
  const root = gitRoot(resolve(cwd));
  if (root === null) return null;
  const ignored = new Set(ignorePaths.filter(Boolean).map(x => {
    const path = resolve(x);
    return process.platform === "win32" ? path.toLowerCase() : path;
  }));
  const names = git(root, "ls-files", "--cached", "--others", "--exclude-standard", "-z")
    .toString("utf8").split("\0").filter(Boolean);
  if (names.length > MAX_FILES * 4) throw new Error("Too many repository paths for bounded source check");
  const head = spawnSync("git", ["-C", root, "rev-parse", "HEAD"], {
    encoding: "utf8", shell: false, windowsHide: true, maxBuffer: 4096,
  });
  const digest = createHash("sha256");
  digest.update("design-with-ai/project-source/v1\0");
  digest.update(root.toLowerCase() + "\0");
  digest.update(head.status === 0 ? head.stdout.trim() : "UNBORN");
  digest.update("\0");
  let count = 0;
  let bytes = 0;
  for (const raw of [...new Set(names)].sort()) {
    const rel = raw.replaceAll("\\", "/");
    if (!eligible(rel)) continue;
    const path = resolve(root, rel);
    const relativePath = relative(root, path);
    if (relativePath.startsWith(".." + sep) || relativePath === ".." ||
        isAbsolute(relativePath) || excluded(path, ignored)) continue;
    count++;
    if (count > MAX_FILES) throw new Error("Too many source files for bounded verification");
    digest.update(rel + "\0");
    let st;
    try { st = lstatSync(path); }
    catch (error) {
      if (error.code === "ENOENT") { digest.update("DELETED\0"); continue; }
      throw error;
    }
    if (st.isSymbolicLink()) {
      digest.update("SYMLINK\0" + readlinkSync(path) + "\0");
      continue;
    }
    if (!st.isFile()) { digest.update("NON_FILE\0"); continue; }
    if (st.size > MAX_FILE_BYTES || bytes + st.size > MAX_TOTAL_BYTES) {
      throw new Error("Source snapshot exceeds bounded size; cannot certify post-gate freshness");
    }
    bytes += st.size;
    digest.update(readFileSync(path));
    digest.update("\0");
  }
  return { schemaVersion: 1, sha256: digest.digest("hex"), fileCount: count };
}
