import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../scripts/audit-surface-probe.js", import.meta.url), "utf8");

test("probe exports a pathname-only route and bounded, redacted visible text", () => {
  assert.match(source, /route: location\.pathname/);
  assert.doesNotMatch(source, /location\.href/);
  assert.match(source, /MAX_VISIBLE_TEXT = 2000/);
  assert.match(source, /\[REDACTED\]/);
  assert.match(source, /visibleTextMeta/);
  assert.match(source, /privacy:/);
});
