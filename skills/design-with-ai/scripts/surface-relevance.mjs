#!/usr/bin/env node
// Static surface binding for read-only design audits.
// This is evidence triage, not a verdict and not a substitute for rendered checks.
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_EXTENSION = /\.(?:html?|css|scss|sass|less|jsx?|mjs|cjs|tsx?|vue|svelte|astro|md)$/i;
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage", "__pycache__", ".git"]);
const MAX_FILES = 6000;
const MAX_CLOSURE_FILES = 800;
const MAX_READ_BYTES = 2_000_000;
const SOURCE_ROOTS = ["src", "app", "lib", "components", "packages"];

const CONFIG = Object.freeze({
  extensions: ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".css", ".scss", ".sass", ".less"],
  index: ["index.ts", "index.tsx", "index.js", "index.jsx", "index.css"],
});

const toPosix = (value) => value.split(sep).join("/");
const filled = (value) => typeof value === "string" && value.trim().length > 0;
const lower = (value) => String(value ?? "").toLowerCase();

function inside(root, target) {
  const rel = relative(root, target);
  return rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel);
}

export function collectSourceFiles(target, projectRoot) {
  const root = resolve(projectRoot);
  const start = isAbsolute(target) ? resolve(target) : resolve(root, target);
  if (!inside(root, start)) throw new Error("Surface target is outside the project root");
  const files = [];
  const stack = [start];
  while (stack.length && files.length < MAX_FILES) {
    const current = stack.pop();
    if (!existsSync(current)) continue;
    const stat = lstatSync(current);
    if (stat.isFile()) {
      if (SOURCE_EXTENSION.test(current)) files.push(toPosix(relative(root, current)));
      continue;
    }
    if (!stat.isDirectory()) continue;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;
      if (entry.isDirectory() && entry.name.startsWith(".") && entry.name !== ".vitepress" && entry.name !== ".storybook") continue;
      const child = join(current, entry.name);
      if (entry.isDirectory()) stack.push(child);
      else if (entry.isFile() && SOURCE_EXTENSION.test(entry.name)) files.push(toPosix(relative(root, child)));
    }
  }
  return files.sort((a, b) => a.localeCompare(b));
}

function readText(root, file) {
  const absolute = resolve(root, file);
  if (!inside(root, absolute)) return "";
  try {
    const stat = lstatSync(absolute);
    if (!stat.isFile()) return "";
    // Bounded read: large generated files cannot dominate the route decision.
    const buffer = readFileSync(absolute);
    return buffer.subarray(0, MAX_READ_BYTES).toString("utf8");
  } catch {
    return "";
  }
}

