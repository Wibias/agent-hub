// Bounded, read-only snapshot of *all* files served from a local built-site root.
// No dependency inference: a complete subtree manifest avoids silently missing
// CSS, JavaScript, images, fonts, dynamic imports and nonstandard file suffixes.
import { createHash } from "node:crypto";
import {
  closeSync, constants, existsSync, fstatSync, lstatSync, openSync,
  readSync, readdirSync, realpathSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

const MAX_FILES = 10_000;
const MAX_ENTRIES = 15_000;
const MAX_DEPTH = 64;
const MAX_FILE_BYTES = 128 * 1024 * 1024;
const MAX_TOTAL_BYTES = 512 * 1024 * 1024;
const BUFFER_BYTES = 64 * 1024;

const sha = (input) => createHash("sha256").update(input).digest("hex");
const pathSlashes = (value) => value.replaceAll("\\", "/");
const within = (root, path) => {
  const rel = relative(root, path);
  return rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel);
};

function hashRegularFile(file, expectedSize) {
  let fd;
  try {
    // O_NOFOLLOW on supported platforms closes the window where a file is
    // swapped for a symlink between directory listing and open().
    fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const before = fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.size !== BigInt(expectedSize)) {
      throw new TypeError("Rendered file changed before its contents could be attested");
    }
    const h = createHash("sha256");
    const buffer = Buffer.allocUnsafe(BUFFER_BYTES);
    let bytes = 0;
    while (true) {
      const size = readSync(fd, buffer, 0, buffer.length, null);
      if (size === 0) break;
      bytes += size;
      if (bytes > expectedSize) {
        throw new TypeError("Rendered file changed size while being hashed");
      }
      h.update(buffer.subarray(0, size));
    }
    const after = fstatSync(fd, { bigint: true });
    if (bytes !== expectedSize || before.size !== after.size ||
        before.ctimeNs !== after.ctimeNs || before.mtimeNs !== after.mtimeNs ||
        before.ino !== after.ino || before.dev !== after.dev) {
      throw new TypeError("Rendered file changed during hashing");
    }
    return h.digest("hex");
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * Returns an inspectable, bounded full-subtree manifest, including *every*
 * regular file regardless of extension. The caller stores only digests and
 * relative paths, never the assets' contents.
 *
 * A "complete" asset manifest means the tree was traversed and hashed at
 * this instant; not that browser cache/remote assets are attested.
 */
export function renderedAssetProof({ projectRoot, renderedRoot, html }) {
  if (![projectRoot, renderedRoot, html].every((v) =>
    typeof v === "string" && v.trim())) {
    throw new TypeError("Rendered asset proof needs a project root, build root and HTML");
  }
  const project = resolve(projectRoot);
  const root = resolve(renderedRoot);
  const page = resolve(html);
  if (!existsSync(project) || !lstatSync(project).isDirectory() ||
      lstatSync(project).isSymbolicLink() ||
      !existsSync(root) || !lstatSync(root).isDirectory() ||
      lstatSync(root).isSymbolicLink() ||
      !existsSync(page) || !lstatSync(page).isFile() ||
      lstatSync(page).isSymbolicLink()) {
    throw new TypeError("Rendered roots and HTML must exist without symlink targets");
  }
  const canonicalProject = realpathSync(project);
  const canonicalRoot = realpathSync(root);
  const canonicalPage = realpathSync(page);
  if (!within(canonicalProject, canonicalRoot) ||
      canonicalProject === canonicalRoot ||
      !within(canonicalRoot, canonicalPage)) {
    throw new TypeError("Rendered assets must be an isolated in-project build subtree");
  }

  let totalBytes = 0;
  let entryCount = 0;
  const assetFiles = [];
  const stack = [{ directory: canonicalRoot, depth: 0 }];
  while (stack.length) {
    const { directory, depth } = stack.pop();
    if (depth > MAX_DEPTH) throw new TypeError("Rendered asset tree exceeds maximum depth");
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (++entryCount > MAX_ENTRIES) {
        throw new TypeError("Rendered asset tree exceeds entry count limit");
      }
      const path = join(directory, entry.name);
      // No skipped hidden directories or file-type allowlist. An excluded file
      // could still be imported by CSS or served dynamically.
      if (entry.isSymbolicLink()) {
        throw new TypeError("Symlink inside rendered asset tree cannot be attested");
      }
      if (entry.isDirectory()) {
        stack.push({ directory: path, depth: depth + 1 });
        continue;
      }
      if (!entry.isFile()) {
        throw new TypeError("Non-regular entry inside rendered asset tree cannot be attested");
      }
      const state = lstatSync(path);
      if (!state.isFile() || state.isSymbolicLink()) {
        throw new TypeError("Rendered asset changed type during traversal");
      }
      if (!Number.isSafeInteger(state.size) || state.size > MAX_FILE_BYTES) {
        throw new TypeError("Rendered asset exceeds per-file byte limit");
      }
      totalBytes += state.size;
      if (totalBytes > MAX_TOTAL_BYTES) {
        throw new TypeError("Rendered assets exceed total byte limit");
      }
      if (assetFiles.length >= MAX_FILES) {
        throw new TypeError("Rendered assets exceed file-count limit");
      }
      const canonicalFile = realpathSync(path);
      if (!within(canonicalRoot, canonicalFile)) {
        throw new TypeError("Rendered asset escapes build subtree");
      }
      assetFiles.push({
        path: pathSlashes(relative(canonicalProject, canonicalFile)),
        bytes: state.size,
        sha256: hashRegularFile(canonicalFile, state.size),
      });
    }
  }
  assetFiles.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  if (!assetFiles.some((asset) =>
    asset.path === pathSlashes(relative(canonicalProject, canonicalPage)))) {
    throw new TypeError("Requested rendered HTML was not attested");
  }
  return {
    schemaVersion: 1,
    kind: "dwa/complete-local-rendered-tree",
    files: assetFiles,
    fileCount: assetFiles.length,
    totalBytes,
    filesSha256: sha(JSON.stringify(assetFiles)),
    limits: {
      maxFiles: MAX_FILES,
      maxEntries: MAX_ENTRIES,
      maxDepth: MAX_DEPTH,
      maxFileBytes: MAX_FILE_BYTES,
      maxTotalBytes: MAX_TOTAL_BYTES,
    },
    limitations: "Local regular build files only; remote resources, service-worker caches, request timing and authenticated browser state are not proven.",
  };
}
