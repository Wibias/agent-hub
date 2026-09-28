import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const analyzer = resolve(here, "../scripts/taste-gate.mjs");
const registryPath = resolve(here, "../references/slop-signals.json");
const casesPath = resolve(here, "source-calibration-cases.jsonl");

function readCases() {
  return readFileSync(casesPath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try { return JSON.parse(line); }
      catch (error) { throw new Error(`${casesPath}:${index + 1}: ${error.message}`); }
    });
}

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), "source-calibration-"));
  for (const [relative, content] of Object.entries(files ?? {})) {
    const absolute = join(root, relative);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content, "utf8");
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function run(files) {
  const fx = fixture(files);
  try {
    const result = spawnSync(process.execPath, [analyzer, "--path", fx.root, "--json"], { encoding: "utf8" });
    let parsed;
    try { parsed = JSON.parse(result.stdout); }
    catch { throw new Error(`Invalid JSON from taste gate. stdout=${result.stdout}\nstderr=${result.stderr}`); }
    return { ...result, parsed };
  } finally {
    fx.cleanup();
  }
}

test("source calibration matrix covers every source rule entry and every source rule ID boundary", () => {
  const registry = JSON.parse(readFileSync(registryPath, "utf8"));
  const cases = readCases();
  const positiveNames = new Set(cases.flatMap((row) => row.expect_names ?? []));
  const negativeIds = new Set(cases.flatMap((row) => row.forbid_ids ?? []));
  const sourceRules = [...(registry.rules ?? []), ...(registry.derivedRules ?? [])];

  for (const rule of sourceRules) {
    assert.ok(positiveNames.has(rule.name), `source calibration missing positive coverage for ${rule.id}/${rule.name}`);
  }
  for (const id of new Set(sourceRules.map((rule) => rule.id))) {
    assert.ok(negativeIds.has(id), `source calibration missing boundary-negative coverage for ${id}`);
  }
});

for (const row of readCases()) {
  test(`${row.id} ${row.description}`, () => {
    const result = run(row.files);
    assert.equal(result.status, row.expected_status ?? 0, result.stderr);

    const hitNames = new Set(result.parsed.hits.map((hit) => hit.name));
    const hitIds = new Set(result.parsed.hits.map((hit) => hit.id));
    for (const name of row.expect_names ?? []) {
      assert.ok(hitNames.has(name), `${row.id} expected rule name ${name}; got ${[...hitNames].join(", ") || "none"}`);
    }
    for (const id of row.forbid_ids ?? []) {
      assert.ok(!hitIds.has(id), `${row.id} must not produce ${id}; got ${[...hitIds].join(", ")}`);
    }
  });
}

test("source calibration fixture IDs are unique and stable", () => {
  const cases = readCases();
  const ids = cases.map((row) => row.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^SC\d{2,}$/);
});
