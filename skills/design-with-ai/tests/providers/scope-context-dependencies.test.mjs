import assert from "node:assert/strict";
import {
  mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { sourceScopeProof } from "../../scripts/providers/scope-proof.mjs";

function fixture(fn) {
  const root = mkdtempSync(join(tmpdir(), "dwa-context-scope-"));
  const src = join(root, "src");
  mkdirSync(src);
  writeFileSync(join(root, "package.json"), "{}\n");
  const target = join(src, "style.css");
  writeFileSync(target, "body { color: #111; }\n");
  const inspect = (source = target) =>
    sourceScopeProof({ projectRoot: root, target: source, route: "/test" });
  try { return fn({ root, src, target, inspect }); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

test("a DESIGN.md outside a selected source target is part of its provenance", () => {
  fixture(({ root, inspect }) => {
    const baseline = inspect();
    const design = join(root, "DESIGN.md");
    writeFileSync(design,
      "---\ntypography:\n  body:\n    fontFamily: Arial\n---\n");
    const first = inspect();
    assert.notEqual(first.summary.sourceSha256, baseline.summary.sourceSha256);
    assert.equal(first.manifest.files.length, 1);
    assert.deepEqual(first.manifest.detectorContext.map((x) => x.path), ["DESIGN.md"]);
    writeFileSync(design,
      "---\ntypography:\n  body:\n    fontFamily: Noto Sans\n---\n");
    const changed = inspect();
    assert.notEqual(changed.summary.sourceSha256, first.summary.sourceSha256);
    assert.equal(changed.manifest.detectorContext[0].path, "DESIGN.md");
  });
});

test("shared, local and sidecar detector config influence the source fingerprint", () => {
  fixture(({ root, inspect }) => {
    const directory = join(root, ".impeccable");
    mkdirSync(directory);
    writeFileSync(join(root, "DESIGN.md"), "---\ncolors:\n  ink: '#000000'\n---\n");
    const base = inspect();
    writeFileSync(join(directory, "config.json"),
      '{"detector":{"ignoreRules":["overused-font"]}}\n');
    const shared = inspect();
    assert.notEqual(shared.summary.sourceSha256, base.summary.sourceSha256);
    writeFileSync(join(directory, "config.local.json"),
      '{"detector":{"ignoreRules":["nested-cards"]}}\n');
    const local = inspect();
    assert.notEqual(local.summary.sourceSha256, shared.summary.sourceSha256);
    writeFileSync(join(directory, "design.json"), '{"colors":{"ink":"#111111"}}\n');
    const sidecar = inspect();
    assert.notEqual(sidecar.summary.sourceSha256, local.summary.sourceSha256);
    assert.deepEqual(sidecar.manifest.detectorContext.map((x) => x.path), [
      ".impeccable/config.json", ".impeccable/config.local.json",
      ".impeccable/design.json", "DESIGN.md",
    ]);
    writeFileSync(join(directory, "config.local.json"),
      '{"detector":{"ignoreRules":["changed"]}}\n');
    assert.notEqual(inspect().summary.sourceSha256, sidecar.summary.sourceSha256);
  });
});

test("HTML-only Impeccable source proof includes linked sibling CSS bytes", () => {
  fixture(({ root, src }) => {
    const html = join(src, "page.html");
    const css = join(src, "site.css");
    writeFileSync(html,
      '<!doctype html><link href="site.css?v=1&theme=2" rel="stylesheet"><h1>Title</h1>');
    writeFileSync(css, "h1 { color: red; }\n");
    const inspect = (includeDetectorContext) => sourceScopeProof({
      projectRoot: root, target: html, route: "/page", includeDetectorContext,
    });
    const first = inspect(true);
    assert.equal(first.manifest.files.length, 1, "only selected HTML is the source file");
    assert.deepEqual(first.manifest.linkedStylesheets.map((x) => x.path),
      ["src/site.css"]);
    const nativeBefore = inspect(false);
    writeFileSync(css, "h1 { color: blue; }\n");
    const changed = inspect(true);
    assert.notEqual(changed.summary.sourceSha256, first.summary.sourceSha256,
      "HTML-only proof must bind linked CSS changes to the manifest digest");
    assert.notEqual(changed.observedInputsSha256, first.observedInputsSha256,
      "linked CSS input metadata must also change on subsequent scans");
    assert.equal(inspect(false).summary.sourceSha256, nativeBefore.summary.sourceSha256,
      "native-only source proof must not acquire optional detector dependencies");
  });
});

test("only genuine HTML link elements contribute CSS proof", () => {
  fixture(({ root, src }) => {
    const html = join(src, "page.html");
    const css = join(src, "site.css");
    writeFileSync(css, "h1 { color: red; }\n");
    writeFileSync(html, [
      "<!doctype html>",
      "<link-button>Custom element, not a stylesheet</link-button>",
      "<link_widget>Another non-link element</link_widget>",
      '<!-- <link rel="style&#115;heet" href="wrong.css"> -->',
      '<script>const example = "<link rel=stylesheet href=wrong.css>";</script>',
      '<style>.sample:after { content: "<link rel=stylesheet href=wrong.css>" }</style>',
      '<textarea><link rel="style&#115;heet" href="wrong.css"></textarea>',
      '<link rel="stylesheet" href="site.css">',
    ].join("\n"));
    const inspect = () => sourceScopeProof({
      projectRoot: root, target: html, route: "/page", includeDetectorContext: true,
    });
    const first = inspect();
    assert.deepEqual(first.manifest.linkedStylesheets.map((asset) => asset.path), ["src/site.css"]);
    writeFileSync(css, "h1 { color: blue; }\n");
    assert.notEqual(inspect().summary.sourceSha256, first.summary.sourceSha256,
      "real link CSS changes remain fingerprint-bound");
    writeFileSync(html, '<link rel="style&#115;heet" href="site.css">');
    assert.throws(inspect, /Entity-bearing stylesheet rel cannot be attested/);
  });
});

test("HTML entity-encoded stylesheet rel cannot evade the source proof", () => {
  fixture(({ root, src }) => {
    const html = join(src, "page.html");
    const css = join(src, "site.css");
    writeFileSync(html, '<link rel="style&#115;heet" href="site.css">');
    writeFileSync(css, "h1 { color: red; }\n");
    const inspect = (includeDetectorContext) => sourceScopeProof({
      projectRoot: root, target: html, route: "/page", includeDetectorContext,
    });
    assert.throws(() => inspect(true),
      /Entity-bearing stylesheet rel cannot be attested/,
      "An entity-decoding HTML parser would read this linked stylesheet");
    writeFileSync(css, "h1 { color: blue; }\n");
    assert.throws(() => inspect(true),
      /Entity-bearing stylesheet rel cannot be attested/,
      "Neither original nor changed CSS may receive an unsupported proof");
    assert.equal(inspect(false).manifest.linkedStylesheets, undefined,
      "The unrelated native-only quick profile stays unaffected");
  });
});

test("data.rel cannot shadow an entity-encoded rel or bypass linked CSS proof", () => {
  fixture(({ root, src }) => {
    const html = join(src, "page.html");
    const css = join(src, "site.css");
    writeFileSync(css, "h1 { color: red; }\n");
    const inspect = () => sourceScopeProof({
      projectRoot: root, target: html, route: "/page", includeDetectorContext: true,
    });
    writeFileSync(html,
      '<link rel="style&#115;heet" data.rel="alternate" href="site.css">');
    assert.throws(inspect, /Entity-bearing stylesheet rel cannot be attested/,
      "data.rel must not overwrite the real rel attribute");
    writeFileSync(css, "h1 { color: blue; }\n");
    assert.throws(inspect, /Entity-bearing stylesheet rel cannot be attested/);
    writeFileSync(html,
      '<link rel="stylesheet" data.rel="alternate" href="site.css">');
    assert.deepEqual(inspect().manifest.linkedStylesheets.map((x) => x.path),
      ["src/site.css"], "valid rel must still bind CSS despite data.rel");
    writeFileSync(html,
      '<link rel="stylesheet" rel="alternate" href="site.css">');
    assert.throws(inspect, /Duplicate HTML link attribute cannot be attested/,
      "ambiguous duplicate rel attributes must never be treated as a safe proof");
  });
});

test("ambiguous HTML link separators cannot bypass linked CSS provenance", () => {
  fixture(({ root, src }) => {
    const html = join(src, "page.html");
    const css = join(src, "site.css");
    writeFileSync(css, "h1 { color: red; }\n");
    const inspect = (includeDetectorContext) => sourceScopeProof({
      projectRoot: root, target: html, route: "/page", includeDetectorContext,
    });
    for (const markup of [
      '<link rel="stylesheet"href="site.css">',
      '<link/rel=stylesheet href=site.css>',
    ]) {
      writeFileSync(html, markup);
      assert.throws(() => inspect(true),
        /Ambiguous HTML link attributes cannot be attested/, markup);
      writeFileSync(css, "h1 { color: blue; }\n");
      assert.throws(() => inspect(true),
        /Ambiguous HTML link attributes cannot be attested/,
        "CSS-only mutation must not receive an unsupported proof");
      assert.equal(inspect(false).manifest.linkedStylesheets, undefined,
        "native-only scans must not parse optional detector dependencies");
    }
    writeFileSync(html, '<link rel="stylesheet" href="site.css">');
    assert.deepEqual(inspect(true).manifest.linkedStylesheets.map((x) => x.path),
      ["src/site.css"], "ordinary links must remain supported");
  });
});

test("valueless link attributes retain CSS byte provenance and fail closed on duplicates", () => {
  fixture(({ root, src }) => {
    const html = join(src, "page.html");
    const css = join(src, "site.css");
    writeFileSync(css, "h1 { color: red; }\n");
    const inspect = () => sourceScopeProof({
      projectRoot: root, target: html, route: "/page", includeDetectorContext: true,
    });
    writeFileSync(html, '<link rel="stylesheet" crossorigin disabled href="site.css">');
    const initial = inspect();
    assert.deepEqual(initial.manifest.linkedStylesheets.map((x) => x.path),
      ["src/site.css"]);
    writeFileSync(css, "h1 { color: blue; }\n");
    assert.notEqual(inspect().summary.sourceSha256, initial.summary.sourceSha256);
    writeFileSync(html, '<link rel="icon" crossorigin disabled href="site.css">');
    assert.equal((inspect().manifest.linkedStylesheets ?? []).length, 0,
      "Non-stylesheet links with boolean attributes must not import CSS");
    writeFileSync(html, '<link rel="stylesheet" crossorigin crossorigin href="site.css">');
    assert.throws(inspect, /Duplicate HTML link attribute cannot be attested/);
    writeFileSync(html, '<link rel="stylesheet"crossorigin href="site.css">');
    assert.throws(inspect, /Ambiguous HTML link attributes cannot be attested/);
  });
});

test("parser-dependent HTML regions fail closed on ambiguous stylesheet links", () => {
  fixture(({ root, src }) => {
    const html = join(src, "page.html");
    const css = join(src, "site.css");
    writeFileSync(css, "h1 { color: red; }\n");
    const inspect = (includeDetectorContext = true) => sourceScopeProof({
      projectRoot: root, target: html, route: "/page", includeDetectorContext,
    });
    for (const markup of [
      '<iframe><link rel="stylesheet" href="site.css"></iframe>',
      '<noembed><link rel="stylesheet" href="site.css"></noembed>',
      '<noframes><link rel="stylesheet" href="site.css"></noframes>',
      '<plaintext><link rel="stylesheet" href="site.css">',
      '<iframe><link rel="stylesheet" href="site.css">',
    ]) {
      writeFileSync(html, markup);
      assert.throws(inspect, /Parser-dependent HTML link region cannot be attested/,
        "potential parser reads must be rejected: " + markup);
      writeFileSync(css, "h1 { color: blue; }\n");
      assert.throws(inspect, /Parser-dependent HTML link region cannot be attested/,
        "a CSS-only mutation cannot establish source completeness");
      assert.equal(inspect(false).manifest.linkedStylesheets, undefined,
        "quick native-only mode skips optional detector dependencies");
    }
    for (const markup of [
      '<iframe><link-button rel="stylesheet" href="site.css"></link-button></iframe>',
      '<script>const example = "<link rel=stylesheet href=site.css>";</script>',
      '<textarea><link rel="stylesheet" href="site.css"></textarea>',
      '<!-- <link rel="stylesheet" href="site.css"> -->',
    ]) {
      writeFileSync(html, markup);
      assert.deepEqual(inspect().manifest.linkedStylesheets ?? [], [],
        "lookalikes and genuinely inert examples remain supported");
    }
    writeFileSync(html, '<link rel="stylesheet" href="site.css">');
    assert.deepEqual(inspect().manifest.linkedStylesheets.map((item) => item.path),
      ["src/site.css"], "normal stylesheet links must remain attested");
  });
});

test("symlinked linked CSS and escaping local stylesheet reads cannot be attested", () => {
  fixture(({ root, src }) => {
    const html = join(src, "page.html");
    const css = join(src, "site.css");
    const external = mkdtempSync(join(tmpdir(), "dwa-external-css-"));
    try {
      const outside = join(external, "other.css");
      writeFileSync(outside, "body { color: purple; }\n");
      writeFileSync(html, '<link rel="stylesheet" href="site.css">');
      symlinkSync(outside, css);
      const inspect = () => sourceScopeProof({
        projectRoot: root, target: html, route: "/page", includeDetectorContext: true,
      });
      assert.throws(inspect, /Linked stylesheet must be a regular in-project file/);
      rmSync(css);
      writeFileSync(html, '<link rel="stylesheet" href="' + outside + '">');
      assert.throws(inspect, /Linked stylesheet escapes declared project scope/);
    } finally {
      rmSync(external, { recursive: true, force: true });
    }
  });
});

test("nested design documents stay isolated across source directories", () => {
  fixture(({ root, src, inspect }) => {
    writeFileSync(join(root, "DESIGN.md"), "---\ncolors:\n  ink: '#111111'\n---\n");
    const child = join(src, "component");
    mkdirSync(child);
    writeFileSync(join(child, "DESIGN.md"), "---\ncolors:\n  ink: '#999999'\n---\n");
    writeFileSync(join(child, "child.css"), "h1 { color: #111; }\n");
    const snapshot = inspect(src);
    assert.deepEqual(snapshot.manifest.detectorContext.map((x) => x.path),
      ["DESIGN.md"]);
    // A DESIGN.md inside the selected source directory is already present
    // in the regular source manifest; never duplicate it in detectorContext.
    assert.ok(snapshot.manifest.files.some((x) =>
      x.path === "src/component/DESIGN.md"));
    assert.equal(snapshot.summary.fileCount, 3);
    const before = snapshot.summary.sourceSha256;
    writeFileSync(join(child, "DESIGN.md"), "---\ncolors:\n  ink: '#444444'\n---\n");
    assert.notEqual(inspect(src).summary.sourceSha256, before);
  });
});

test("nested independent project boundary does not inherit outer DESIGN.md", () => {
  fixture(({ root, src, inspect }) => {
    writeFileSync(join(root, "DESIGN.md"), "---\ncolors:\n  ink: '#111111'\n---\n");
    const child = join(src, "private-project");
    mkdirSync(child);
    writeFileSync(join(child, "package.json"), "{}\n");
    const file = join(child, "style.css");
    writeFileSync(file, "h1 { font-size: 12px; }\n");
    const nested = inspect(file);
    assert.equal(nested.manifest.detectorContext, undefined);
    const outer = inspect();
    assert.equal(outer.manifest.detectorContext[0].path, "DESIGN.md");
  });
});

test("a symlinked policy dependency cannot be treated as an in-project proof", () => {
  fixture(({ root, inspect }) => {
    const outside = mkdtempSync(join(tmpdir(), "dwa-context-external-"));
    try {
      const design = join(outside, "DESIGN.md");
      writeFileSync(design, "---\ncolors:\n  ink: '#111111'\n---\n");
      symlinkSync(design, join(root, "DESIGN.md"));
      assert.throws(() => inspect(),
        /Detector context dependency must be a regular in-project file/);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
