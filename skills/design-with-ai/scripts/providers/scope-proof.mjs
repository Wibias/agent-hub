// Reproducible source-scope evidence. A Git HEAD alone is insufficient for dirty trees.
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { renderedAssetProof } from "./rendered-assets.mjs";

// Superset of native DWA and vendored Impeccable file extensions.
const extensions = new Set([
  ".tsx", ".jsx", ".vue", ".svelte", ".html", ".htm", ".css", ".scss",
  ".sass", ".less", ".mdx", ".md", ".js", ".ts", ".astro", ".blade.php",
]);
const eligible = (name) => {
  const lower = name.toLowerCase();
  return extensions.has(extname(lower)) || lower.endsWith(".blade.php");
};
const skipped = new Set(["node_modules", ".git", "dist", "build", ".next"]);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const normalize = (value) => value.replaceAll("\\", "/");
const isInside = (root, path) => {
  const rel = relative(root, path);
  return rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel);
};

function collectedFiles(target) {
  const source = lstatSync(target);
  if (source.isSymbolicLink()) throw new TypeError("Source may not be a symlink");
  if (source.isFile()) return [target];
  const files = [], stack = [target];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory() && !skipped.has(entry.name)) stack.push(path);
      else if (entry.isFile() && eligible(entry.name)) files.push(path);
      if (files.length + stack.length > 25000) throw new TypeError("Source scope is too large to attest");
    }
  }
  return files.sort();
}

// Config and design policy affect a source-scan verdict even when they are
// outside the selected source subtree. Hash precisely the local dependency
// files used by the bundled detector; never embed their contents in evidence.
// This source-boundary resolver deliberately does NOT import Impeccable: the
// native DWA quick profile must remain operational without that provider.
const DESIGN_NAMES = ["DESIGN.md", "Design.md", "design.md"];
const DESIGN_FALLBACK_DIRS = [".agents/context", "docs"];
const ROOT_MARKERS = [".git", "package.json", ".impeccable"];
const DETECTOR_CONFIG_NAMES = [
  ".impeccable/config.json", ".impeccable/config.local.json",
];

function firstExistingDirectoryFile(dir, names) {
  return names.map((name) => join(dir, name)).find(existsSync) ?? null;
}

function designAt(dir) {
  const direct = firstExistingDirectoryFile(dir, DESIGN_NAMES);
  if (direct) return { file: direct, contextDir: dir, root: dir };
  for (const contextDir of DESIGN_FALLBACK_DIRS) {
    const sub = join(dir, contextDir);
    const file = firstExistingDirectoryFile(sub, DESIGN_NAMES);
    if (file) return { file, contextDir: sub, root: dir };
  }
  return null;
}

function designContextFor(directory, cache) {
  const visited = [];
  let dir = resolve(directory);
  const home = resolve(homedir());
  const remember = (result) => {
    for (const part of visited) cache.set(part, result);
    return result;
  };
  while (true) {
    if (cache.has(dir)) return remember(cache.get(dir));
    visited.push(dir);
    // A local design document takes precedence over a local package marker,
    // matching the vendored detector's project-root semantics.
    const found = designAt(dir);
    if (found) return remember(found);
    if (ROOT_MARKERS.some((name) => existsSync(join(dir, name)))) {
      return remember(null);
    }
    if (dir === home) return remember(null);
    const parent = dirname(dir);
    if (parent === dir) return remember(null);
    dir = parent;
  }
}

function detectorContextFiles(root, sourceFiles) {
  const contextPaths = new Set();
  const cache = new Map();
  for (const name of DETECTOR_CONFIG_NAMES) {
    const file = join(root, name);
    if (existsSync(file)) contextPaths.add(file);
  }
  for (const file of sourceFiles) {
    const design = designContextFor(dirname(file), cache);
    if (!design) continue;
    // A design policy outside the declared project boundary can influence
    // this scan but cannot honestly be claimed as in-scope provenance.
    if (!isInside(root, design.root)) {
      throw new TypeError("Detector DESIGN.md resolves outside projectRoot");
    }
    contextPaths.add(design.file);
    const sidecar = [
      join(design.root, ".impeccable/design.json"),
      join(design.root, "DESIGN.json"),
      join(design.contextDir, "DESIGN.json"),
    ].find(existsSync);
    if (sidecar) contextPaths.add(sidecar);
  }

  const actual = new Set(sourceFiles);
  return [...contextPaths].sort().filter((path) => !actual.has(path)).map((file) => {
    const st = lstatSync(file);
    const canonical = realpathSync(file);
    if (!st.isFile() || st.isSymbolicLink() ||
        canonical !== resolve(file) || !isInside(root, canonical)) {
      throw new TypeError("Detector context dependency must be a regular in-project file");
    }
    return file;
  });
}

