import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import {
  mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { walkDir } from "../../../impeccable/scripts/detector/node/file-system.mjs";

const detector = fileURLToPath(new URL(
  "../../../impeccable/scripts/detect.mjs", import.meta.url));

function fixture(fn) {
  const root = mkdtempSync(join(tmpdir(), "dwa-impeccable-walk-"));
  const nested = join(root, "nested");
  mkdirSync(nested);
  writeFileSync(join(root, "good.css"), "h1 { color: blue; }\n");
  writeFileSync(join(nested, "invisible.css"), "h2 { color: red; }\n");
  try { return fn({ root, nested }); }
  finally { rmSync(root, { recursive: true, force: true }); }
}

test("strict source traversal fails when a nested directory cannot be read", () => {
  fixture(({ root, nested }) => {
    const original = fs.readdirSync;
    try {
      fs.readdirSync = (path, ...args) => {
        if (path === nested) {
          const error = new Error("Simulated permission denied");
          error.code = "EACCES";
          throw error;
        }
        return original(path, ...args);
      };
      const permissive = walkDir(root);
      assert.deepEqual(permissive, [join(root, "good.css")]);
      assert.throws(() => walkDir(root, { strict: true }),
        /source traversal failed/);
    } finally {
      fs.readdirSync = original;
    }
  });
});

test("strict source traversal rejects a hidden symlink subtree rather than omitting it", () => {
  fixture(({ root }) => {
    const outside = mkdtempSync(join(tmpdir(), "dwa-impeccable-outside-"));
    try {
      symlinkSync(outside, join(root, "linked"), "dir");
      assert.throws(() => walkDir(root, { strict: true }),
        /source traversal encountered a symlink/);
      const permissive = walkDir(root);
      assert.ok(permissive.some((path) => path.endsWith("good.css")));
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

test("real CLI never emits a completed-file receipt for an unsafe source tree", () => {
  fixture(({ root }) => {
    const outside = mkdtempSync(join(tmpdir(), "dwa-impeccable-linked-"));
    try {
      symlinkSync(outside, join(root, "external"), "dir");
      const run = spawnSync(process.execPath,
        [detector, "--json", "--dwa-scan-proof", root],
        { cwd: root, encoding: "utf8", timeout: 20_000 });
      assert.notEqual(run.status, 0);
      assert.doesNotMatch(run.stderr, /DWA_IMPECCABLE_SCAN_PROOF=/);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
