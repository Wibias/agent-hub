#!/usr/bin/env node
// Content-derived fingerprint of product source files at the moment of a
// design iteration gate. Records only a digest and count, not file contents.
// This is a freshness check, not a cryptographic proof of honest tool use.
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readlinkSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_FILES = 12000;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const MAX_GIT_OUTPUT = 8 * 1024 * 1024;
const SOURCE = /\.(?:ts|tsx|js|jsx|mjs|cjs|html|css|scss|sass|less|json|jsonl|md|mdx|yaml|yml|toml|xml|svg|py|sh|ps1|psm1|sql|svelte|vue|astro|php|go|rs|java|kt|swift|rb|cs|csproj|sln|slnx|resx|xaml|axaml|razor|fs|fsproj|vb|props|targets|txt|ini|graphql|gql|png|jpe?g|webp|gif|ico)$/i;
const SPECIAL = /^(?:Dockerfile|Makefile|Containerfile|\.gitignore|\.prettierignore|\.editorconfig|\.npmrc)$/i;
const GENERATED = /^(?:node_modules|\.git|\.vs|\.next|\.nuxt|\.cache|coverage|dist|build|bin|obj|publish|test-results|playwright-report|tmp|temp|artifacts|screenshots|\.codex|\.design-with-ai)(?:\/|$)/i;

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


/**
 * Explicit, bounded source fingerprint for native projects without Git.
 * This never silently replaces a failed Git check. The caller must supply
 * the source root, so an unrelated broken ancestor .git can be left alone.
 */
export function snapshotRootedSource(sourceRoot, { ignorePaths = [] } = {}) {
  if (typeof sourceRoot !== "string" || !isAbsolute(sourceRoot)) {
    throw new Error("Rooted fingerprint requires an absolute project source root");
  }
  const root = resolve(sourceRoot);
  const stRoot = lstatSync(root);
  if (!stRoot.isDirectory() || stRoot.isSymbolicLink()) {
    throw new Error("Project source root must be a real directory");
  }
  const ignored = new Set(ignorePaths.filter(Boolean).map(x => {
    const path = resolve(x);
    return process.platform === "win32" ? path.toLowerCase() : path;
  }));
  const digest = createHash("sha256");
  digest.update("design-with-ai/rooted-source/v1\0" + root.toLowerCase() + "\0");
  let count = 0, totalBytes = 0, visited = 0;
  const queue = [{ dir: root, rel: "" }];
  while (queue.length) {
    const { dir, rel } = queue.pop();
    if (++visited > MAX_FILES * 4) throw new Error("Too many directories for bounded source check");
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const entry of entries) {
      const relPath = rel ? rel + "/" + entry.name : entry.name;
      if (GENERATED.test(relPath) || (entry.isDirectory() && GENERATED.test(entry.name + "/"))) continue;
      const full = resolve(dir, entry.name);
      if (excluded(full, ignored)) continue;
      const st = lstatSync(full);
      if (st.isSymbolicLink()) {
        // Do not traverse links/junctions into a different source tree.
        if (!eligible(relPath)) continue;
        digest.update(relPath + "\0SYMLINK\0" + readlinkSync(full) + "\0");
        count++;
      } else if (st.isDirectory()) {
        queue.push({ dir: full, rel: relPath });
      } else if (st.isFile() && eligible(relPath)) {
        count++;
        if (st.size > MAX_FILE_BYTES || totalBytes + st.size > MAX_TOTAL_BYTES) {
          throw new Error("Source snapshot exceeds bounded size");
        }
        totalBytes += st.size;
        digest.update(relPath + "\0");
        digest.update(readFileSync(full));
        digest.update("\0");
      }
      if (count > MAX_FILES) throw new Error("Too many source files for bounded check");
    }
  }
  if (count === 0) throw new Error("Source root contains no eligible project source files");
  return { schemaVersion: 1, sourceMode: "ROOTED_DIRECTORY", sha256: digest.digest("hex"), fileCount: count };
}


/**
 * Last native UI source edit for deciding if a *receipt* postdates its
 * candidate. Content hashing alone cannot catch a receipt from yesterday
 * being reused after edits and blessed with a brand-new proof today.
 * This checks filesystem order, not screenshots, honest authorship or
 * cryptographic timestamps. The validator must retain the full source hash.
 */
