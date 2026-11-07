import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderedAssetProof } from "../../scripts/providers/rendered-assets.mjs";
import { sourceScopeProof } from "../../scripts/providers/scope-proof.mjs";

function fixture(fn) {
  const root = mkdtempSync(join(tmpdir(), "dwa-rendered-assets-"));
  const source = join(root, "src", "page.tsx");
  const renderedRoot = join(root, "dist");
  const html = join(renderedRoot, "settings", "index.html");
  const css = join(renderedRoot, "assets", "app.css");
  const js = join(renderedRoot, "assets", "app.js");
  const image = join(renderedRoot, "assets", "image.svg");
  const font = join(renderedRoot, "assets", "font.woff2");
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(renderedRoot, "settings"), { recursive: true });
  mkdirSync(join(renderedRoot, "assets"), { recursive: true });
  writeFileSync(source, "export const Page = 1;\n");
  writeFileSync(html, '<!doctype html><link rel="stylesheet" href="../assets/app.css"><script src="../assets/app.js"></script>');
  writeFileSync(css, "body { color: red; }\n");
  writeFileSync(js, "document.body.dataset.ready = 'yes';\n");
  writeFileSync(image, "<svg></svg>\n");
  writeFileSync(font, Buffer.from([0x77, 0x4f, 0x46, 0x32, 0, 1, 2]));
  const sample = () => sourceScopeProof({
    projectRoot: root, target: source, route: "/settings",
    renderedRoot, html,
  });
  try { return fn({ root, source, renderedRoot, html, css, js, image, font, sample }); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

test("full local rendered tree includes HTML, CSS, JavaScript, image and font", () => {
  fixture((f) => {
    const proof = renderedAssetProof({
      projectRoot: f.root, renderedRoot: f.renderedRoot, html: f.html,
    });
    assert.equal(proof.fileCount, 5);
    assert.equal(proof.kind, "dwa/complete-local-rendered-tree");
    assert.deepEqual(proof.files.map((x) => x.path), [
      "dist/assets/app.css", "dist/assets/app.js", "dist/assets/font.woff2",
      "dist/assets/image.svg", "dist/settings/index.html",
    ]);
    assert.ok(proof.files.every((x) => /^[a-f0-9]{64}$/.test(x.sha256)));
    const scope = f.sample();
    assert.equal(scope.summary.fileCount, 1, "source count stays independent");
    assert.equal(scope.manifest.renderedAssets.fileCount, 5);
    assert.equal(scope.summary.rendered.assetCount, 5);
    assert.equal(scope.summary.rendered.assetTreeSha256, proof.filesSha256);
    assert.equal(scope.summary.rendered.assetCoverage, "COMPLETE_LOCAL_TREE_BOUNDED");
    assert.equal(scope.manifest.rendered.sha256,
      proof.files.find((x) => x.path === "dist/settings/index.html").sha256);
  });
});

test("a CSS/JS/image/font asset changes the scoped digest without HTML changes", () => {
  fixture((f) => {
    const initial = f.sample();
    for (const file of [f.css, f.js, f.image, f.font]) {
      const before = f.sample();
      const bytes = readFileSync(file);
      assert.ok(bytes.length > 0, "Fixture asset must not be empty");
      bytes[bytes.length - 1] ^= 1; // Same-length trailing-byte mutation, including binary fonts.
      writeFileSync(file, bytes);
      const changed = f.sample();
      assert.equal(changed.summary.rendered.sha256, initial.summary.rendered.sha256,
        "HTML must be unchanged");
      assert.notEqual(changed.summary.sourceSha256, before.summary.sourceSha256,
        "Each individual asset mutation must change the bound source digest");
      assert.notEqual(changed.summary.rendered.assetTreeSha256,
        before.summary.rendered.assetTreeSha256,
        "Each individual asset mutation must change the asset-tree digest");
    }
  });
});

test("mixed canonical HTML and aliased project ancestor resolve the same page digest", () => {
  fixture((f) => {
    const aliasHome = mkdtempSync(join(tmpdir(), "dwa-canonical-parent-"));
    try {
      // Only an ancestor is symlinked; the project root itself is a real
      // directory entry, as required by renderedAssetProof's strict lstat.
      const actualParent = join(f.root, "..");
      const linkedParent = join(aliasHome, "linked-parent");
      symlinkSync(actualParent, linkedParent, process.platform === "win32" ? "junction" : "dir");
      const aliasRoot = join(linkedParent, f.root.split(/[\\/]/).at(-1));
      const result = sourceScopeProof({
        projectRoot: aliasRoot,
        target: join(aliasRoot, "src", "page.tsx"),
        route: "/settings",
        renderedRoot: f.renderedRoot, // Canonical path, unlike projectRoot.
        html: f.html,
        includeDetectorContext: false,
      });
      assert.equal(result.manifest.rendered.page, "dist/settings/index.html");
      assert.equal(result.manifest.rendered.sha256,
        result.manifest.renderedAssets.files.find((e) =>
          e.path === "dist/settings/index.html").sha256);
    } finally {
      rmSync(aliasHome, { recursive: true, force: true });
    }
  });
});

test("adding and removing previously unseen local assets changes the digest", () => {
  fixture((f) => {
    const original = f.sample();
    const nested = join(f.renderedRoot, "assets", "lazy");
    mkdirSync(nested);
    const dynamic = join(nested, "chunk.mjs");
    writeFileSync(dynamic, "export default 'lazy';\n");
    const added = f.sample();
    assert.equal(added.manifest.renderedAssets.fileCount, 6);
    assert.notEqual(original.summary.sourceSha256, added.summary.sourceSha256);
    unlinkSync(dynamic);
    const reverted = f.sample();
    assert.equal(reverted.manifest.renderedAssets.fileCount, 5);
    assert.equal(reverted.summary.sourceSha256, original.summary.sourceSha256,
      "the content digest is stable for the same asset set");
  });
});

test("Vite-style build with 1024 hashed lazy chunks has stable cross-platform paths and complete SHA coverage", () => {
  fixture((f) => {
    const folder = join(f.renderedRoot, "assets", "chunks");
    mkdirSync(folder);
    const count = 1024;
    for (let i = 0; i < count; i++) {
      const file = join(folder, "chunk-" + String(i).padStart(4, "0") + "-a1b2c3d4.js");
      writeFileSync(file, "export const n = " + i + ";\n");
    }
    const one = f.sample();
    assert.equal(one.manifest.renderedAssets.fileCount, count + 5);
    assert.equal(one.manifest.renderedAssets.files.length, count + 5);
    assert.ok(one.manifest.renderedAssets.files.every((entry) =>
      !entry.path.includes("\\") && entry.path.startsWith("dist/") &&
      /^[a-f0-9]{64}$/.test(entry.sha256)));
    assert.equal(one.summary.rendered.assetCoverage, "COMPLETE_LOCAL_TREE_BOUNDED");
    const two = f.sample();
    assert.equal(one.summary.rendered.assetTreeSha256, two.summary.rendered.assetTreeSha256,
      "Repeat manifest must be deterministic regardless of directory enumeration order");
    assert.equal(one.summary.sourceSha256, two.summary.sourceSha256);
    const target = join(folder, "chunk-0512-a1b2c3d4.js");
    writeFileSync(target, "export const n = 512; // changed\n");
    const changed = f.sample();
    assert.notEqual(changed.summary.sourceSha256, one.summary.sourceSha256);
    assert.notEqual(changed.summary.rendered.assetTreeSha256,
      one.summary.rendered.assetTreeSha256);
    assert.equal(changed.manifest.rendered.sha256, one.manifest.rendered.sha256,
      "Stable entry HTML cannot mask a mutated lazy Vite-style chunk");
  });
});

test("byte limits fail closed for oversized files and unexpected special entries", () => {
  fixture((f) => {
    const huge = join(f.renderedRoot, "assets", "large.binary");
    // Sparse extension without allocating 129 MiB of physical disk blocks.
    // Node's truncate utility is synchronous and memory-bounded.
    writeFileSync(huge, "start");
    truncateSync(huge, 129 * 1024 * 1024);
    assert.throws(() => f.sample(), /per-file byte limit/);
  });
});

test("too many assets are rejected rather than silently truncated", () => {
  fixture((f) => {
    const overflow = join(f.renderedRoot, "assets", "many");
    mkdirSync(overflow);
    for (let i = 0; i < 10005; i++) {
      writeFileSync(join(overflow, String(i).padStart(5, "0") + ".txt"), "");
    }
    assert.throws(() => f.sample(), /count limit|entry count limit/);
  });
});


test("symlinked build asset files are never trusted", (t) => {
  fixture((f) => {
    const outside = mkdtempSync(join(tmpdir(), "dwa-rendered-external-"));
    try {
      const external = join(outside, "external.js");
      writeFileSync(external, "window.evil = true;\n");
      const bad = join(f.renderedRoot, "assets", "external.js");
      try {
        symlinkSync(external, bad);
      } catch (error) {
        // Windows may deny file symlinks without developer-mode privileges.
        if (process.platform === "win32" &&
            ["EPERM", "EACCES", "ENOSYS"].includes(error.code)) {
          t.skip("Windows runner cannot create file symlinks");
          return;
        }
        throw error;
      }
      assert.throws(() => f.sample(), /Symlink inside rendered asset tree/);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

test("symlinked build directories and Windows junctions are never trusted", () => {
  fixture((f) => {
    const outside = mkdtempSync(join(tmpdir(), "dwa-rendered-external-dir-"));
    try {
      writeFileSync(join(outside, "external.js"), "window.evil = true;\n");
      const badDirectory = join(f.renderedRoot, "assets", "external-dir");
      symlinkSync(outside, badDirectory, process.platform === "win32" ? "junction" : "dir");
      assert.throws(() => f.sample(), /Symlink inside rendered asset tree/);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

test("source-only run retains prior manifest shape and avoids build traversal", () => {
  fixture((f) => {
    const result = sourceScopeProof({
      projectRoot: f.root, target: f.source, route: "/settings",
    });
    assert.equal(result.manifest.rendered, null);
    assert.equal(result.manifest.renderedAssets, undefined);
    assert.equal(result.summary.rendered, null);
  });
});

test("a built HTML outside served subtree is rejected", () => {
  fixture((f) => {
    assert.throws(() => renderedAssetProof({
      projectRoot: f.root, renderedRoot: join(f.root, "src"), html: f.html,
    }), /isolated in-project build subtree/);
  });
});
