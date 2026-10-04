import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const readmePath = join(repoRoot, "README.md");
const skillsRoot = join(repoRoot, "skills");

function parseFrontmatter(raw) {
  if (!raw.startsWith("---\n")) return {};
  const end = raw.indexOf("\n---", 4);
  if (end < 0) return {};
  const block = raw.slice(4, end);
  const fields = {};
  let key = null;
  let lines = [];
  const flush = () => {
    if (key) fields[key] = lines.join(" ").replace(/\s+/g, " ").trim();
    key = null;
    lines = [];
  };
  for (const line of block.split("\n")) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (match) {
      flush();
      key = match[1].toLowerCase();
      const value = match[2].trim();
      if (!/^[>|][+-]?$/.test(value) && value) {
        lines = [value.replace(/^["']|["']$/g, "")];
      }
    } else if (key && line.trim()) {
      lines.push(line.trim());
    }
  }
  flush();
  return fields;
}

function count(haystack, needle) {
  return haystack.split(needle).length - 1;
}

function topLevelSkills() {
  return readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const skillPath = join(skillsRoot, entry.name, "SKILL.md");
      if (!existsSync(skillPath)) return null;
      const raw = readFileSync(skillPath, "utf8").replace(/\r\n/g, "\n");
      const fm = parseFrontmatter(raw);
      return {
        dir: entry.name,
        name: fm.name || entry.name,
        description: fm.description || "",
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
}

const requiredSections = [
  "## How to use Agent Hub skills",
  "## Skill guide",
  "### Design & UX",
  "### Architecture & code",
  "### Debugging, performance & quality",
  "### GitHub & delivery",
  "### Research, context & knowledge",
  "### Security",
  "### Tooling & frameworks",
  "### Memory & agent workflow",
  "## Routes inside complex skills",
  "## Aliases",
];

const requiredRouteMarkers = [
  // design-with-ai public commands
  "design-with-ai:audit-surface",
  "design-with-ai:improve-existing",
  "design-with-ai:restyle-existing",
  "design-with-ai:redesign-existing",
  "design-with-ai:build-product-surface",
  "design-with-ai:design-spec",
  "design-with-ai:motion-build",
  "design-with-ai:motion-opportunities",
  "design-with-ai:motion-audit",
  "design-with-ai:motion-review",
  "design-with-ai:motion-optimize",
  "design-with-ai:motion-name",

  // fortify routes
  "fortify:state-resilience",
  "fortify:worst-case",

  // prototype branches
  "prototype:logic",
  "prototype:ui",
  "prototype:technical-fork",

  // intent modes and strategic specialist routes
  "intent:context",
  "intent:practice",
  "intent:extract",
  "intent:research",
  "intent:service-design",
  "intent:interaction-patterns",
  "intent:information-architecture",
  "intent:content-strategy",
  "intent:ethical-design",
  "intent:accessibility",
  "intent:measurement",

  // skill-ratchet lifecycle
  "skill-ratchet:preflight",
  "skill-ratchet:author",
  "skill-ratchet:evaluate",
  "skill-ratchet:validate",

  // performance branches
  "performance:investigation",
  "performance:databases-and-runtime",

  // codex-dynamic-workflows building blocks
  "codex-dynamic-workflows:workflow-artifact",
  "codex-dynamic-workflows:work-packets",
  "codex-dynamic-workflows:doubt-gate",
  "codex-dynamic-workflows:verification",

  // write-swift routes
  "write-swift:core-language",
  "write-swift:concurrency",
  "write-swift:testing-and-performance",
  "write-swift:broad-review",

  // github-delivery routed workflows
  "github-delivery:prd",
  "github-delivery:issue-breakdown",
  "github-delivery:create-issues",
  "github-delivery:triage",
  "github-delivery:qa-intake",
  "github-delivery:refactor-plan",
  "github-delivery:agent-brief",
  "github-delivery:out-of-scope",
  "github-delivery:git-workflow",
  "github-delivery:release-prep",
  "github-delivery:fix-pr-bots",
  "github-delivery:watch-pr",
  "github-delivery:re-review-pr",
  "github-delivery:research-issue",
  "github-delivery:create-pr-from-local-work",
  "github-delivery:create-pr-for-issue",
  "github-delivery:open-work-status",
  "github-delivery:work-item-delivery",
  "github-delivery:consolidate-prs",
  "github-delivery:multi-base-delivery",
  "github-delivery:full-review-pr",
  "github-delivery:spec-standards-review",
  "github-delivery:simplify-pr",
  "github-delivery:no-comments",
  "github-delivery:security-review",
  "github-delivery:status",
  "github-delivery:merge-pr",
  "github-delivery:supersede-pr",
  "github-delivery:overtake-pr",
  "github-delivery:resolve-conflicts",
  "github-delivery:stacked-prs",
];

test("README documents every top-level skill exactly once and links its SKILL.md", () => {
  const readme = readFileSync(readmePath, "utf8").replace(/\r\n/g, "\n");
  for (const skill of topLevelSkills()) {
    const isAlias =
      skill.dir.endsWith("-redirect") ||
      /compatibility redirect/i.test(skill.description);
    const marker = `<!-- ${isAlias ? "skill-alias" : "skill-doc"}:${skill.name} -->`;
    assert.equal(
      count(readme, marker),
      1,
      `${skill.name}: README must contain exactly one ${marker}`,
    );
    assert.ok(
      readme.includes(`](skills/${skill.dir}/SKILL.md)`),
      `${skill.name}: README must link to skills/${skill.dir}/SKILL.md`,
    );
  }
});

test("README keeps the human skill map structure stable", () => {
  const readme = readFileSync(readmePath, "utf8").replace(/\r\n/g, "\n");
  for (const heading of requiredSections) {
    assert.ok(readme.includes(heading), `missing README section: ${heading}`);
  }
});

test("README documents the public routes of complex skills", () => {
  const readme = readFileSync(readmePath, "utf8").replace(/\r\n/g, "\n");
  for (const route of requiredRouteMarkers) {
    const marker = `<!-- route-doc:${route} -->`;
    assert.equal(count(readme, marker), 1, `missing or duplicate route marker: ${marker}`);
  }
});