function routeSegments(route) {
  const clean = String(route ?? "").split(/[?#]/)[0];
  return clean.split("/").filter(Boolean).map((segment) => {
    let decoded = segment;
    try { decoded = decodeURIComponent(segment); } catch { /* keep raw */ }
    return decoded.toLowerCase();
  });
}

function routePatterns(route) {
  const segments = routeSegments(route);
  // A bare `/` cannot be searched as a substring without matching every file.
  if (!segments.length) return ['path="/"', "path='/'"];
  const patterns = new Set(["/" + segments.join("/")]);
  for (let index = 1; index <= segments.length; index += 1) {
    const prefix = "/" + segments.slice(0, index).join("/");
    patterns.add(prefix);
    for (const tail of ["/*", "/:tab", "/:section", "/:slug", "/:id"]) patterns.add(prefix + tail);
  }
  return [...patterns].filter(Boolean);
}

function pathScore(file, segments) {
  if (!segments.length) return 0;
  const normalized = file.toLowerCase();
  const matched = segments.filter((segment) => normalized.includes(segment)).length;
  if (!matched) return 0;
  // Only route-owned filenames earn the partial-match bonus. A settings tab
  // component is reachable from the route, but it is not the route entry.
  const routeRole = /(page|route|view|screen)\.[a-z]+$/.test(normalized)
    || /(^|\/)(app|routes)\//.test(normalized);
  if (matched === segments.length) return 60;
  // A settings page owns /settings/interface even when the leaf is a tab.
  return routeRole && matched >= 1 ? 55 : 0;
}

function findAnchors(root, files, route) {
  const patterns = routePatterns(route);
  const segments = routeSegments(route);
  const anchors = [];
  const references = [];
  for (const file of files) {
    if (!SOURCE_EXTENSION.test(file)) continue;
    const text = readText(root, file);
    let best = 0;
    let reason = null;
    let role = null;
    for (const pattern of patterns) {
      if (!text.includes(pattern)) continue;
      // `t("routes:...")` is a translation key, not a route registry.
      const registration = /<Route\b|createBrowserRouter\s*\(|useRoutes\s*\(|\bRouteObject\b|\bcreateRoutesFromElements\b/i.test(text);
      const score = registration ? 100 : 20;
      if (score > best) {
        best = score;
        reason = registration ? "route-registration" : "navigation-reference";
        role = registration ? "registration" : "reference";
      }
    }
    const path = pathScore(file, segments);
    if (path >= 55) {
      if (path > best) { best = path; reason = "route-path"; }
      role = /\.(?:css|scss|sass|less)$/i.test(file) ? "style" : "page";
    }
    if (best >= 55) anchors.push({ file, score: best, reason, role });
    else if (best > 0) references.push({ file, score: best, reason });
  }
  anchors.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));
  references.sort((a, b) => a.file.localeCompare(b.file));
  return { anchors: anchors.slice(0, 24), references: references.slice(0, 40) };
}

function importSpecifiers(text, file) {
  const specifiers = [];
  const patterns = [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
    /@import\s+(?:url\()?["']([^"']+)["']/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = match[1].trim();
      if (value && !specifiers.includes(value)) specifiers.push(value);
    }
  }
  return specifiers;
}

function resolveImport(root, files, fromFile, specifier) {
  if (!filled(specifier) || /^[a-z]+:/i.test(specifier)) return null;
  const candidates = [];
  if (specifier.startsWith(".")) {
    candidates.push(resolve(dirname(resolve(root, fromFile)), specifier));
  } else if (specifier.startsWith("@/")) {
    const suffix = specifier.slice(2);
    for (const sourceRoot of SOURCE_ROOTS) candidates.push(resolve(root, sourceRoot, suffix));
  } else if (specifier.startsWith("~")) {
    candidates.push(resolve(root, specifier.slice(1)));
  } else {
    return null;
  }
  const known = new Set(files);
  for (const candidate of candidates) {
    for (const extension of CONFIG.extensions) {
      const path = candidate + extension;
      if (existsSync(path) && lstatSync(path).isFile()) {
        const rel = toPosix(relative(root, path));
        if (known.has(rel)) return rel;
      }
    }
    if (!existsSync(candidate) || !lstatSync(candidate).isDirectory()) continue;
    for (const index of CONFIG.index) {
      const path = join(candidate, index);
      if (!existsSync(path) || !lstatSync(path).isFile()) continue;
      const rel = toPosix(relative(root, path));
      if (known.has(rel)) return rel;
    }
  }
  return null;
}

function buildClosure(root, files, anchors) {
  const known = new Set(files);
  const relation = new Map();
  const queue = [];
  const pageAnchors = anchors.filter((anchor) => anchor.role === "page" || anchor.role === "style");
  const registrationAnchors = anchors.filter((anchor) => anchor.role === "registration");
  // A route registry imports every page in the application. Follow only the
  // route-owned page when one exists; otherwise the closure would sprawl into
  // unrelated routes and recreate the label-only problem.
  const roots = pageAnchors.length ? pageAnchors : registrationAnchors;
  for (const anchor of roots) {
    relation.set(anchor.file, { relation: "route-entry", depth: 0, reason: anchor.reason });
    queue.push({ file: anchor.file, depth: 0 });
  }
  for (const anchor of registrationAnchors) {
    if (!relation.has(anchor.file)) {
      relation.set(anchor.file, { relation: "route-entry", depth: 0, reason: anchor.reason });
    }
  }
  let steps = 0;
  while (queue.length && steps < MAX_CLOSURE_FILES * 4) {
    const current = queue.shift();
    steps += 1;
    if (current.depth >= 2) continue;
    const text = readText(root, current.file);
    for (const specifier of importSpecifiers(text, current.file)) {
      const resolved = resolveImport(root, files, current.file, specifier);
      if (!resolved || !known.has(resolved) || relation.has(resolved)) continue;
      const isStyle = /\.(?:css|scss|sass|less)$/i.test(resolved);
      const relationName = isStyle ? "direct-style" : current.depth === 0 ? "direct" : "shared";
      relation.set(resolved, { relation: relationName, depth: current.depth + 1, reason: "local-import" });
      queue.push({ file: resolved, depth: current.depth + 1 });
    }
  }
  return relation;
}

function relationFor(relation, file) {
  if (relation.has(file)) return relation.get(file);
  return { relation: "context", depth: null, reason: "not-reachable-from-route" };
}

function textCandidates(finding) {
  const candidates = [];
  for (const item of finding.evidence ?? []) {
    const snippet = String(item.snippet ?? "");
    if (!snippet) continue;
    const withoutTemplates = snippet
      .replace(/`[^`]*\$\{[^}]*\}[^`]*`/g, " ")
      .replace(/\{[^{}]*\}/g, " ")
      .replace(/[<>{}]/g, " ");
    for (const match of withoutTemplates.matchAll(/["']([^"']{3,})["']/g)) {
      candidates.push(match[1]);
    }
    const words = withoutTemplates.match(/[A-Za-zÄÖÜäöüß]{4,}/g) ?? [];
    const codeWords = new Set([
      "const", "return", "value", "option", "classname", "import", "from",
      "true", "false", "null", "undefined", "kind", "model", "snapshot",
      "claimerror", "layout", "option", "visible",
    ]);
    const filtered = words.filter((word) => !codeWords.has(word.toLowerCase()));
    if (filtered.length >= 2) candidates.push(filtered.slice(0, 6).join(" "));
  }
  const unique = [...new Set(candidates.map((value) => value.trim()).filter((value) => value.length >= 3))];
  return unique.slice(0, 5);
}

function visibilityFor(finding, visibleText) {
  if (!filled(visibleText)) return { visibility: "unknown", reason: "no-rendered-text-captured" };
  const haystack = lower(visibleText).replace(/\s+/g, " ");
  const candidates = textCandidates(finding);
  if (!candidates.length) return { visibility: "unknown", reason: "no-extractable-copy" };
  for (const candidate of candidates) {
    const needle = lower(candidate).replace(/\s+/g, " ");
    if (needle.length >= 4 && haystack.includes(needle)) return { visibility: "visible", reason: "copy-found-in-rendered-text" };
  }
  return { visibility: "not-visible", reason: "copy-absent-from-rendered-text" };
}

function lowerPriority(priority) {
  return priority === "P1" ? "P2" : priority === "P2" ? "P3" : priority;
}

function surfacePriorityFor(finding, relevance, visibility, relation) {
  if (finding.priority === "P0") return "P0";
  const category = lower(finding.category);
  const isCopy = category.startsWith("copy") || /copy|wording|text/i.test(String(finding.message));
  if (isCopy) {
    if (relevance === "ROUTE" && visibility === "visible") return "P2";
    // Only the route-owned page can carry an unverified copy heuristic at P2.
    // A directly imported panel or shared component may never render in this
    // state, so it stays a context note until visible text confirms it.
    if (relevance === "ROUTE" && visibility === "unknown" && relation === "route-entry") return "P2";
    return "P3";
  }
  if (relevance === "CONTEXT" || relevance === "UNBOUND") return lowerPriority(finding.priority);
  return finding.priority;
}

function relevanceFor(relation, visibility, category) {
  if (relation === "unbound") return "UNBOUND";
  if (relation === "route-entry" || relation === "direct" || relation === "direct-style") return "ROUTE";
  if (relation === "shared") return "SHARED";
  return "CONTEXT";
}

const CHECK_PATTERNS = [
  {
    id: "control-boundary-contrast",
    pattern: /(?:type\s*=\s*["'](?:checkbox|radio)["']|role\s*=\s*["'](?:checkbox|radio)["'])/i,
    states: ["unchecked", "checked", "focus-visible", "disabled"],
    measurement: "Measure the control boundary and fill against the adjacent composited background; report the ratio and whether the boundary is the only identifying cue.",
  },
  {
    id: "tablist-keyboard-aria",
    pattern: /role\s*=\s*["']tablist["']/i,
    states: ["selected", "unselected", "hover", "focus-visible"],
    measurement: "Inspect tab stops, aria-selected, aria-controls targets, orientation, arrow/Home/End behaviour, and focus/selection sync.",
  },
  {
    id: "select-boundary-contrast",
    pattern: /<select\b/i,
    states: ["default", "focus-visible", "disabled"],
    measurement: "Measure the field boundary/fill against its adjacent background; confirm text and the disclosure icon identify the control.",
  },
  {
    id: "state-precedence",
    pattern: /:hover/i,
    states: ["selected-hover", "checked-hover", "focus-visible"],
    measurement: "Compare the selected/checked treatment with its hover and focus treatments; the active state must remain the strongest identity cue.",
  },
  {
    id: "disclosure-keyboard",
    pattern: /(?:aria-expanded|role\s*=\s*["']dialog["']|role\s*=\s*["']menu["'])/i,
    states: ["closed", "open", "focus-visible", "escape"],
    measurement: "Inspect trigger/panel relationship, focus entry and return, Escape, and expanded state.",
  },
];

function buildPlan(root, files, relation) {
  const inScope = files.filter((file) => ["route-entry", "direct", "direct-style", "shared"].includes(relationFor(relation, file).relation));
  const checks = [];
  for (const check of CHECK_PATTERNS) {
    const because = inScope.filter((file) => check.pattern.test(readText(root, file))).slice(0, 8);
    if (because.length) checks.push({ id: check.id, because, states: check.states, measurement: check.measurement });
  }
  return {
    requiredChecks: checks,
    stateMatrix: checks.map((check) => ({ check: check.id, inspect: check.states })),
  };
}

export function classifySurfaceFindings({
  projectRoot, target, route, findings = [], files = null, visibleText = null,
}) {
  const root = resolve(projectRoot);
  if (!filled(route)) throw new TypeError("A route is required for surface relevance");
  const absoluteTarget = isAbsolute(target) ? resolve(target) : resolve(root, target);
  const sourceFiles = Array.isArray(files) && files.length ? files.slice() : collectSourceFiles(absoluteTarget, root);
  const found = findAnchors(root, sourceFiles, route);
  const anchors = found.anchors;
  const relation = buildClosure(root, sourceFiles, anchors);
  const bound = anchors.length > 0;
  const annotated = findings.map((finding) => {
    const file = finding?.location?.file ?? "<surface>";
    const fileRelation = file === "<surface>"
      ? { relation: "shared", depth: null, reason: "surface-level-finding" }
      : sourceFiles.includes(file)
        ? relationFor(relation, file)
        : { relation: "unbound", depth: null, reason: "file-outside-source-scope" };
    const visibility = visibilityFor(finding, visibleText);
    const relevance = relevanceFor(fileRelation.relation, visibility.visibility, finding?.category);
    const copyLike = lower(finding?.category).startsWith("copy") || /copy|wording|text/i.test(String(finding?.message));
    const effectiveRelevance = copyLike && visibility.visibility === "not-visible" && relevance !== "UNBOUND"
      ? "CONTEXT" : relevance;
    const actionable = effectiveRelevance === "ROUTE"
      ? (visibility.visibility === "visible" || !copyLike || fileRelation.relation === "route-entry")
      : effectiveRelevance === "SHARED" && visibility.visibility === "visible";
    return {
      ...finding,
      surface: {
        relation: fileRelation.relation,
        relevance: effectiveRelevance,
        visibility: visibility.visibility,
        visibilityReason: visibility.reason,
        relationReason: fileRelation.reason,
        depth: fileRelation.depth,
        actionable,
        surfacePriority: surfacePriorityFor(finding, effectiveRelevance, visibility.visibility, fileRelation.relation),
        confidence: bound ? (fileRelation.reason === "local-import" ? "heuristic" : "static") : "fallback",
      },
    };
  });
  const counts = {
    observations: annotated.length,
    routeRelevant: annotated.filter((item) => item.surface.actionable).length,
    pendingVisibility: annotated.filter((item) => item.surface.relevance === "ROUTE" && !item.surface.actionable).length,
    shared: annotated.filter((item) => item.surface.relevance === "SHARED").length,
    contextOnly: annotated.filter((item) => item.surface.relevance === "CONTEXT").length,
    unbound: annotated.filter((item) => item.surface.relevance === "UNBOUND").length,
    notVisible: annotated.filter((item) => item.surface.visibility === "not-visible").length,
  };
  const closure = {
    entries: [...relation].filter(([, value]) => value.relation === "route-entry").map(([file]) => file),
    direct: [...relation].filter(([, value]) => value.relation === "direct").map(([file]) => file),
    styles: [...relation].filter(([, value]) => value.relation === "direct-style").map(([file]) => file),
    shared: [...relation].filter(([, value]) => value.relation === "shared").map(([file]) => file),
    contextCount: sourceFiles.filter((file) => !relation.has(file)).length,
  };
  return {
    schemaVersion: 1,
    kind: "dwa/surface-relevance",
    route,
    target: toPosix(relative(root, absoluteTarget)),
    binding: {
      routeBinding: bound ? "static-route-closure" : "declared-source-route",
      confidence: bound ? "static" : "fallback",
      anchors: anchors.map(({ file, score, reason }) => ({ file, score, reason })),
      references: found.references,
      closure,
      visibleTextProvided: filled(visibleText),
    },
    counts,
    findings: annotated,
    plan: buildPlan(root, sourceFiles, relation),
    limitation: "Static relevance only. Shared/conditional modules and generated text require rendered adjudication; an unbound finding is not thereby false.",
  };
}

function parseArgs(argv) {
  const options = { findings: [], json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--json") { options.json = true; continue; }
    if (!["--project-root", "--path", "--route", "--findings", "--visible-text", "--probe"].includes(token)) {
      throw new Error("Unknown argument: " + token);
    }
    const value = argv[++index];
    if (!filled(value)) throw new Error("Missing value for " + token);
    if (token === "--findings") options.findings.push(value);
    else options[token.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
  }
  for (const required of ["projectRoot", "path", "route"]) {
    if (!filled(options[required])) throw new Error("--" + required.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()) + " is required");
  }
  return options;
}

function readJson(path, label) {
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch (error) { throw new Error(label + " is invalid JSON: " + path); }
}

function main() {
  let args = null;
  try {
    args = parseArgs(process.argv.slice(2));
    const reports = args.findings.map((path) => readJson(path, "Findings report"));
    const findings = reports.flatMap((report) => Array.isArray(report) ? report : report.findings ?? []);
    let visibleText = null;
    if (args.visibleText) visibleText = readFileSync(args.visibleText, "utf8");
    if (args.probe) {
      const probe = readJson(args.probe, "Surface probe");
      visibleText = probe.visibleText ?? visibleText;
    }
    const result = classifySurfaceFindings({
      projectRoot: args.projectRoot,
      target: args.path,
      route: args.route,
      findings,
      visibleText,
    });
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    process.exitCode = 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (args?.json) process.stdout.write(JSON.stringify({ error: message }, null, 2) + "\n");
    else process.stderr.write(message + "\n");
    process.exitCode = 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
