#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_EXTENSIONS = new Set([
  ".tsx", ".jsx", ".vue", ".svelte", ".html", ".css", ".scss", ".mdx", ".md",
]);

function parseArgs(argv) {
  const args = { path: null, json: false, intentPath: null, extensions: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") args.json = true;
    else if (arg === "--path") args.path = argv[++i];
    else if (arg === "--intent") args.intentPath = argv[++i];
    else if (arg === "--extensions") args.extensions = argv[++i];
    else if (!arg.startsWith("-") && !args.path) args.path = arg;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.path) throw new Error("Usage: taste-gate.mjs --path <file-or-directory> [--json] [--intent <json>] [--extensions .tsx,.css]");
  return args;
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${label} is invalid JSON: ${path}: ${error.message}`);
  }
}

function compilePatterns(patterns, owner) {
  return (patterns ?? []).map((pattern) => {
    try {
      return new RegExp(pattern, "iu");
    } catch (error) {
      throw new Error(`Invalid regex for ${owner}: ${pattern}: ${error.message}`);
    }
  });
}

function normalizePath(path) {
  return path.replaceAll("\\", "/");
}

function wildcardToRegExp(pattern) {
  const escaped = normalizePath(pattern || "*")
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

function loadIntent(intentPath) {
  if (!intentPath) return { path: null, exceptions: [], warnings: [] };
  const absolute = resolve(intentPath);
  if (!existsSync(absolute)) throw new Error(`Intent path not found: ${absolute}`);
  const intent = readJson(absolute, "Intent contract");
  const warnings = [];
  const exceptions = [];
  for (const [index, item] of (intent.exceptions ?? []).entries()) {
    if (!item || (typeof item.rule !== "string" && typeof item.family !== "string")) {
      warnings.push(`exceptions[${index}] ignored: expected rule or family`);
      continue;
    }
    if (typeof item.reason !== "string" || item.reason.trim().length === 0) {
      warnings.push(`exceptions[${index}] ignored: a non-empty reason is required`);
      continue;
    }
    exceptions.push({
      rule: typeof item.rule === "string" ? item.rule : null,
      family: typeof item.family === "string" ? item.family : null,
      scope: typeof item.scope === "string" && item.scope.trim() ? item.scope : "*",
      reason: item.reason.trim(),
    });
  }
  return { path: absolute, exceptions, warnings };
}

function shouldSuppress(hit, exceptions) {
  if (hit.hardGate) return null;
  for (const exception of exceptions) {
    const ownerMatches = (exception.rule && exception.rule === hit.id)
      || (exception.family && exception.family === hit.family);
    if (!ownerMatches) continue;
    const scope = wildcardToRegExp(exception.scope);
    const files = hit.files ?? [hit.relativeFile];
    if (files.length > 0 && files.every((file) => scope.test(normalizePath(file)))) return exception;
  }
  return null;
}

function collectFiles(root, extensions) {
  const absolute = resolve(root);
  if (!existsSync(absolute)) throw new Error(`Path not found: ${absolute}`);
  const st = statSync(absolute);
  if (st.isFile()) return [absolute];
  const out = [];
  const stack = [absolute];
  const ignored = new Set(["node_modules", ".git", "dist", "build", ".next"]);
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!ignored.has(entry.name)) stack.push(join(dir, entry.name));
        continue;
      }
      if (entry.isFile() && extensions.has(extname(entry.name).toLowerCase())) out.push(join(dir, entry.name));
    }
  }
  return out.sort();
}

function scanTextRules(files, rootDir, registry) {
  const hits = [];
  for (const rule of registry.rules ?? []) {
    if (rule.enabled === false) continue;
    const regexes = compilePatterns(rule.patterns, rule.name);
    for (const file of files) {
      const content = readFileSync(file, "utf8");
      const lines = content.split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (!regexes.some((regex) => regex.test(line))) continue;
        hits.push({
          severity: rule.severity,
          id: rule.id,
          name: rule.name,
          family: rule.family,
          hardGate: rule.hardGate === true,
          clusterEligible: rule.clusterEligible === true,
          weight: Number(rule.weight ?? 0),
          file,
          relativeFile: normalizePath(relative(rootDir, file)) || basename(file),
          line: index + 1,
          text: line.trim(),
          note: rule.note,
          evidence: rule.evidence ?? null,
          derived: false,
        });
      }
    }
  }
  return hits;
}

function scanDerivedRules(files, rootDir, registry) {
  const hits = [];
  const fileContents = files.map((file) => ({
    file,
    relativeFile: normalizePath(relative(rootDir, file)) || basename(file),
    content: readFileSync(file, "utf8"),
  }));

  for (const rule of registry.derivedRules ?? []) {
    if (rule.enabled === false) continue;
    const matchedProbes = [];
    const contributingFiles = new Set();
    for (const probe of rule.probes ?? []) {
      const regexes = compilePatterns(probe.patterns, `${rule.name}/${probe.name}`);
      const filesForProbe = fileContents.filter(({ content }) => regexes.some((regex) => regex.test(content)));
      if (filesForProbe.length === 0) continue;
      matchedProbes.push(probe.name);
      for (const item of filesForProbe) contributingFiles.add(item.relativeFile);
    }
    if (matchedProbes.length < Number(rule.requiresAny ?? rule.probes?.length ?? 1)) continue;
    hits.push({
      severity: rule.severity,
      id: rule.id,
      name: rule.name,
      family: rule.family,
      hardGate: rule.hardGate === true,
      clusterEligible: rule.clusterEligible === true,
      weight: Number(rule.weight ?? 0),
      file: "<surface>",
      relativeFile: "<surface>",
      files: [...contributingFiles].sort(),
      line: null,
      text: matchedProbes.join(" + "),
      note: rule.note,
      evidence: rule.evidence ?? null,
      derived: true,
      probes: matchedProbes,
    });
  }
  return hits;
}

function summarizeFamilies(hits, policy) {
  const groups = new Map();
  for (const hit of hits) {
    if (!hit.clusterEligible || hit.hardGate) continue;
    const current = groups.get(hit.family) ?? {
      family: hit.family,
      score: 0,
      baseWeight: 0,
      repeatBonus: 0,
      occurrences: 0,
      ruleIds: new Set(),
      files: new Set(),
    };
    current.occurrences += 1;
    current.baseWeight = Math.max(current.baseWeight, hit.weight);
    current.ruleIds.add(hit.id);
    for (const file of hit.files ?? [hit.relativeFile]) current.files.add(file);
    groups.set(hit.family, current);
  }

  const families = [...groups.values()].map((group) => {
    const repeatBonus = group.files.size >= Number(policy.repeatAcrossFilesThreshold ?? Infinity)
      ? Number(policy.repeatAcrossFilesBonus ?? 0)
      : 0;
    return {
      family: group.family,
      score: group.baseWeight + repeatBonus,
      baseWeight: group.baseWeight,
      repeatBonus,
      occurrences: group.occurrences,
      ruleIds: [...group.ruleIds].sort(),
      files: [...group.files].sort(),
    };
  }).sort((a, b) => b.score - a.score || a.family.localeCompare(b.family));

  return {
    independentFamilies: families.length,
    score: families.reduce((sum, family) => sum + family.score, 0),
    minimumIndependentFamilies: Number(policy.minimumIndependentFamilies ?? 3),
    minimumScore: Number(policy.minimumScore ?? 5),
    families,
  };
}

function formatHit(hit) {
  const location = hit.line ? `${hit.relativeFile}:${hit.line}` : (hit.files?.join(", ") || hit.relativeFile);
  return `${hit.severity} ${hit.id} ${hit.name} [${hit.family}] ${location} - ${hit.note}`;
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
    const scriptDir = dirname(fileURLToPath(import.meta.url));
    const registryPath = resolve(scriptDir, "../references/slop-signals.json");
    const registry = readJson(registryPath, "Signal registry");
    if (registry.schemaVersion !== 1) throw new Error(`Unsupported signal registry schemaVersion: ${registry.schemaVersion}`);

    const extensions = args.extensions
      ? new Set(args.extensions.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean).map((value) => value.startsWith(".") ? value : `.${value}`))
      : DEFAULT_EXTENSIONS;
    const files = collectFiles(args.path, extensions);
    if (files.length === 0) throw new Error(`No matching files under ${resolve(args.path)}`);

    const resolvedTarget = resolve(args.path);
    const rootDir = statSync(resolvedTarget).isDirectory() ? resolvedTarget : dirname(resolvedTarget);
    const intent = loadIntent(args.intentPath);
    const rawHits = [
      ...scanTextRules(files, rootDir, registry),
      ...scanDerivedRules(files, rootDir, registry),
    ];

    const hits = [];
    const suppressedHits = [];
    for (const hit of rawHits) {
      const exception = shouldSuppress(hit, intent.exceptions);
      if (exception) suppressedHits.push({ ...hit, suppressedBy: exception });
      else hits.push(hit);
    }

    const p0 = hits.filter((hit) => hit.severity === "P0");
    const p1 = hits.filter((hit) => hit.severity === "P1");
    const p2 = hits.filter((hit) => hit.severity === "P2");
    const cluster = summarizeFamilies(hits, registry.clusterPolicy ?? {});
    const clusterTriggered = cluster.independentFamilies >= cluster.minimumIndependentFamilies
      && cluster.score >= cluster.minimumScore;
    const verdict = p0.length > 0
      ? "HOLD"
      : clusterTriggered
        ? "REVIEW_CLUSTER"
        : p1.length > 0
          ? "REVIEW"
          : "PASS_MECHANICAL";

    const summary = {
      path: resolvedTarget,
      registry: registryPath,
      filesScanned: files.length,
      p0: p0.length,
      p1: p1.length,
      p2: p2.length,
      verdict,
      cluster,
      intent: {
        path: intent.path,
        suppressed: suppressedHits.length,
        warnings: intent.warnings,
      },
      note: "Mechanical leads only. Contextual signals and REVIEW_CLUSTER require project/brief context plus rendered verification; only mechanically decisive P0 hits change the exit code.",
      hits,
      suppressedHits,
    };

    if (args.json) {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    } else {
      console.log("");
      console.log("design-with-ai taste-gate");
      console.log(` path: ${summary.path}`);
      console.log(` files: ${summary.filesScanned}`);
      console.log(` P0: ${summary.p0} P1: ${summary.p1} P2: ${summary.p2}`);
      console.log(` cluster: ${cluster.independentFamilies} families / score ${cluster.score} (review at ${cluster.minimumIndependentFamilies} families and ${cluster.minimumScore} points)`);
      console.log(` suppressed: ${summary.intent.suppressed}`);
      console.log(` verdict: ${summary.verdict}`);
      console.log(` ${summary.note}`);
      if (summary.intent.warnings.length) {
        console.log(" intent warnings:");
        for (const warning of summary.intent.warnings) console.log(`  - ${warning}`);
      }
      if (cluster.families.length) {
        console.log(" families:");
        for (const family of cluster.families) console.log(`  - ${family.family}: ${family.score} (${family.ruleIds.join(", ")}; ${family.files.length} file(s))`);
      }
      console.log("");
      if (hits.length === 0) console.log("No unsuppressed mechanical hits.");
      else for (const hit of hits) console.log(formatHit(hit));
      if (suppressedHits.length) {
        console.log("");
        console.log("Suppressed contextual hits:");
        for (const hit of suppressedHits) console.log(`${formatHit(hit)} [reason: ${hit.suppressedBy.reason}]`);
      }
    }

    process.exitCode = p0.length > 0 ? 1 : 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (args?.json) process.stdout.write(`${JSON.stringify({ error: message }, null, 2)}\n`);
    else console.error(message);
    process.exitCode = 2;
  }
}

main();
