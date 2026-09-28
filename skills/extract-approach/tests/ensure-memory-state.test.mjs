import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureMemoryState } from "../scripts/ensure-memory-state.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "extract-approach-"));
  mkdirSync(join(root, "memory"), { recursive: true });
  writeFileSync(join(root, "memory", "MEMORY.example.md"), "# Memory Registry\n\n## Registry\n", "utf8");
  writeFileSync(join(root, "memory", "pending-rules.example.md"), "# Pending Rules\n", "utf8");
  return root;
}

test("initializes missing local state from public examples", () => {
  const root = fixture();
  const result = ensureMemoryState({ hubRoot: root });
  assert.equal(result.createdRegistry, true);
  assert.equal(result.createdPendingRules, true);
  assert.equal(readFileSync(join(root, "memory", "MEMORY.md"), "utf8"), "# Memory Registry\n\n## Registry\n");
  assert.equal(readFileSync(join(root, "memory", "pending-rules.md"), "utf8"), "# Pending Rules\n");
  assert.equal(existsSync(join(root, "memory", "notes")), true);
});

test("preserves existing local state", () => {
  const root = fixture();
  writeFileSync(join(root, "memory", "MEMORY.md"), "existing registry\n", "utf8");
  writeFileSync(join(root, "memory", "pending-rules.md"), "existing pending\n", "utf8");
  const result = ensureMemoryState({ hubRoot: root });
  assert.equal(result.createdRegistry, false);
  assert.equal(result.createdPendingRules, false);
  assert.equal(readFileSync(join(root, "memory", "MEMORY.md"), "utf8"), "existing registry\n");
  assert.equal(readFileSync(join(root, "memory", "pending-rules.md"), "utf8"), "existing pending\n");
});

test("falls back to minimal local files when examples are absent", () => {
  const root = mkdtempSync(join(tmpdir(), "extract-approach-"));
  const result = ensureMemoryState({ hubRoot: root });
  assert.equal(result.createdRegistry, true);
  assert.match(readFileSync(join(root, "memory", "MEMORY.md"), "utf8"), /Memory Registry/);
  assert.match(readFileSync(join(root, "memory", "pending-rules.md"), "utf8"), /Pending Rules/);
});
