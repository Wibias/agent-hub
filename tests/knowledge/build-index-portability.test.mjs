import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { portableFailureMessage, portablePath, resolveBuildRoots } from "../../knowledge/index-portability.mjs";

const windowsHome = ["C:", "Users", "alice"].join("\\");
const posixHome = ["", "home", "alice"].join("/");

test("portablePath canonicalizes Windows Hub paths", () => {
  assert.equal(portablePath([windowsHome, ".agents", "skills", "demo", "SKILL.md"].join("\\"), {
    hubRoot: [windowsHome, ".agents"].join("\\"),
    home: windowsHome,
    projectRoot: null,
  }), "~/.agents/skills/demo/SKILL.md");
});

test("portablePath canonicalizes POSIX Hub and project paths", () => {
  assert.equal(portablePath(`${posixHome}/.agents/skills/demo/SKILL.md`, {
    hubRoot: `${posixHome}/.agents`,
    home: posixHome,
    projectRoot: null,
  }), "~/.agents/skills/demo/SKILL.md");
  assert.equal(portablePath("/work/app/.agents/skills/demo/SKILL.md", {
    hubRoot: `${posixHome}/.agents`,
    home: posixHome,
    projectRoot: "/work/app",
  }), "<project>/.agents/skills/demo/SKILL.md");
});

test("resolveBuildRoots makes project indexing opt-in", () => {
  assert.deepEqual(resolveBuildRoots({ scriptDir: "/repo/knowledge", home: posixHome }), {
    hubRoot: "/repo",
    home: posixHome,
    projectRoot: null,
  });
  assert.deepEqual(resolveBuildRoots({ scriptDir: "/repo/knowledge", home: posixHome, projectRootArg: "/work/app" }), {
    hubRoot: "/repo",
    home: posixHome,
    projectRoot: "/work/app",
  });
});


test("builder persists portable paths instead of raw filesystem paths", () => {
  const source = readFileSync(new URL("../../knowledge/build-index.mjs", import.meta.url), "utf8");
  assert.match(source, /path:\s*portablePath\(filePath,/);
  assert.doesNotMatch(source, /path:\s*filePath\s*,/);
  assert.doesNotMatch(source, /new Date\(\)\.toISOString\(\)/);
});


test("builder sorts directory enumeration for deterministic IDs", () => {
  const source = readFileSync(new URL("../../knowledge/build-index.mjs", import.meta.url), "utf8");
  const sorts = source.match(/\.sort\(\(a, b\) => a\.name\.localeCompare\(b\.name\)\)/g) ?? [];
  assert.ok(sorts.length >= 4);
});


test("builder canonicalizes parse failure paths", () => {
  const source = readFileSync(new URL("../../knowledge/build-index.mjs", import.meta.url), "utf8");
  assert.match(source, /function recordParseFailure\(/);
  assert.equal((source.match(/parseFailures\.push\(/g) ?? []).length, 1);
  assert.match(source, /const portableSource\s*=\s*portablePath\(sourcePath,/);
  assert.match(source, /path:\s*portableSource\s*,/);
  assert.doesNotMatch(source, /path:\s*sourcePath\s*,/);
});


test("portableFailureMessage removes concrete source paths", () => {
  const source = ["C:", "Users", "alice", ".agents", "skills"].join("\\");
  const error = new Error(`ENOENT: no such file or directory, scandir '${source}'`);
  const message = portableFailureMessage(error, source, "~/.agents/skills");
  assert.equal(message, "ENOENT: no such file or directory, scandir '~/.agents/skills'");
  assert.doesNotMatch(message, /alice/);
});
