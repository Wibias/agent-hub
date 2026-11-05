#!/usr/bin/env node
// Explicit opt-in pilots. Neither result replaces the canonical DWA iteration gate.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Capability, ProviderStatus } from "./contract.mjs";
import { createProviderRegistry, runProviders } from "./registry.mjs";
import { createNativeDwaProvider } from "./native-dwa.mjs";
import { createImpeccableProvider } from "./impeccable.mjs";
import { createTasteSkillProvider } from "./taste-skill.mjs";

function options(argv) {
  if (argv.length === 0 || argv.length % 2 !== 0) {
    throw new Error("Usage: scan.mjs --provider native-dwa|impeccable|taste-skill --path <source or HTML file> --route <route> [--project-root <dir>] [--skill-root <installed-taste-dir>] [--output-root <dir>] [--page-kind <kind>]");
  }
  const values = new Map();
  const keys = new Set([
    "--provider", "--path", "--route", "--project-root",
    "--skill-root", "--output-root", "--page-kind", "--category", "--primary",
  ]);
  for (let i = 0; i < argv.length; i += 2) {
    if (!keys.has(argv[i]) || values.has(argv[i]) ||
        argv[i + 1].startsWith("--") || !argv[i + 1].trim()) {
      throw new Error("Unrecognized, repeated, or empty provider option");
    }
    values.set(argv[i], argv[i + 1]);
  }
  const provider = values.get("--provider");
  if (!["native-dwa", "impeccable", "taste-skill"].includes(provider) ||
      !values.has("--path") || !values.has("--route")) {
    throw new Error("Explicit provider, source path and route are required");
  }
  const rendered = provider === "taste-skill";
  if (rendered && (!values.has("--project-root") || !values.has("--skill-root"))) {
    throw new Error("Taste Skill requires --project-root and --skill-root");
  }
  if (!rendered && ["--skill-root", "--output-root", "--page-kind", "--category", "--primary"]
    .some((key) => values.has(key))) {
    throw new Error("Rendered-only flags are not supported by static providers");
  }
  return {
    provider,
    capability: rendered ? Capability.RENDERED_AUDIT : Capability.STATIC_AUDIT,
    skillRoot: rendered ? resolve(values.get("--skill-root")) : null,
    request: {
      target: resolve(values.get("--path")),
      route: values.get("--route"),
      ...(values.has("--project-root")
        ? { projectRoot: resolve(values.get("--project-root")) } : {}),
      ...(values.has("--output-root")
        ? { outputRoot: resolve(values.get("--output-root")) } : {}),
      ...(values.has("--page-kind") ? { pageKind: values.get("--page-kind") } : {}),
      ...(values.has("--category") ? { category: values.get("--category") } : {}),
      ...(values.has("--primary") ? { primary: values.get("--primary") } : {}),
    },
  };
}

async function main() {
  try {
    const chosen = options(process.argv.slice(2));
    const registry = createProviderRegistry([
      createNativeDwaProvider(),
      createImpeccableProvider(),
      ...(chosen.provider === "taste-skill"
        ? [createTasteSkillProvider({ skillRoot: chosen.skillRoot })] : []),
    ]);
    const [report] = await runProviders(registry, {
      capability: chosen.capability,
      required: [chosen.provider],
      request: chosen.request,
    });
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    process.exitCode = report.status === ProviderStatus.PASS ? 0
      : report.status === ProviderStatus.FINDINGS ? 1 : 2;
  } catch (error) {
    process.stdout.write(JSON.stringify({
      error: String(error.message ?? error),
    }, null, 2) + "\n");
    process.exitCode = 2;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
