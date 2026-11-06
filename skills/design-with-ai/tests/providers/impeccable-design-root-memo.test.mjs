import assert from "node:assert/strict";
import fs from "node:fs";
import {
  mkdirSync, mkdtempSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import {
  findDesignRoot, loadDesignSystemForTarget,
} from "../../../impeccable/scripts/detector/design-system.mjs";

function withFixtures(callback) {
  const home = mkdtempSync(join(tmpdir(), "dwa-impeccable-design-root-"));
  const project = join(home, "project");
  mkdirSync(project, { recursive: true });
  mkdirSync(join(project, ".git"));
  writeFileSync(join(project, "DESIGN.md"),
    "---\ntypography:\n  body:\n    fontFamily: \"Project Sans\"\n---\n");
  const source = join(project, "src");
  mkdirSync(source);
  for (const name of ["one.tsx", "two.tsx"]) {
    writeFileSync(join(source, name), "export const a = 1;\n");
  }
  try { return callback({ home, project, source }); }
  finally { rmSync(home, { recursive: true, force: true }); }
}

test("repeated source files reuse resolved design root without new boundary probes", () => {
  withFixtures(({ project, source }) => {
    const cache = new Map();
    const first = loadDesignSystemForTarget(join(source, "one.tsx"), { cache });
    assert.equal(first?.sourcePath, join(project, "DESIGN.md"));
    assert.equal(cache.get("resolve:" + resolve(source))?.dir, resolve(project));
    assert.equal(cache.get("resolve:" + resolve(project))?.hasDesign, true);

    const original = fs.existsSync;
    let probes = 0;
    try {
      fs.existsSync = (...args) => {
        probes++;
        return original(...args);
      };
      const again = loadDesignSystemForTarget(join(source, "two.tsx"), { cache });
      assert.strictEqual(again, first, "same loaded design contract in one scan");
      assert.equal(probes, 0, "cached directory must not reprobe ancestors");
    } finally {
      fs.existsSync = original;
    }
  });
});

test("nested DESIGN.md wins over outer cached ancestor for a sibling subtree", () => {
  withFixtures(({ home, project, source }) => {
    const nested = join(source, "nested");
    mkdirSync(nested);
    writeFileSync(join(nested, "DESIGN.md"),
      "---\ntypography:\n  body:\n    fontFamily: \"Nested Sans\"\n---\n");
    const child = join(nested, "child");
    mkdirSync(child);
    const leaf = join(child, "one.css");
    writeFileSync(leaf, "body { color: #111; }\n");

    const cache = new Map();
    const outer = loadDesignSystemForTarget(join(source, "one.tsx"), { cache });
    const nestedDesign = loadDesignSystemForTarget(leaf, { cache });
    assert.equal(outer?.sourcePath, join(project, "DESIGN.md"));
    assert.equal(nestedDesign?.sourcePath, join(nested, "DESIGN.md"));
    assert.notStrictEqual(nestedDesign, outer);
    assert.deepEqual(findDesignRoot(child, { cache }), findDesignRoot(child));
    assert.equal(loadDesignSystemForTarget(leaf, { cache }), nestedDesign);
    assert.equal(home.startsWith(project), false);
  });
});

test("project marker blocks outer DESIGN.md, cached no-design roots stay isolated", () => {
  withFixtures(({ project, source }) => {
    const separate = join(project, "packages", "separate");
    mkdirSync(join(separate, "src"), { recursive: true });
    writeFileSync(join(separate, "package.json"), "{}\n");
    const nestedFile = join(separate, "src", "page.css");
    writeFileSync(nestedFile, ".plain { padding: 1px }\n");
    const cache = new Map();

    const outer = loadDesignSystemForTarget(join(source, "one.tsx"), { cache });
    const none = loadDesignSystemForTarget(nestedFile, { cache });
    assert.equal(outer?.sourcePath, join(project, "DESIGN.md"));
    assert.equal(none, null);
    assert.deepEqual(findDesignRoot(join(separate, "src"), { cache }),
      { dir: separate, hasDesign: false });
    assert.equal(cache.get("resolve:" + resolve(separate))?.hasDesign, false);
    assert.equal(loadDesignSystemForTarget(nestedFile, { cache }), null);
  });
});

test("without an explicit scan cache, direct root lookup keeps normal semantics", () => {
  withFixtures(({ project, source }) => {
    assert.deepEqual(findDesignRoot(source), { dir: project, hasDesign: true });
    const direct = loadDesignSystemForTarget(join(source, "one.tsx"));
    assert.equal(direct?.sourcePath, join(project, "DESIGN.md"));
    assert.equal(findDesignRoot(join(source, "missing")), null === null
      ? findDesignRoot(join(source, "missing")) : null);
  });
});
