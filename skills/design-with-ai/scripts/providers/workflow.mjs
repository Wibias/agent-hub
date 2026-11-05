// Profile-aware provider execution for the existing DWA Gate phase.
// This coordinates additional evidence only; it cannot issue DWA completion proof.
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { createProviderRegistry, runProviders } from "./registry.mjs";
import { Capability } from "./contract.mjs";
import { createNativeDwaProvider } from "./native-dwa.mjs";
import { createImpeccableProvider } from "./impeccable.mjs";
import { createTasteSkillProvider } from "./taste-skill.mjs";
import { fuseProviderEvidence } from "./fuse.mjs";

const profiles = new Set(["quick", "standard", "deep"]);
const filled = (s) => typeof s === "string" && s.trim().length > 0;
const inside = (root, file) => {
  const rel = relative(root, file);
  return rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel);
};

export function selectProfileProviders({
  profile = "standard", withImpeccable = true, withTaste = false,
  requireTaste = false,
} = {}) {
  if (!profiles.has(profile) || typeof withImpeccable !== "boolean" ||
      typeof withTaste !== "boolean" || typeof requireTaste !== "boolean") {
    throw new TypeError("Invalid DWA provider profile or selection");
  }
  if (requireTaste && !withTaste) {
    throw new TypeError("A required Taste Skill scan must be explicitly enabled");
  }
  if (profile === "quick" && (withTaste || requireTaste)) {
    throw new TypeError("Quick profile cannot initiate a browser provider");
  }
  const optionalStatic = profile === "quick" || !withImpeccable
    ? [] : ["impeccable"];
  return {
    profile,
    required: ["native-dwa", ...(requireTaste ? ["taste-skill"] : [])],
    optional: [...optionalStatic, ...(withTaste && !requireTaste ? ["taste-skill"] : [])],
    static: { required: ["native-dwa"], optional: optionalStatic },
    rendered: withTaste
      ? { required: requireTaste ? ["taste-skill"] : [],
          optional: requireTaste ? [] : ["taste-skill"] }
      : null,
    notSelected: [
      ...(!optionalStatic.length ? ["impeccable"] : []),
      ...(!withTaste ? ["taste-skill"] : []),
    ],
  };
}

function validateScope({ target, route, projectRoot, html, withTaste }) {
  if (![target, route, projectRoot].every(filled) || !route.startsWith("/") ||
      route.includes("\0")) {
    throw new TypeError("Local source target, /route and project root are required");
  }
  const project = resolve(projectRoot), source = resolve(target);
  if (!existsSync(project) || !lstatSync(project).isDirectory() ||
      lstatSync(project).isSymbolicLink() ||
      !existsSync(source) || lstatSync(source).isSymbolicLink()) {
    throw new TypeError("Project root and source must exist without symlink targets");
  }
  const realProject = realpathSync(project), realSource = realpathSync(source);
  if (!inside(realProject, realSource) ||
      !(lstatSync(source).isDirectory() || lstatSync(source).isFile())) {
    throw new TypeError("Source target is outside the project scope");
  }
  if (withTaste && !filled(html)) {
    throw new TypeError("A local built HTML page is required when Taste Skill is selected");
  }
  return { projectRoot: realProject, target: realSource };
}

// Dependency injection lets policy and failure transitions be exercised
// without executing a browser or third-party tool during unit tests.
export async function runProfileProviders({
  profile = "standard", withImpeccable = true, withTaste = false,
  requireTaste = false, target, route, projectRoot, html, tasteRoot,
  outputRoot, intentPath, pageKind, category, primary,
} = {}, { registry, execute = runProviders } = {}) {
  const selection = selectProfileProviders({
    profile, withImpeccable, withTaste, requireTaste,
  });
  const location = validateScope({ target, route, projectRoot, html, withTaste });
  const actualRegistry = registry ?? createProviderRegistry([
    createNativeDwaProvider(),
    ...(selection.static.optional.length ? [createImpeccableProvider()] : []),
    ...(withTaste ? [createTasteSkillProvider({ skillRoot: tasteRoot })] : []),
  ]);
  const staticReports = await execute(actualRegistry, {
    capability: Capability.STATIC_AUDIT,
    ...selection.static,
    request: {
      target: location.target, route, projectRoot: location.projectRoot,
      ...(intentPath ? { intentPath } : {}),
    },
  });
  const renderedReports = selection.rendered ? await execute(actualRegistry, {
    capability: Capability.RENDERED_AUDIT,
    ...selection.rendered,
    request: {
      target: resolve(html), route, projectRoot: location.projectRoot,
      ...(outputRoot ? { outputRoot } : {}),
      ...(pageKind ? { pageKind } : {}),
      ...(category ? { category } : {}),
      ...(primary ? { primary } : {}),
    },
  }) : [];
  const reports = [...staticReports, ...renderedReports];
  const fusion = fuseProviderEvidence(reports, {
    required: selection.required,
    optional: selection.optional,
  });
  return {
    schemaVersion: 1,
    kind: "dwa/provider-workflow-evidence",
    profile,
    selection,
    reports,
    fusion,
    completionEligible: false,
    next: "Run the unchanged DWA rendered verification, evidence receipt, ledger reconciliation and iteration proof.",
  };
}
