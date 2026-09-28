import { posix, win32 } from "node:path";

function apiFor(path) {
  return /^[A-Za-z]:[\\/]/.test(path) || path.includes("\\") ? win32 : posix;
}

function within(path, root) {
  const api = apiFor(root);
  const candidate = api.normalize(path);
  const base = api.normalize(root);
  const left = api === win32 ? candidate.toLowerCase() : candidate;
  const right = api === win32 ? base.toLowerCase() : base;
  if (left === right) return "";
  const rel = api.relative(base, candidate);
  if (!rel || rel === ".." || rel.startsWith(`..${api.sep}`) || api.isAbsolute(rel)) return null;
  return rel;
}

function joinAlias(alias, rel) {
  if (!rel) return alias;
  return `${alias}/${rel.replaceAll("\\", "/")}`;
}

export function portablePath(path, { hubRoot, home, projectRoot = null }) {
  const hubRel = within(path, hubRoot);
  if (hubRel !== null) return joinAlias("~/.agents", hubRel);

  if (projectRoot) {
    const projectRel = within(path, projectRoot);
    if (projectRel !== null) return joinAlias("<project>", projectRel);
  }

  if (home) {
    const homeRel = within(path, home);
    if (homeRel !== null) return joinAlias("~", homeRel);
  }

  return path.replaceAll("\\", "/");
}

export function resolveBuildRoots({ scriptDir, home, projectRootArg } = {}) {
  if (!scriptDir) throw new Error("scriptDir is required");
  const api = apiFor(scriptDir);
  return {
    hubRoot: api.dirname(api.normalize(scriptDir)),
    home,
    projectRoot: projectRootArg ? api.resolve(projectRootArg) : null,
  };
}


export function portableFailureMessage(error, sourcePath, portableSource) {
  const message = error instanceof Error ? error.message : String(error);
  return message.split(String(sourcePath)).join(portableSource);
}
