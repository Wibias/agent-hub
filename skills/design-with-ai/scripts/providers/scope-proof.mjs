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
// Do not collapse distinct Linux filenames containing literal backslashes.
const normalize = (value) => value.split(sep).join("/");
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

function detectorContextEvidence(root, sourceFiles) {
  const contextPaths = new Set();
  const cache = new Map();
  const bindings = [];
  for (const name of DETECTOR_CONFIG_NAMES) {
    const file = join(root, name);
    if (existsSync(file)) contextPaths.add(file);
  }
  for (const file of sourceFiles) {
    const design = designContextFor(dirname(file), cache);
    // The union of policy bytes is insufficient. A newly created package
    // marker can change ONE source file's inherited design policy while
    // another file still retains the same outer DESIGN.md in the union.
    if (design && !isInside(root, design.root)) {
      throw new TypeError("Detector DESIGN.md resolves outside projectRoot");
    }
    bindings.push({
      source: normalize(relative(root, file)),
      designRoot: design ? normalize(relative(root, design.root)) || "." : null,
      designFile: design ? normalize(relative(root, design.file)) : null,
    });
    if (!design) continue;
    contextPaths.add(design.file);
    const sidecar = [
      join(design.root, ".impeccable/design.json"),
      join(design.root, "DESIGN.json"),
      join(design.contextDir, "DESIGN.json"),
    ].find(existsSync);
    if (sidecar) contextPaths.add(sidecar);
  }

  const actual = new Set(sourceFiles);
  const files = [...contextPaths].sort().filter((path) => !actual.has(path)).map((file) => {
    const st = lstatSync(file);
    const canonical = realpathSync(file);
    if (!st.isFile() || st.isSymbolicLink() ||
        canonical !== resolve(file) || !isInside(root, canonical)) {
      throw new TypeError("Detector context dependency must be a regular in-project file");
    }
    return file;
  });
  return { files, bindings };
}

