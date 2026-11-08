// Profile-aware provider execution for the existing DWA Gate phase.
// This coordinates additional evidence only; it cannot issue DWA completion proof.
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { createProviderRegistry, runProviders } from "./registry.mjs";
import { Capability } from "./contract.mjs";
import { createNativeDwaProvider } from "./native-dwa.mjs";
import { createImpeccableProvider } from "./impeccable.mjs";
import { createTasteSkillProvider } from "./taste-skill.mjs";
import { fuseProviderEvidence } from "./fuse.mjs";
import { sourceScopeProof, staticRouteForHtml } from "./scope-proof.mjs";
import { classifySurfaceFindings } from "../surface-relevance.mjs";

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

function validateScope({ target, route, projectRoot, html, browserRoot, outputRoot, withTaste }) {
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
  let renderedRoot = null;
  if (withTaste) {
    if (!filled(html)) {
      throw new TypeError("A local built HTML page is required when Taste Skill is selected");
    }
    const file = resolve(html);
    if (!existsSync(file) || !lstatSync(file).isFile() ||
        lstatSync(file).isSymbolicLink() ||
        ![".html", ".htm"].includes(extname(file).toLowerCase())) {
      throw new TypeError("Browser target must be a local regular HTML file");
    }
    const realFile = realpathSync(file);
    const assets = resolve(browserRoot ?? dirname(file));
    if (!existsSync(assets) || !lstatSync(assets).isDirectory() ||
        lstatSync(assets).isSymbolicLink()) {
      throw new TypeError("Browser asset root must be an existing regular directory");
    }
    renderedRoot = realpathSync(assets);
    if (!inside(realProject, realFile) || !inside(realProject, renderedRoot) ||
        !inside(renderedRoot, realFile) || renderedRoot === realProject) {
      throw new TypeError("Use an isolated built-site subtree inside projectRoot for browser assets");
    }
    if (staticRouteForHtml(renderedRoot, realFile) !== route) {
      throw new TypeError("Requested route does not match the built HTML path; SPA routes require verified route-specific HTML");
    }
    if (outputRoot && existsSync(resolve(outputRoot)) &&
        inside(renderedRoot, realpathSync(resolve(outputRoot)))) {
      throw new TypeError("Browser output cannot reside inside the served asset root");
    }
  }
  return { projectRoot: realProject, target: realSource, renderedRoot };
}

// Dependency injection lets policy and failure transitions be exercised
// without executing a browser or third-party tool during unit tests.
export async function runProfileProviders({
  profile = "standard", withImpeccable = true, withTaste = false,
  requireTaste = false, target, route, projectRoot, html, tasteRoot,
  browserRoot, outputRoot, intentPath, pageKind, category, primary,
} = {}, { registry, execute = runProviders } = {}) {
  const selection = selectProfileProviders({
    profile, withImpeccable, withTaste, requireTaste,
  });
  const location = validateScope({ target, route, projectRoot, html, browserRoot, outputRoot, withTaste });
  const before = sourceScopeProof({
    projectRoot: location.projectRoot, target: location.target, route,
    renderedRoot: location.renderedRoot, html: withTaste ? resolve(html) : null,
    intentPath,
    includeDetectorContext: selection.static.optional.includes("impeccable"),
  });
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
      target: resolve(html), route, projectRoot: location.renderedRoot,
      ...(outputRoot ? { outputRoot } : {}),
      ...(pageKind ? { pageKind } : {}),
      ...(category ? { category } : {}),
      ...(primary ? { primary } : {}),
    },
  }) : [];
  const after = sourceScopeProof({
    projectRoot: location.projectRoot, target: location.target, route,
    renderedRoot: location.renderedRoot, html: withTaste ? resolve(html) : null,
    intentPath,
    includeDetectorContext: selection.static.optional.includes("impeccable"),
  });
  if (before.summary.sourceSha256 !== after.summary.sourceSha256 ||
      before.observedInputsSha256 !== after.observedInputsSha256) {
    throw new Error("Audited source changed during provider execution; evidence invalid");
  }
  const unscopedReports = [...staticReports, ...renderedReports];
  const targetRelative = relative(location.projectRoot, location.target).split(sep).join("/");
  const surfaceFiles = (before.manifest.files ?? [])
    .map((entry) => (typeof entry === "string" ? entry : entry?.path))
    .filter((path) => typeof path === "string" && path.length > 0)
    .filter((path) => path === targetRelative || path.startsWith(targetRelative + "/"));
  const staticSurfaceReports = unscopedReports.filter((report) => report.capability === Capability.STATIC_AUDIT);
  const surfaceFindings = staticSurfaceReports.flatMap((report) =>
    report.findings.map((finding) => ({ ...finding, providerId: report.provider })));
  const surfaceRelevance = classifySurfaceFindings({
    projectRoot: location.projectRoot,
    target: location.target,
    route,
    findings: surfaceFindings,
    files: surfaceFiles.length ? surfaceFiles : null,
  });
  if (!withTaste && surfaceRelevance.binding.routeBinding === "static-route-closure") {
    // The source label is now backed by a static route/import closure.
    before.summary.routeBinding = "static-route-closure";
  }
  const surfaceByKey = new Map(surfaceRelevance.findings.map((finding) =>
    [finding.providerId + "\0" + finding.id, finding.surface]));
  const reports = unscopedReports.map((report) => ({
    ...report,
    surface: report.capability === Capability.STATIC_AUDIT
      ? {
        routeBinding: surfaceRelevance.binding.routeBinding,
        relevance: surfaceRelevance.counts,
        requiredChecks: surfaceRelevance.plan.requiredChecks.map((check) => ({
          id: check.id, states: check.states, because: check.because,
        })),
      }
      : { routeBinding: "verified-rendered-route", relevance: null, requiredChecks: [] },
    findings: report.findings.map((finding) => ({
      ...finding,
      surface: report.capability === Capability.STATIC_AUDIT
        ? surfaceByKey.get(report.provider + "\0" + finding.id) ?? null
        : null,
    })),
    auditScope: {
      sourceSha256: before.summary.sourceSha256,
      target: before.summary.target,
      route,
      gitHead: before.summary.gitHead,
      ...(report.capability === Capability.RENDERED_AUDIT
        ? { rendered: before.summary.rendered } : {}),
    },
  }));
  const fusion = fuseProviderEvidence(reports, {
    required: selection.required,
    optional: selection.optional,
    scope: before.summary,
  });
  const surface = {
    ...surfaceRelevance.binding,
    counts: surfaceRelevance.counts,
    requiredChecks: surfaceRelevance.plan.requiredChecks.map((check) => ({
      id: check.id, states: check.states, because: check.because,
    })),
    limitation: surfaceRelevance.limitation,
  };
  return {
    schemaVersion: 1,
    kind: "dwa/provider-workflow-evidence",
    profile,
    selection,
    reports,
    fusion,
    scope: before.summary,
    surface,
    sourceManifest: before.manifest,
    completionEligible: false,
    next: "Run the unchanged DWA rendered verification, evidence receipt, ledger reconciliation and iteration proof.",
  };
}
