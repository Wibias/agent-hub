#!/usr/bin/env node
/**
 * Agent knowledge-base indexer — scans skills, rules, SOUL, AGENTS.md across harness roots.
 * Writes portable index.json + INDEX.md in the Hub's knowledge/ directory.
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { portableFailureMessage, portablePath, resolveBuildRoots } from "./index-portability.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = __dirname;

function parseArgs(argv) {
  let projectRootArg;
  let includeHostLocal = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--project-root") {
      projectRootArg = argv[i + 1];
      if (!projectRootArg) throw new Error("--project-root requires a path");
      i += 1;
    } else if (argv[i] === "--include-host-local") {
      includeHostLocal = true;
    } else {
      throw new Error(`unknown argument: ${argv[i]}`);
    }
  }
  return { projectRootArg, includeHostLocal };
}

const BUILD_OPTIONS = parseArgs(process.argv.slice(2));
const {
  hubRoot: HUB_ROOT,
  home: HOME_ROOT,
  projectRoot: PROJECT_ROOT,
} = resolveBuildRoots({
  scriptDir: __dirname,
  home: homedir(),
  projectRootArg: BUILD_OPTIONS.projectRootArg,
});

const TYPE_ENUM = new Set([
  "skill",
  "rule",
  "soul",
  "agents-md",
  "plugin-skill",
  "external-skill",
]);
const HARNESS_ENUM = new Set([
  "cursor",
  "claude",
  "codex",
  "opencode",
  "hermes",
  "agents",
  "plugin",
  "external",
]);
const SCOPE_ENUM = new Set(["global", "project"]);
const STATUS_ENUM = new Set([
  "active",
  "archived",
  "duplicate",
  "catalog-only",
]);

/** @type {{ path: string, message: string }[]} */
const parseFailures = [];

function recordParseFailure(sourcePath, error) {
  const portableSource = portablePath(sourcePath, { hubRoot: HUB_ROOT, home: HOME_ROOT, projectRoot: PROJECT_ROOT });
  parseFailures.push({
    path: portableSource,
    message: portableFailureMessage(error, sourcePath, portableSource),
  });
}

/**
 * @param {string} dir
 * @param {(fullPath: string) => boolean} [filter]
 * @returns {string[]}
 */
