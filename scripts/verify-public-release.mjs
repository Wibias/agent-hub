#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BINARY_EXTENSIONS = new Set([
  ".7z", ".avif", ".bmp", ".class", ".dll", ".doc", ".docx", ".exe",
  ".gif", ".gz", ".ico", ".jar", ".jpeg", ".jpg", ".mov", ".mp3",
  ".mp4", ".otf", ".pdf", ".png", ".ppt", ".pptx", ".so", ".tar",
  ".ttf", ".wav", ".webm", ".webp", ".woff", ".woff2", ".xls", ".xlsx", ".zip",
]);

function normalizedContent(content) {
  return content.replace(/\\\\/g, "\\");
}

function addFinding(findings, path, rule, message) {
  findings.push({ path, rule, message });
}

function scanEntry({ path, content }, findings) {
  const normalized = normalizedContent(String(content));
  const normalizedPath = path.replace(/\\/g, "/");
  const combined = `${path}\n${normalized}`;

  const homePatterns = [
    /[A-Za-z]:\\Users\\(?!<[^>]+>)([^\\\s"'\x60]+)\\/g,
    /\/Users\/(?!<[^>]+>)([^/\s"'\x60]+)\//g,
    /\/home\/(?!<[^>]+>)([^/\s"'\x60]+)\//g,
  ];
  if (homePatterns.some((pattern) => pattern.test(combined))) {
    addFinding(findings, path, "personal-home-path", "concrete user-home path is not portable");
  }

  if (/\b[A-Za-z]:\\(?:codex-worktrees|tmp)(?:\\|\b)/i.test(combined)) {
    addFinding(findings, path, "operator-path", "fixed operator worktree/temp root must be configurable");
  }

  if (
    path.replace(/\\/g, "/").startsWith(".cursor/hooks/state/") ||
    /c-Users-[A-Za-z0-9._-]+-agents[\\/]agent-transcripts[\\/]/i.test(normalized)
  ) {
    addFinding(findings, path, "transcript-state", "local transcript/session state must not be tracked");
  }

  if (/(?:\b10(?:\.\d{1,3}){3}\b|\b192\.168(?:\.\d{1,3}){2}\b|\b172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}\b)/.test(normalized)) {
    addFinding(findings, path, "private-network-endpoint", "concrete private-network endpoint must not be published");
  }

  if (/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/.test(normalized)) {
    addFinding(findings, path, "private-key", "private-key material/header detected");
  }

  if (/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/.test(normalized)) {
    addFinding(findings, path, "github-token", "GitHub token-shaped value detected");
  }

  if (/\bAKIA[0-9A-Z]{16}\b/.test(normalized)) {
    addFinding(findings, path, "aws-access-key", "AWS access-key-shaped value detected");
  }

  if (/\b(?:authorization\s*[:=]\s*)?bearer\s+[A-Za-z0-9._-]{32,}\b/i.test(normalized)) {
    addFinding(findings, path, "bearer-token", "long bearer-token-shaped value detected");
  }

  if (
    /^skills\/[^/]*read-github[^/]*\/SKILL\.md$/i.test(normalizedPath) &&
    normalizedPath.toLowerCase() !== "skills/read-github/skill.md"
  ) {
    addFinding(findings, path, "noncanonical-shared-skill-name", "shared read-github skill must use the canonical portable identity");
  }

  if (/\bhttps?:\/\/[^/\s"'\x60]+\.local(?:[/:]|$)/i.test(normalized)) {
    addFinding(findings, path, "private-namespace", "private local namespace must not be published");
  }

  if (/\b[A-Za-z]:\\(?:work|data|src|source|projects|repos|dev)\\(?!<[^>]+>)[^\\\s"'\x60]+\\/i.test(normalized)) {
    addFinding(findings, path, "operator-work-path", "concrete operator work path must not be published");
  }

  const sharedSkill = /^skills\/[^/]+\/SKILL\.md$/.test(normalizedPath);
  if (
    sharedSkill &&
    /(?:Hub\s+shell:\s*PowerShell|Skill\s+path\s*\(Windows\s+hub\)|(?:^|\n)#\s*Windows\s+hub\b|available\s+locally\s+on\s+Windows|Resolve\s+the\s+plugin\s+root\s+from\s+\$env:USERPROFILE|Scaffold\s*\(Windows\b|Collect\s+results\s*\(Windows\)|artifact\s+completeness\s*\(Windows\))/i.test(normalized)
  ) {
    addFinding(findings, path, "unconditional-host-default", "shared skill contains an unconditional maintainer-OS default");
  }
}

export function scanTextEntries(entries) {
  const findings = [];
  for (const entry of entries) scanEntry(entry, findings);
  return findings.sort((a, b) =>
    a.path.localeCompare(b.path) || a.rule.localeCompare(b.rule) || a.message.localeCompare(b.message),
  );
}

function isBinaryPath(path) {
  const dot = path.lastIndexOf(".");
  return dot >= 0 && BINARY_EXTENSIONS.has(path.slice(dot).toLowerCase());
}

export function collectTrackedTextEntries(root = process.cwd()) {
  const output = execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const entries = [];
  for (const path of output.split("\0").filter(Boolean)) {
    if (isBinaryPath(path)) continue;
    const content = readFileSync(resolve(root, path), "utf8");
    if (content.includes("\0")) continue;
    entries.push({ path, content });
  }
  return entries;
}

export function verifyPublicRelease(root = process.cwd()) {
  return scanTextEntries(collectTrackedTextEntries(root));
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  let findings;
  try {
    findings = verifyPublicRelease();
  } catch (error) {
    console.error(`public-release audit failed to run: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }

  if (findings.length) {
    for (const finding of findings) {
      console.error(`${finding.path}:${finding.rule}:${finding.message}`);
    }
    console.error(`Public release audit: FAIL (${findings.length} finding${findings.length === 1 ? "" : "s"})`);
    process.exit(1);
  }

  console.log("Public release audit: PASS");
}