function gitHead(root) {
  try {
    return execFileSync("git", ["-C", root, "rev-parse", "--verify", "HEAD"], {
      encoding: "utf8", timeout: 1500, maxBuffer: 256,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() || null;
  } catch {
    return null;
  }
}

export function sourceScopeProof({
  projectRoot, target, route, renderedRoot = null, html = null,
  intentPath = null, includeDetectorContext = true,
}) {
  const root = resolve(projectRoot), source = resolve(target);
  if (!isInside(root, source)) throw new TypeError("Source scope escapes project");
  const sourceFiles = collectedFiles(source);
  // Quick/native-only audits must not fail on unrelated Impeccable policy
  // files. Caller opts into these dependencies only when selecting Impeccable.
  const contextFiles = includeDetectorContext ? detectorContextFiles(root, sourceFiles) : [];
  const inputStat = (file) => {
    const st = statSync(file, { bigint: true });
    return [file, String(st.size), String(st.ctimeNs), String(st.mtimeNs)];
  };
  const renderedAssets = html ? renderedAssetProof({
    projectRoot: root, renderedRoot, html,
  }) : null;
  const observedInputs = [...sourceFiles, ...contextFiles].map(inputStat);
  if (intentPath) observedInputs.push(inputStat(resolve(intentPath)));
  if (renderedAssets) for (const asset of renderedAssets.files) {
    observedInputs.push(inputStat(resolve(root, asset.path)));
  }
  const files = sourceFiles.map((file) => ({
    path: normalize(relative(root, file)),
    sha256: hash(readFileSync(file)),
  }));
  if (!files.length) throw new TypeError("Source scope has no eligible files");
  const detectorContext = contextFiles.map((file) => ({
    path: normalize(relative(root, file)),
    sha256: hash(readFileSync(file)),
  }));
  const intent = intentPath ? (() => {
    const path = resolve(intentPath), st = lstatSync(path);
    if (!st.isFile() || st.isSymbolicLink()) {
      throw new TypeError("Intent contract must be an existing regular file");
    }
    return {
      path: isInside(root, path) ? normalize(relative(root, path)) : "<external-intent>",
      sha256: hash(readFileSync(path)),
    };
  })() : null;
  const rendered = renderedAssets ? {
    page: normalize(relative(root, resolve(html))),
    sha256: renderedAssets.files.find((asset) =>
      asset.path === normalize(relative(root, resolve(html)))).sha256,
    root: normalize(relative(root, renderedRoot)),
    assetCount: renderedAssets.fileCount,
    assetTotalBytes: renderedAssets.totalBytes,
    assetTreeSha256: renderedAssets.filesSha256,
    assetCoverage: "COMPLETE_LOCAL_TREE_BOUNDED",
  } : null;
  const manifest = {
    schemaVersion: 1,
    target: normalize(relative(root, source)) || ".",
    route,
    gitHead: gitHead(root),
    files,
    ...(detectorContext.length ? { detectorContext } : {}),
    ...(renderedAssets ? { renderedAssets } : {}),
    intent,
    rendered,
  };
  const sourceSha256 = hash(JSON.stringify(manifest));
  return {
    manifest,
    // Detect changed-then-restored files on filesystems with reliable ctime.
    // This is not an OS-level immutable snapshot or an attacker-proof guarantee.
    observedInputsSha256: hash(JSON.stringify(observedInputs)),
    summary: {
      target: manifest.target,
      route,
      gitHead: manifest.gitHead,
      fileCount: files.length,
      intent,
      sourceSha256,
      routeBinding: rendered ? "verified-static-html-path" : "declared-source-route",
      rendered,
    },
  };
}

export function staticRouteForHtml(renderedRoot, html) {
  const rel = normalize(relative(renderedRoot, html)).replace(/\.html?$/i, (ext) => ext.toLowerCase());
  if (rel === "index.html" || rel === "index.htm") return "/";
  if (rel.endsWith("/index.html") || rel.endsWith("/index.htm")) {
    return "/" + rel.replace(/\/index\.html?$/, "");
  }
  if (/\.html?$/.test(rel)) return "/" + rel.replace(/\.html?$/, "");
  throw new TypeError("Rendered HTML page has no route mapping");
}
