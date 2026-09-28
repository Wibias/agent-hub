import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { convertJson3, flattenJson3 } from "../scripts/json3-to-text.mjs";

test("flattens json3 caption segments without rolling-caption duplication logic", () => {
  const text = flattenJson3({
    events: [
      { segs: [{ utf8: "Hello " }, { utf8: "world" }] },
      { segs: [{ utf8: "\nNext   line" }] },
    ],
  });
  assert.equal(text, "Hello world Next line");
});

test("writes a txt sibling by default", () => {
  const dir = mkdtempSync(join(tmpdir(), "youtube-transcript-"));
  const input = join(dir, "captions.json3");
  writeFileSync(input, JSON.stringify({ events: [{ segs: [{ utf8: "A transcript" }] }] }), "utf8");
  const result = convertJson3(input);
  assert.equal(readFileSync(result.output, "utf8"), "A transcript");
  assert.match(result.output, /captions\.txt$/);
});