// Impeccable's static-HTML engine reads local <link rel="stylesheet">
// files even when the selected source target is just one HTML file. Bind
// those additional bytes to the same before/after provenance as DESIGN.md.
// This standalone resolver must not import the optional Impeccable provider.
// Recognize actual HTML tags; do not treat <link-button> custom elements
// or <link> samples in comments, raw-text blocks and RCDATA as stylesheets.
// Quote-aware boundaries preserve > characters in attribute values.
function htmlLinkStartTags(html) {
  const tags = [];
  const rawText = new Set(["script", "style", "textarea", "title", "xmp", "iframe", "noembed", "noframes"]);
  // htmlparser2 can parse links inside these parser-dependent regions and
  // after plaintext, whereas the conservative scanner ignores them.
  const ambiguousRaw = new Set(["xmp", "iframe", "noembed", "noframes"]);
  const candidateLink = /<link(?=[\s/>])/i;
  let offset = 0;
  let raw = null;
  while (offset < html.length) {
    if (raw) {
      // The detector parser closes on whitespace, slash, or > after the raw tag name.
      // Otherwise a real stylesheet link after </script x> could be omitted.
      const endTag = new RegExp(`</${raw}(?=[\\s/>])[^>]*>`, "gi");
      endTag.lastIndex = offset;
      const end = endTag.exec(html);
      if (ambiguousRaw.has(raw) &&
          candidateLink.test(html.slice(offset, end?.index ?? html.length))) {
        throw new TypeError("Parser-dependent HTML link region cannot be attested");
      }
      if (!end) break;
      offset = endTag.lastIndex;
      raw = null;
      continue;
    }
    const start = html.indexOf("<", offset);
    if (start < 0) break;
    if (html.startsWith("<!--", start)) {
      const end = html.indexOf("-->", start + 4);
      if (end < 0) break;
      offset = end + 3;
      continue;
    }
    if (html.startsWith("<!", start) || html.startsWith("<?", start)) {
      const end = html.indexOf(">", start + 2);
      if (end < 0) break;
      offset = end + 1;
      continue;
    }
    const named = /^<(\/?)([a-z][a-z0-9:._-]*)/i.exec(html.slice(start));
    if (!named) { offset = start + 1; continue; }
    let quote = null;
    let pos = start + named[0].length;
    for (; pos < html.length; pos += 1) {
      const ch = html[pos];
      if (quote && ch === quote) quote = null;
      else if (!quote && (ch === "'" || ch === '"')) quote = ch;
      else if (!quote && ch === ">") break;
    }
    const kind = named[2].toLowerCase();
    if (pos === html.length) {
      if ((!named[1] && kind === "link") ||
          candidateLink.test(html.slice(start + named[0].length))) {
        throw new TypeError("Ambiguous HTML link markup cannot be attested");
      }
      break;
    }
    // HTML permits literal "<link ...>" examples inside correctly quoted
    // attribute values. Accept those inert examples, but fail closed if a
    // malformed/unquoted attribute can consume a real following link tag.
    if (kind !== "link" && candidateLink.test(html.slice(start + named[0].length, pos))) {
      const body = html.slice(start + named[0].length, pos);
      const attribute = /\s+[^\s"'<>\/=\x60]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<> =\x60]+))?/gy;
      let consumed = 0;
      while (consumed < body.length) {
        if (/^\s*\/?\s*$/.test(body.slice(consumed))) {
          consumed = body.length;
          break;
        }
        attribute.lastIndex = consumed;
        const match = attribute.exec(body);
        if (!match) {
          throw new TypeError("Ambiguous HTML link markup cannot be attested");
        }
        consumed = attribute.lastIndex;
      }
    }
    if (!named[1]) {
      if (kind === "link") tags.push(html.slice(start, pos + 1));
      if (kind === "plaintext") {
        if (candidateLink.test(html.slice(pos + 1))) {
          throw new TypeError("Parser-dependent HTML link region cannot be attested");
        }
        break;
      }
      if (rawText.has(kind) && !/\/\s*>$/.test(html.slice(start, pos + 1))) raw = kind;
    }
    offset = pos + 1;
  }
  return tags;
}

function linkedStylesheetFiles(root, sourceFiles) {
  const paths = new Set();
  const selected = new Set(sourceFiles);
  for (const htmlFile of sourceFiles) {
    if (!/\.html?$/i.test(htmlFile)) continue;
    const html = readFileSync(htmlFile, "utf8");
    const linkTags = htmlLinkStartTags(html);
    let tagCount = 0;
    for (const tag of linkTags) {
      if (++tagCount > 1000) throw new TypeError("Too many HTML stylesheet links to attest");
      const attributes = new Map();
      // The detector accepts some HTML syntax our conservative tokenizer does
      // not (e.g. adjacent quoted attributes and slash-separated attributes).
      // Never attest a partial parse: all tag bytes must be accounted for.
      const tagBody = tag.slice(5, -1);
      // Advance over the ENTIRE tag, including standard valueless attributes
      // (e.g. crossorigin). Whitespace is mandatory between attributes.
      // A partial parse must never certify a stylesheet dependency.
      const attributePattern = /(\s+)([^\s"'<>\/=\x60]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<> =\x60]+)))?/gy;
      let offset = 0;
      while (offset < tagBody.length) {
        if (/^\s*\/?\s*$/.test(tagBody.slice(offset))) break;
        attributePattern.lastIndex = offset;
        const match = attributePattern.exec(tagBody);
        if (!match) {
          throw new TypeError("Ambiguous HTML link attributes cannot be attested");
        }
        const name = match[2].toLowerCase();
        if (attributes.has(name)) {
          throw new TypeError("Duplicate HTML link attribute cannot be attested");
        }
        attributes.set(name, match[3] ?? match[4] ?? match[5] ?? "");
        offset = attributePattern.lastIndex;
      }
      const rel = attributes.get("rel") ?? "";
      const href = attributes.get("href") ?? "";
      if (!href || /^(https?:)?\/\//i.test(href)) continue;
      // htmlparser2 decodes entities in attribute values. A raw-attribute
      // parser must reject encoded relations before testing for "stylesheet":
      // rel="style&#115;heet" otherwise bypasses the proof entirely.
      if (rel.includes("&")) {
        throw new TypeError("Entity-bearing stylesheet rel cannot be attested");
      }
      if (!/\bstylesheet\b/i.test(rel)) continue;
      // The detector removes query/fragment portions before reading disk.
      // Entity-encoded paths cannot be safely matched without HTML parsing:
      // reject them instead of silently omitting a real read dependency.
      const unversioned = href.split(/[?#]/)[0];
      if (unversioned.includes("&")) {
        throw new TypeError("Entity-bearing stylesheet href cannot be attested");
      }
      if (!unversioned) continue;
      const css = resolve(dirname(htmlFile), unversioned);
      if (!existsSync(css)) continue; // Detector also skips unreadable links.
      if (!isInside(root, css)) {
        throw new TypeError("Linked stylesheet escapes declared project scope");
      }
      const st = lstatSync(css);
      const canonical = realpathSync(css);
      if (!st.isFile() || st.isSymbolicLink() ||
          !isInside(realpathSync(root), canonical)) {
        throw new TypeError("Linked stylesheet must be a regular in-project file");
      }
      if (!selected.has(css)) paths.add(css);
    }
  }
  return [...paths].sort();
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
  const contextEvidence = includeDetectorContext
    ? detectorContextEvidence(root, sourceFiles) : { files: [], bindings: null };
  const contextFiles = contextEvidence.files;
  const linkedStylesheets = includeDetectorContext ? linkedStylesheetFiles(root, sourceFiles) : [];
  const inputStat = (file) => {
    const st = statSync(file, { bigint: true });
    return [file, String(st.size), String(st.ctimeNs), String(st.mtimeNs)];
  };
  const renderedAssets = html ? renderedAssetProof({
    projectRoot: root, renderedRoot, html,
  }) : null;
  const observedInputs = [...sourceFiles, ...contextFiles, ...linkedStylesheets].map(inputStat);
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
  const linkedStylesheetProof = linkedStylesheets.map((file) => ({
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
  // renderedAssetProof attests canonical paths: reuse those exact asset keys.
  const renderedPageKey = renderedAssets
    ? normalize(relative(realpathSync(root), realpathSync(html))) : null;
  const rendered = renderedAssets ? {
    page: renderedPageKey,
    sha256: renderedAssets.files.find((asset) =>
      asset.path === renderedPageKey).sha256,
    root: normalize(relative(realpathSync(root), realpathSync(renderedRoot))),
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
    ...(includeDetectorContext ? { detectorBindings: contextEvidence.bindings } : {}),
    ...(detectorContext.length ? { detectorContext } : {}),
    ...(linkedStylesheetProof.length ? { linkedStylesheets: linkedStylesheetProof } : {}),
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
