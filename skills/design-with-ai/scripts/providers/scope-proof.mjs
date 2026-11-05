// Reproducible source-scope evidence. A Git HEAD alone is insufficient for dirty trees.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";

const extensions = new Set([".tsx", ".jsx", ".vue", ".svelte", ".html", ".css", ".scss", ".mdx", ".md"]);
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
      else if (entry.isFile() && extensions.has(extname(entry.name).toLowerCase())) files.push(path);
      if (files.length + stack.length > 25000) throw new TypeError("Source scope is too large to attest");
    }
  }
  return files.sort();
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

export function sourceScopeProof({ projectRoot, target, route, renderedRoot = null, html = null }) {
  const root = resolve(projectRoot), source = resolve(target);
  if (!isInside(root, source)) throw new TypeError("Source scope escapes project");
  const files = collectedFiles(source).map((file) => ({
    path: normalize(relative(root, file)),
    sha256: hash(readFileSync(file)),
  }));
  if (!files.length) throw new TypeError("Source scope has no eligible files");
  const rendered = html ? {
    page: normalize(relative(root, resolve(html))),
    sha256: hash(readFileSync(html)),
    root: normalize(relative(root, renderedRoot)),
  } : null;
  const manifest = {
    schemaVersion: 1,
    target: normalize(relative(root, source)) || ".",
    route,
    gitHead: gitHead(root),
    files,
    rendered,
  };
  const sourceSha256 = hash(JSON.stringify(manifest));
  return {
    manifest,
    summary: {
      target: manifest.target,
      route,
      gitHead: manifest.gitHead,
      fileCount: files.length,
      sourceSha256,
      routeBinding: rendered ? "verified-static-html-path" : "declared-source-route",
      rendered,
    },
  };
}

export function staticRouteForHtml(renderedRoot, html) {
  const rel = normalize(relative(renderedRoot, html));
  if (rel === "index.html" || rel === "index.htm") return "/";
  if (rel.endsWith("/index.html") || rel.endsWith("/index.htm")) {
    return "/" + rel.replace(/\/index\.html?$/, "");
  }
  if (/\.html?$/.test(rel)) return "/" + rel.replace(/\.html?$/, "");
  throw new TypeError("Rendered HTML page has no route mapping");
}
