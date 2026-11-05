#!/usr/bin/env node
// Explicit opt-in pilot only. Does not replace run-iteration-gate or UI review.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Capability, ProviderStatus } from "./contract.mjs";
import { createProviderRegistry, runProviders } from "./registry.mjs";
import { createNativeDwaProvider } from "./native-dwa.mjs";
import { createImpeccableProvider } from "./impeccable.mjs";

function options(argv) {
  if (argv.length === 0 || argv.length % 2 !== 0) {
    throw new Error("Usage: scan.mjs --provider impeccable|native-dwa --path <source> --route <route> [--project-root <dir>]");
  }
  const values = new Map();
  const keys = new Set(["--provider", "--path", "--route", "--project-root"]);
  for (let i = 0; i < argv.length; i += 2) {
    if (!keys.has(argv[i]) || values.has(argv[i]) ||
        argv[i + 1].startsWith("--") || !argv[i + 1].trim()) {
      throw new Error("Unrecognized, repeated, or empty provider option");
    }
    values.set(argv[i], argv[i + 1]);
  }
  const provider = values.get("--provider");
  if (!["impeccable", "native-dwa"].includes(provider) ||
      !values.has("--path") || !values.has("--route")) {
    throw new Error("Explicit provider, source path and route are required");
  }
  return {
    provider,
    request: {
      target: resolve(values.get("--path")),
      route: values.get("--route"),
      ...(values.has("--project-root")
        ? { projectRoot: resolve(values.get("--project-root")) } : {}),
    },
  };
}

async function main() {
  try {
    const chosen = options(process.argv.slice(2));
    const registry = createProviderRegistry([
      createNativeDwaProvider(), createImpeccableProvider(),
    ]);
    const [report] = await runProviders(registry, {
      capability: Capability.STATIC_AUDIT,
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
