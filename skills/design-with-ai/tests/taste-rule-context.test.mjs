import assert from "node:assert/strict";
import test from "node:test";
import { contextualRuleMatches, sourceRuleContexts } from "../scripts/taste-rule-context.mjs";

const match = (id, lines, path = "test.css", at = lines.length) =>
  contextualRuleMatches({ id, hardGate: false }, sourceRuleContexts(lines, path)[at - 1]);

test("G29 skips comments, numeric ranges and missing-value placeholders but retains visible copy", () => {
  assert.equal(match("G29", ["// An — explanation"], "test.tsx"), false);
  assert.equal(match("G29", ["/* comment", " — still comment */"], "test.css"), false);
  assert.equal(match("G29", ["const values = '100–500';"], "test.tsx"), false);
  assert.equal(match("G29", ["const fallback = '—';"], "test.tsx"), false);
  assert.equal(match("G29", ["<span>Speed — important</span>"], "test.tsx"), true);
  assert.equal(match("G29", ['content: "Loading — done";'], "test.css"), true);
});

test("G27 excludes functional join-code inputs including multiline JSX", () => {
  assert.equal(match("G27", ['<input className="uppercase tracking-widest" />'], "test.tsx"), false);
  assert.equal(match("G27", ['<input', '  className="uppercase tracking-widest"'], "test.tsx"), false);
  assert.equal(match("G27", ['<span className="uppercase tracking-widest">01 • STEP</span>'], "test.tsx"), true);
});

test("G27 respects JSX arrow handlers, quoted > and comparisons inside controls", () => {
  const jsx = [
    "const field = (",
    "  <input",
    "    onChange={(event) => setCode(event.target.value)}",
    '    title="Use > to compare"',
    '    value={score > 0 ? "yes" : "no"}',
    '    className="uppercase tracking-widest"',
    "  />",
    ");",
  ];
  assert.equal(match("G27", jsx, "test.tsx", 6), false);
  assert.equal(match("G27", [
    "<textarea",
    "  onChange={(event) => update(event.target.value)}",
    '  className="uppercase tracking-widest"',
  ], "test.tsx"), false);
  assert.equal(match("G27", [
    '<input onChange={(e) => update(e.target.value)} className="uppercase tracking-widest" />',
    '<span className="uppercase tracking-widest">ROUND</span>',
  ], "test.tsx", 2), true);
  assert.equal(match("G27", [
    '<input onChange={(e) => update(e.target.value)} /><span className="uppercase tracking-widest">ROUND</span>',
  ], "test.tsx"), true);
});

test("G27 keeps quoted and braced attribute state across source lines", () => {
  const quoted = [
    '<input title="Before',
    '// > still a literal value',
    '" className="uppercase tracking-widest" />',
  ];
  const braced = [
    "<input value={score >",
    '  1 ? "yes" : "no"} className="uppercase tracking-widest" />',
  ];
  for (const lines of [quoted, braced]) {
    assert.equal(match("G27", lines, "test.tsx"), false);
    assert.equal(match("G27", [
      ...lines,
      '<span className="uppercase tracking-widest">REAL LABEL</span>',
    ], "test.tsx"), true);
  }
});

test("G27 does not lose siblings after nested templates, JSX quotes, comments, or regex", () => {
  const tick = String.fromCharCode(96);
  const examples = [
    ['<input title={' + tick + "outer $" + "{" + tick + "{" + tick + "}" + tick + '} />'],
    ['<input title="end\\\" />'],
    [
      "<input onChange={(event) => { // don't close it",
      "  update(event);",
      "}} />",
    ],
    ['<input pattern={/[{]/.source} />'],
    ['<input value={amount / 3} />'],
  ];
  for (const lines of examples) {
    assert.equal(match("G27", lines, "test.tsx"), false);
    assert.equal(match("G27", [
      ...lines.slice(0, -1),
      lines.at(-1) + '<span className="uppercase tracking-widest">REAL LABEL</span>',
    ], "test.tsx"), true);
  }
});

test("G32 requires hover rather than keyframe scaling", () => {
  assert.equal(match("G32", ["@keyframes pulse {", "  50% { transform: scale(1.05); }"]), false);
  assert.equal(match("G32", [".button:hover {", "  transform: scale(1.05);"]), true);
  assert.equal(match("G32", ['<button className="hover:scale-105">Go</button>'], "test.tsx"), true);
});

test("G34 preserves entrance leads but skips ambient or toy motion", () => {
  assert.equal(match("G34", [".ambient {", " animation: float 2s ease-in-out infinite;"]), false);
  assert.equal(match("G34", [".toy {", " animation: bounce 1s ease-in-out;"]), false);
  assert.equal(match("G34", [".page-enter {", " animation: fade-in 240ms ease-in-out both;"]), true);
  assert.equal(match("G34", ["@keyframes reveal {", "  50% { animation-timing-function: ease-in-out; }"]), false);
  assert.equal(match("G34", ['<section className="animate-in ease-in-out">Welcome</section>'], "test.tsx"), true);
});

test("context filters never suppress hard gates", () => {
  const context = sourceRuleContexts(["// transition-all"], "test.tsx")[0];
  assert.equal(contextualRuleMatches({ id: "G29", hardGate: true }, context), true);
});

test("visible JSX slashes cannot hide following UI copy", () => {
  assert.equal(match("G29", ["<span>See // — next</span>"], "test.tsx"), true);
});

test("CSS selector split before brace retains hover context", () => {
  assert.equal(match("G32", [".button:hover", "{", "transform: scale(1.05);", "}"], "test.css", 3), true);
});

test("CSS control selector remains functional across separate declaration line", () => {
  assert.equal(match("G27", [".join-code input {", "@apply uppercase tracking-widest;", "}"], "test.css", 2), false);
});

test("a literal brace within CSS content cannot close a hover rule", () => {
  assert.equal(match("G32", [".button:hover {", 'content: "}";', "transform: scale(1.05);"]), true);
});

test("multiline template literals preserve source comment markers as text", () => {
  assert.equal(match("G29", ["const label = \x60Hello", "/* not a comment — UI */", "world\x60;"], "test.tsx", 2), true);
});

test("G27 does not hide a visible sibling kicker beside a functional input", () => {
  const jsx = '<input className="uppercase tracking-widest" /><span className="uppercase tracking-widest">ROUND</span>';
  assert.equal(match("G27", [jsx], "test.tsx"), true);
});

test("G32 does not attribute a static scale to a closed sibling hover block", () => {
  const css = '.button:hover { opacity: 1; } .static { transform: scale(1.05); }';
  assert.equal(match("G32", [css], "test.css"), false);
});

test("G34 does not leak keyframe context into a later entrance block", () => {
  const css = '@keyframes reveal { 50% { opacity: 1; } } .page-enter { animation: fade-in 200ms ease-in-out; }';
  assert.equal(match("G34", [css], "test.css"), true);
});

test("G34 treats separate infinite animation declarations as ambient rather than entry motion", () => {
  const css = [".reveal {", "animation: reveal 2s infinite;", "animation-timing-function: ease-in-out;", "}"];
  assert.equal(match("G34", css, "test.css", 3), false);
});

test("G29 does not classify an empty table dash as UI prose", () => {
  assert.equal(match("G29", ["<td>—</td>"], "test.tsx"), false);
});

test("G32 retains CSS hover evidence inside an embedded style block", () => {
  const html = ["<style>", ".button:hover {", "transform: scale(1.05);", "}", "</style>"];
  assert.equal(match("G32", html, "test.html", 3), true);
});