export function latestNativeSourceEdit(sourceRoot) {
  if (typeof sourceRoot !== "string" || !isAbsolute(sourceRoot)) {
    throw new Error("Native source freshness requires an absolute source root");
  }
  const root = resolve(sourceRoot);
  const state = lstatSync(root);
  if (!state.isDirectory() || state.isSymbolicLink()) {
    throw new Error("Native source root must be a real directory");
  }
  const native = /\.(?:cs|csproj|resx|xaml|axaml|razor|vb|vbproj|fs|fsproj|props|targets)$/i;
  const queue = [{ dir: root, rel: "" }];
  let newest = null, files = 0, visited = 0;
  while (queue.length) {
    const { dir, rel } = queue.pop();
    if (++visited > MAX_FILES * 4) throw new Error("Native source freshness directory budget exceeded");
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const relPath = rel ? rel + "/" + entry.name : entry.name;
      if (GENERATED.test(relPath) || (entry.isDirectory() && GENERATED.test(entry.name + "/"))) continue;
      const full = join(dir, entry.name);
      const st = lstatSync(full);
      if (st.isSymbolicLink()) continue; // no junction traversal
      if (st.isDirectory()) {
        queue.push({ dir: full, rel: relPath });
      } else if (st.isFile() && native.test(entry.name)) {
        if (++files > MAX_FILES) throw new Error("Native source freshness file budget exceeded");
        if (newest === null || st.mtimeMs > newest.mtimeMs) {
          newest = { relativePath: relPath, mtimeMs: st.mtimeMs };
        }
      }
    }
  }
  return newest === null ? null : { ...newest, fileCount: files };
}

export function nativeReceiptFreshness(receiptPath, sourceRoot) {
  if (sourceRoot === null) return { valid: true, latest: null };
  const latest = latestNativeSourceEdit(sourceRoot);
  if (latest === null) return { valid: true, latest: null };
  const receiptTime = statSync(resolve(receiptPath)).mtimeMs;
  // Allow coarse filesystem timestamps; real edits minutes after a
  // receipt must not pass this comparison.
  const toleranceMs = 1500;
  return {
    valid: latest.mtimeMs <= receiptTime + toleranceMs,
    latest,
    receiptMtimeMs: receiptTime,
  };
}

/**
 * Automatic but strictly anchored source-root detection for Gitless native
 * monitors. We accept only a project-local .design-with-ai artifact directory
 * and a real C# project marker at the inferred root. Never walk upward into
 * unrelated workspaces or silently forgive broken Git metadata.
 */
export function discoverNativeSourceRoot({ receipt = null, ledger = null } = {}) {
  const paths = [receipt, ledger].filter(x => typeof x === "string" && x.trim());
  if (!paths.length) return null;
  let root = null;
  for (const name of paths) {
    const full = resolve(name);
    const parent = dirname(full);
    if (basename(parent).toLowerCase() !== ".design-with-ai") return null;
    const next = dirname(parent);
    if (root !== null && (process.platform === "win32" ?
        next.toLowerCase() !== root.toLowerCase() : next !== root)) {
      throw new Error("Receipt and ledger belong to different product roots");
    }
    root = next;
  }
  if (ledger !== null && resolve(ledger) !== resolve(root, ".design-with-ai", "findings-ledger.json")) {
    throw new Error("Cannot infer product root from a noncanonical findings ledger");
  }
  let entries;
  try {
    const st = lstatSync(root);
    if (!st.isDirectory() || st.isSymbolicLink()) return null;
    entries = readdirSync(root, { withFileTypes: true });
  } catch { return null; }
  // Require a concrete product marker, not just a folder named MemoryGuardian.
  if (!entries.some(x => x.isFile() && /\.csproj$/i.test(x.name))) return null;
  return root;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 0 && (args.length !== 2 || args[0] !== "--source-root")) throw new Error("Usage: node project-source-snapshot.mjs [--source-root <absolute-source-dir>]");
    const result = args.length ? snapshotRootedSource(resolve(args[1])) : snapshotProjectSource(process.cwd());
    if (result === null) throw new Error("No Git project detected; pass --source-root for an explicit Gitless project");
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } catch (error) {
    process.stderr.write("Cannot fingerprint current product source: " + error.message + "\n");
    process.exitCode = 2;
  }
}
