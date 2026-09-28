#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

function cleanRepo(repo) {
  return repo.endsWith(".git") ? repo.slice(0, -4) : repo;
}

export function normalizeGitHubTarget(input) {
  const target = String(input ?? "").trim();
  if (!target) throw new Error("target is required");

  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(target)) {
    const [owner, rawRepo] = target.split("/");
    return { owner, repo: cleanRepo(rawRepo), ref: null, path: null };
  }

  let url;
  try {
    url = new URL(target);
  } catch {
    throw new Error("unsupported GitHub target");
  }

  const parts = url.pathname.split("/").filter(Boolean);
  if (url.hostname === "github.com") {
    if (parts.length < 2) throw new Error("unsupported GitHub target");
    const [owner, rawRepo, marker, ref, ...rest] = parts;
    const repo = cleanRepo(rawRepo);
    if (!marker) return { owner, repo, ref: null, path: null };
    if (marker === "blob" && ref && rest.length) return { owner, repo, ref, path: rest.join("/") };
    throw new Error("unsupported GitHub target");
  }

  if (url.hostname === "raw.githubusercontent.com") {
    if (parts.length < 4) throw new Error("unsupported GitHub target");
    const [owner, rawRepo, ref, ...rest] = parts;
    return { owner, repo: cleanRepo(rawRepo), ref, path: rest.join("/") };
  }

  throw new Error("unsupported GitHub target");
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const result = normalizeGitHubTarget(process.argv[2]);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`normalize-github-target failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