function walkFiles(dir, filter = () => true) {
  /** @type {string[]} */
  const out = [];
  if (!existsSync(dir)) return out;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
  } catch (err) {
    recordParseFailure(dir, err);
    return out;
  }
  for (const ent of entries) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) {
      out.push(...walkFiles(full, filter));
    } else if (ent.isFile() && filter(full)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * @param {string} patternDir
 * @param {string} leafName
 * @returns {string[]}
 */
function globOneLevelSkills(patternDir, leafName = "SKILL.md") {
  /** @type {string[]} */
  const out = [];
  if (!existsSync(patternDir)) return out;
  let entries;
  try {
    entries = readdirSync(patternDir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
  } catch (err) {
    recordParseFailure(patternDir, err);
    return out;
  }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const skillPath = join(patternDir, ent.name, leafName);
    if (existsSync(skillPath)) out.push(skillPath);
  }
  return out;
}

/**
 * Plugin cache: cursor-public / {plugin} / {version} / skills / * / SKILL.md (read-only scan)
 * @returns {string[]}
 */
function globPluginSkills() {
  const root = join(homedir(), ".cursor", "plugins", "cache", "cursor-public");
  /** @type {string[]} */
  const out = [];
  if (!existsSync(root)) return out;

  let plugins;
  try {
    plugins = readdirSync(root, { withFileTypes: true });
    plugins.sort((a, b) => a.name.localeCompare(b.name));
  } catch (err) {
    recordParseFailure(root, err);
    return out;
  }

  for (const plugin of plugins) {
    if (!plugin.isDirectory()) continue;
    const pluginRoot = join(root, plugin.name);
    let versions;
    try {
      versions = readdirSync(pluginRoot, { withFileTypes: true });
      versions.sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      continue;
    }
    for (const ver of versions) {
      if (!ver.isDirectory()) continue;
      const skillsRoot = join(pluginRoot, ver.name, "skills");
      if (!existsSync(skillsRoot)) continue;
      out.push(
        ...walkFiles(
          skillsRoot,
          (p) => basename(p).toLowerCase() === "skill.md",
        ),
      );
    }
  }
  return out;
}

/**
 * @param {string} absPath
 */
function isArchivedPath(absPath) {
  const parts = absPath.split(/[/\\]/);
  const skipped = new Set([
    "_archive",
    ".github-delivery-backups",
    ".github-delivery-hotfix-backups",
  ]);
  return parts.some((p) => skipped.has(p.toLowerCase()) || p.startsWith(".github-delivery-"));
}

/**
 * @param {string} raw
 */
function normalizeContent(raw) {
  return raw.replace(/\r\n/g, "\n").trim();
}

/**
 * @param {string} raw
 */
function contentHash(raw) {
  return createHash("sha256")
    .update(normalizeContent(raw), "utf8")
    .digest("hex");
}

/**
 * @param {string} content
 * @returns {{ name?: string, description?: string, body: string }}
 */
function parseFrontmatter(content) {
  if (!content.startsWith("---")) {
    return { body: content };
  }
  const end = content.indexOf("\n---", 3);
  if (end === -1) return { body: content };

  const fmBlock = content.slice(4, end);
  const body = content.slice(end + 4).replace(/^\n/, "");
  /** @type {Record<string, string>} */
  const fields = {};

  /** @type {string | null} */
  let currentKey = null;
  /** @type {string[]} */
  let currentLines = [];

  const flush = () => {
    if (currentKey) {
      fields[currentKey] = currentLines.join(" ").replace(/\s+/g, " ").trim();
    }
    currentKey = null;
    currentLines = [];
  };

  for (const line of fmBlock.split("\n")) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv) {
      flush();
      currentKey = kv[1].toLowerCase();
      const rest = kv[2].trim();
      if (/^[>|][+-]?$/.test(rest)) {
        currentLines = [];
      } else if (rest) {
        currentLines = [rest.replace(/^["']|["']$/g, "")];
      } else {
        currentLines = [];
      }
    } else if (currentKey && (line.startsWith("  ") || line.startsWith("\t"))) {
      currentLines.push(line.trim());
    } else if (currentKey && line.trim()) {
      currentLines.push(line.trim());
    }
  }
  flush();

  return {
    name: fields.name,
    description: fields.description ?? "",
    body,
  };
}

/**
 * @param {string} body
 */
function firstHeadingWords(body) {
  const m = body.match(/^#\s+(.+)$/m);
  if (!m) return [];
  return m[1]
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

/**
 * @param {string} name
 * @param {string} body
 * @returns {string[]}
 */
function deriveTags(name, body) {
  const words = new Set();
  for (const part of name.toLowerCase().split(/[^a-z0-9]+/)) {
    if (part.length >= 2) words.add(part);
  }
  for (const w of firstHeadingWords(body)) {
    if (w.length >= 3) words.add(w);
  }
  return [...words].slice(0, 10);
}

/**
 * @param {string} description
 * @returns {string[]}
 */
function deriveTriggers(description) {
  if (!description.trim()) return [];
  let text = description;
  for (const marker of ["Use when", "Use for", "use when", "use for"]) {
    text = text.split(marker).join(", ");
  }
  return text
    .split(/[,;|]/)
    .map((s) =>
      s
        .replace(/^[\s\-–—]+/, "")
        .replace(/\.$/, "")
        .trim(),
    )
    .filter((s) => s.length >= 3 && s.length <= 120)
    .slice(0, 8);
}

/**
 * @param {string} filePath
 */
function readText(filePath) {
  try {
    return readFileSync(filePath, "utf8");
  } catch (err) {
    recordParseFailure(filePath, err);
    return null;
  }
}

/**
 * @param {string} absPath
 */
function slugFromPath(absPath) {
  return basename(absPath).replace(/\.(md|mdc)$/i, "");
}

/**
 * @typedef {object} ScanSpec
 * @property {string[]} paths
 * @property {'skill'|'rule'|'soul'|'agents-md'|'plugin-skill'} type
 * @property {string} harness
 * @property {'global'|'project'} scope
 * @property {(path: string) => string} [idFn]
 */

/** @type {ScanSpec[]} */
const SCAN_SPECS = [
  {
    paths: walkFiles(
      join(HUB_ROOT, "skills"),
      (p) => basename(p).toLowerCase() === "skill.md",
    ),
    type: "skill",
    harness: "agents",
    scope: "global",
  },
  {
    paths: walkFiles(join(HUB_ROOT, "rules"), (p) => p.endsWith(".mdc")),
    type: "rule",
    harness: "agents",
    scope: "global",
  },
];

if (BUILD_OPTIONS.includeHostLocal) {
  SCAN_SPECS.push(
    {
      paths: globOneLevelSkills(join(HOME_ROOT, ".cursor", "skills-cursor")),
      type: "skill",
      harness: "cursor",
      scope: "global",
    },
    {
      paths: globOneLevelSkills(join(HOME_ROOT, ".claude", "skills")),
      type: "skill",
      harness: "claude",
      scope: "global",
    },
    {
      paths: globOneLevelSkills(join(HOME_ROOT, ".codex", "skills")),
      type: "skill",
      harness: "codex",
      scope: "global",
    },
    {
      paths: walkFiles(join(HOME_ROOT, ".cursor", "rules"), (p) => p.endsWith(".mdc")),
      type: "rule",
      harness: "cursor",
      scope: "global",
    },
    {
      paths: globPluginSkills(),
      type: "plugin-skill",
      harness: "plugin",
      scope: "global",
    },
  );
}

if (PROJECT_ROOT) {
  SCAN_SPECS.push(
    {
      paths: globOneLevelSkills(join(PROJECT_ROOT, ".claude", "skills")),
      type: "skill",
      harness: "claude",
      scope: "project",
    },
    {
      paths: globOneLevelSkills(join(PROJECT_ROOT, ".agents", "skills")),
      type: "skill",
      harness: "agents",
      scope: "project",
    },
    {
      paths: walkFiles(join(PROJECT_ROOT, ".cursor", "rules"), (p) => p.endsWith(".mdc")),
      type: "rule",
      harness: "cursor",
      scope: "project",
    },
    {
      paths: walkFiles(join(PROJECT_ROOT, "agent-rules"), (p) => p.endsWith(".md")),
      type: "rule",
      harness: "codex",
      scope: "project",
    },
  );
}

/**
 * @param {string} harness
 * @param {string} type
 * @param {string} name
 * @param {'global'|'project'} scope
 */
function makeId(harness, type, name, scope) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const suffix = scope === "project" ? "@project" : "";
  if (type === "rule") return `${harness}-rule/${slug}${suffix}`;
  if (type === "soul") return `${harness}/soul`;
  if (type === "agents-md") return scope === "project" ? "project/agents-md" : `${harness}/agents-md`;
  if (type === "plugin-skill") {
    return `plugin/${slug}`;
  }
  if (type === "external-skill") return `external/${slug}`;
  return `${harness}/${slug}${suffix}`;
}

/**
 * @param {string} filePath
 * @param {ScanSpec['type']} type
 * @param {string} harness
 * @param {'global'|'project'} scope
 */
function buildEntryFromFile(filePath, type, harness, scope) {
  const raw = readText(filePath);
  if (raw === null) return null;

  // Parse on normalized content: CRLF line endings break the ^key: (.*)$ regex.
  const {
    name: fmName,
    description,
    body,
  } = parseFrontmatter(normalizeContent(raw));
  const folderName = basename(dirname(filePath));
  const fileSlug = slugFromPath(filePath);
  const name =
    fmName?.trim() ||
    (type === "agents-md"
      ? "AGENTS.md"
      : type === "soul"
        ? "SOUL"
        : type === "rule" ||
            folderName === "skills" ||
            folderName.endsWith("skills")
          ? fileSlug
          : folderName);

  const archived = isArchivedPath(filePath);
  const hash = contentHash(raw);

  const entry = {
    id: makeId(harness, type, name, scope),
    path: portablePath(filePath, { hubRoot: HUB_ROOT, home: HOME_ROOT, projectRoot: PROJECT_ROOT }),
    type,
    harness,
    scope,
    name,
    description: description ?? "",
    tags: deriveTags(name, body),
    triggers: deriveTriggers(description ?? ""),
    status: archived ? "archived" : "active",
    canonicalId: null,
    contentHash: hash,
  };

  return entry;
}

/** @type {Map<string, object>} */
const entriesById = new Map();

function addEntry(entry) {
  if (!entry) return;
  const base = entry.id;
  let id = base;
  let n = 2;
  while (entriesById.has(id)) id = `${base}~${n++}`;
  entry.id = id;
  entriesById.set(id, entry);
}

for (const spec of SCAN_SPECS) {
  for (const p of spec.paths) {
    addEntry(buildEntryFromFile(p, spec.type, spec.harness, spec.scope));
  }
}

const agentsMdPath = join(HUB_ROOT, "AGENTS.md");
if (existsSync(agentsMdPath)) {
  addEntry(buildEntryFromFile(agentsMdPath, "agents-md", "agents", "global"));
}

const soulPath = join(HUB_ROOT, "SOUL.md");
if (existsSync(soulPath)) {
  addEntry(buildEntryFromFile(soulPath, "soul", "agents", "global"));
}

const contextPath = join(HUB_ROOT, "CONTEXT.md");
if (existsSync(contextPath)) {
  const ctx = buildEntryFromFile(contextPath, "agents-md", "agents", "global");
  if (ctx) {
    ctx.id = "agents/context-md";
    ctx.name = "CONTEXT.md";
    addEntry(ctx);
  }
}

if (PROJECT_ROOT) {
  const projectAgentsMdPath = join(PROJECT_ROOT, "AGENTS.md");
  if (existsSync(projectAgentsMdPath)) {
    addEntry(buildEntryFromFile(projectAgentsMdPath, "agents-md", "agents", "project"));
  }

  const projectContextPath = join(PROJECT_ROOT, "CONTEXT.md");
  if (existsSync(projectContextPath)) {
    const ctx = buildEntryFromFile(projectContextPath, "agents-md", "codex", "project");
    if (ctx) {
      ctx.id = "project/context-md";
      ctx.name = "CONTEXT.md";
      addEntry(ctx);
    }
  }
}

/**
 * @param {string} catalogPath
 * @returns {object[]}
 */
function loadExternalSkillCatalog(catalogPath) {
  const raw = readText(catalogPath);
  if (!raw) return [];
  /** @type {{ source?: string, skills?: { id: string, path: string, tags?: string[], triggers?: string[] }[] }} */
  let catalog;
  try {
    catalog = JSON.parse(raw);
  } catch (err) {
    recordParseFailure(catalogPath, err);
    return [];
  }
  const source = catalog.source ?? "external";
  const repoMatch = source.match(/github\.com\/([^/]+)\/([^/#?]+)/);
  const owner = repoMatch?.[1] ?? "unknown";
  const repo = repoMatch?.[2] ?? "unknown";

  /** @type {object[]} */
  const out = [];
  for (const skill of catalog.skills ?? []) {
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/${skill.path}/SKILL.md`;
    const desc = skill.triggers?.length
      ? `Catalog-only (${owner}/${repo}): ${skill.triggers[0]}`
      : `Catalog-only (${owner}/${repo}): ${skill.id}`;
    out.push({
      id: makeId("external", "external-skill", skill.id, "global"),
      path: rawUrl,
      type: "external-skill",
      harness: "external",
      scope: "global",
      name: skill.id,
      description: desc,
      tags: (skill.tags ?? []).slice(0, 10),
      triggers: (skill.triggers ?? []).slice(0, 8),
      status: "catalog-only",
      canonicalId: null,
      contentHash: contentHash(
        JSON.stringify({ source, id: skill.id, path: skill.path }),
      ),
    });
  }
  return out;
}

const cyberCatalogPath = join(
  OUT_DIR,
  "external",
  "cybersecurity-catalog.json",
);
for (const entry of loadExternalSkillCatalog(cyberCatalogPath)) {
  addEntry(entry);
}

/** @type {object[]} */
const entries = [...entriesById.values()];

/**
 * Canonical precedence: plugin-skill > global skill > project skill > rule > agents-md > soul
 * @param {object} entry
 */
function canonicalScore(entry) {
  if (entry.type === "plugin-skill") return 600;
  if (entry.type === "skill" && entry.scope === "global") return 500;
  if (entry.type === "skill" && entry.scope === "project") return 400;
  if (entry.type === "rule") return 300;
  if (entry.type === "agents-md") return 200;
  if (entry.type === "soul") return 100;
  if (entry.type === "external-skill") return 50;
  return 0;
}

/** @type {Map<string, object[]>} */
const activeByHash = new Map();
for (const entry of entries) {
  if (entry.status !== "active") continue;
  const list = activeByHash.get(entry.contentHash) ?? [];
  list.push(entry);
  activeByHash.set(entry.contentHash, list);
}

/** @type {{ contentHash: string, canonicalId: string, memberIds: string[] }[]} */
const duplicateClusters = [];

for (const [hash, group] of activeByHash) {
  if (group.length < 2) continue;
  group.sort((a, b) => {
    const ds = canonicalScore(b) - canonicalScore(a);
    if (ds !== 0) return ds;
    return a.path.localeCompare(b.path);
  });
  const canonical = group[0];
  for (let i = 1; i < group.length; i++) {
    group[i].status = "duplicate";
    group[i].canonicalId = canonical.id;
  }
  duplicateClusters.push({
    contentHash: hash,
    canonicalId: canonical.id,
    memberIds: group.map((e) => e.id),
  });
}

duplicateClusters.sort((a, b) => a.canonicalId.localeCompare(b.canonicalId));

const index = {
  entries: entries.sort((a, b) => a.id.localeCompare(b.id)),
  duplicateClusters,
  catalogs: [
    {
      id: "design-references",
      path: portablePath(join(OUT_DIR, "design-references", "index.json"), { hubRoot: HUB_ROOT, home: HOME_ROOT, projectRoot: PROJECT_ROOT }),
      name: "Design Reference Intelligence Library",
      description:
        "Curated design observations queried selectively by design-with-ai.",
      queryCommand:
        "node knowledge/design-references/scripts/query.mjs --profile deep --surface <surface> --job <job> --platform <platform> --dimensions <dimensions>",
    },
  ],
};

/**
 * @param {unknown} value
 * @param {string} label
 */
function assertString(value, label) {
  if (typeof value !== "string") {
    throw new Error(`${label}: expected string, got ${typeof value}`);
  }
}

/**
 * @param {unknown} value
 * @param {string} label
 * @param {Set<string>} allowed
 */
function assertEnum(value, label, allowed) {
  assertString(value, label);
  if (!allowed.has(value)) {
    throw new Error(`${label}: invalid enum value "${value}"`);
  }
}

/**
 * @param {object} entry
 * @param {number} i
 */
function validateEntry(entry, i) {
  const prefix = `entries[${i}]`;
  for (const key of [
    "id",
    "path",
    "type",
    "harness",
    "scope",
    "name",
    "description",
    "tags",
    "triggers",
    "status",
    "canonicalId",
    "contentHash",
  ]) {
    if (!(key in entry))
      throw new Error(`${prefix}: missing required field "${key}"`);
  }
  assertString(entry.id, `${prefix}.id`);
  assertString(entry.path, `${prefix}.path`);
  assertEnum(entry.type, `${prefix}.type`, TYPE_ENUM);
  assertEnum(entry.harness, `${prefix}.harness`, HARNESS_ENUM);
  assertEnum(entry.scope, `${prefix}.scope`, SCOPE_ENUM);
  assertString(entry.name, `${prefix}.name`);
  assertString(entry.description, `${prefix}.description`);
  if (!Array.isArray(entry.tags))
    throw new Error(`${prefix}.tags: expected array`);
  if (entry.tags.length > 10) throw new Error(`${prefix}.tags: max 10 items`);
  if (!Array.isArray(entry.triggers))
    throw new Error(`${prefix}.triggers: expected array`);
  assertEnum(entry.status, `${prefix}.status`, STATUS_ENUM);
  if (!/^[a-f0-9]{64}$/.test(entry.contentHash)) {
    throw new Error(`${prefix}.contentHash: invalid sha256 hex`);
  }
  if (entry.status === "duplicate") {
    if (typeof entry.canonicalId !== "string" || !entry.canonicalId) {
      throw new Error(
        `${prefix}.canonicalId: duplicate entries require canonicalId string`,
      );
    }
  } else if (entry.canonicalId !== null) {
    throw new Error(
      `${prefix}.canonicalId: must be null unless status is duplicate`,
    );
  }
  if (entry.status === "catalog-only" && entry.type !== "external-skill") {
    throw new Error(
      `${prefix}: catalog-only status requires type external-skill`,
    );
  }
}

function validateIndex(doc) {
  if (!doc || typeof doc !== "object")
    throw new Error("index: expected object");
  if (!Array.isArray(doc.entries)) throw new Error("entries: expected array");
  if (!Array.isArray(doc.duplicateClusters))
    throw new Error("duplicateClusters: expected array");
  if (!Array.isArray(doc.catalogs)) throw new Error("catalogs: expected array");

  const ids = new Set();
  for (let i = 0; i < doc.entries.length; i++) {
    validateEntry(doc.entries[i], i);
    if (ids.has(doc.entries[i].id)) {
      throw new Error(`entries[${i}].id: duplicate id "${doc.entries[i].id}"`);
    }
    ids.add(doc.entries[i].id);
  }

  for (let i = 0; i < doc.duplicateClusters.length; i++) {
    const c = doc.duplicateClusters[i];
    const cp = `duplicateClusters[${i}]`;
    assertString(c.contentHash, `${cp}.contentHash`);
    assertString(c.canonicalId, `${cp}.canonicalId`);
    if (!Array.isArray(c.memberIds) || c.memberIds.length < 2) {
      throw new Error(`${cp}.memberIds: expected array with >= 2 items`);
    }
  }
  for (let i = 0; i < doc.catalogs.length; i++) {
    const catalog = doc.catalogs[i];
    const prefix = `catalogs[${i}]`;
    for (const field of ["id", "path", "name", "description", "queryCommand"]) {
      assertString(catalog[field], prefix + "." + field);
    }
  }
}

/**
 * @param {object} indexDoc
 */
function renderIndexMd(indexDoc) {
  const lines = [
    "# Agent Knowledge Index",
    "",
    `Entries: ${indexDoc.entries.length} | Duplicate clusters: ${indexDoc.duplicateClusters.length}`,
    "",
    "## Knowledge catalogs",
    "",
    ...indexDoc.catalogs.map(
      (catalog) =>
        `- **${catalog.name}** — \`${catalog.path}\`; query: \`${catalog.queryCommand}\``,
    ),
    "",
  ];

  const harnessOrder = [
    "cursor",
    "claude",
    "codex",
    "opencode",
    "hermes",
    "agents",
    "plugin",
    "external",
  ];
  const typeOrder = [
    "skill",
    "plugin-skill",
    "external-skill",
    "rule",
    "soul",
    "agents-md",
  ];

  for (const harness of harnessOrder) {
    const harnessEntries = indexDoc.entries.filter(
      (e) => e.harness === harness,
    );
    if (!harnessEntries.length) continue;
    lines.push(`## ${harness}`, "");

    for (const type of typeOrder) {
      const group = harnessEntries
        .filter((e) => e.type === type)
        .sort((a, b) => a.name.localeCompare(b.name));
      if (!group.length) continue;
      lines.push(`### ${type}`, "");
      for (const e of group) {
        const desc = e.description
          ? e.description.slice(0, 100).replace(/\s+/g, " ") +
            (e.description.length > 100 ? "…" : "")
          : "(no description)";
        lines.push(`- **${e.name}** · ${e.scope} · ${e.status} — ${desc}`);
      }
      lines.push("");
    }
  }

  lines.push("## Duplicate clusters", "");
  if (!indexDoc.duplicateClusters.length) {
    lines.push("_None_", "");
  } else {
    for (const cluster of indexDoc.duplicateClusters) {
      const canonical = indexDoc.entries.find(
        (e) => e.id === cluster.canonicalId,
      );
      const dupes = cluster.memberIds.filter(
        (id) => id !== cluster.canonicalId,
      );
      lines.push(`### ${cluster.canonicalId}`, "");
      lines.push(
        `- **Canonical:** \`${canonical?.path ?? cluster.canonicalId}\``,
      );
      for (const id of dupes) {
        const entry = indexDoc.entries.find((e) => e.id === id);
        lines.push(`- **Duplicate:** \`${entry?.path ?? id}\` (${id})`);
      }
      lines.push("");
    }
  }

  if (parseFailures.length) {
    lines.push("## Parse failures", "");
    for (const f of parseFailures) {
      lines.push(`- \`${f.path}\`: ${f.message}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

try {
  validateIndex(index);
} catch (err) {
  console.error(
    `Schema validation failed: ${err instanceof Error ? err.message : err}`,
  );
  process.exit(1);
}

writeFileSync(
  join(OUT_DIR, "index.json"),
  JSON.stringify(index, null, 2) + "\n",
  "utf8",
);
writeFileSync(join(OUT_DIR, "INDEX.md"), renderIndexMd(index), "utf8");

/** @type {Record<string, Record<string, number>>} */
const counts = {};
for (const e of index.entries) {
  counts[e.harness] ??= {};
  counts[e.harness][e.type] = (counts[e.harness][e.type] ?? 0) + 1;
}

console.log(`Wrote ${join(OUT_DIR, "index.json")}`);
console.log(`Wrote ${join(OUT_DIR, "INDEX.md")}`);
console.log(`Entries: ${index.entries.length}`);
console.log(`Duplicate clusters: ${index.duplicateClusters.length}`);
console.log(`Parse failures: ${parseFailures.length}`);
console.log("Counts by harness/type:");
for (const [h, types] of Object.entries(counts).sort()) {
  for (const [t, n] of Object.entries(types).sort()) {
    console.log(`  ${h}/${t}: ${n}`);
  }
}

if (parseFailures.length) {
  console.warn(
    "Some paths failed to parse (see INDEX.md Parse failures section).",
  );
}
