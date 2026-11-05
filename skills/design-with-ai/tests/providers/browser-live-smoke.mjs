#!/usr/bin/env node
// Real Chrome/CDP smoke against a reviewed, pinned upstream checkout.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runQualityAudit } from "../../scripts/providers/quality-audit.mjs";

const skillRoot = process.env.TASTE_SKILL_ROOT;
if (!skillRoot) {
  process.stderr.write("TASTE_SKILL_ROOT must point to the reviewed Taste Skill 2.5.0 checkout\n");
  process.exit(2);
}
const root = mkdtempSync(join(tmpdir(), "dwa-browser-live-"));
const page = join(root, "index.html");
writeFileSync(page, [
  "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">",
  "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">",
  "<title>Account Settings - Browser Verification Fixture</title>",
  "<style>",
  ":root { color-scheme: light; font-family: Arial, sans-serif }",
  "* { box-sizing: border-box }",
  "body { margin: 0; background: #fafafa; color: #171717 }",
  "header { padding: 24px clamp(16px, 5vw, 70px); border-bottom: 1px solid #ddd }",
  "nav { display: flex; gap: 24px; flex-wrap: wrap }",
  "a { color: #165890 }",
  "main { max-width: 1040px; margin: 0 auto; padding: 28px 20px 100px }",
  "section { padding: 20px 0 52px }",
  "h1 { font-size: clamp(30px, 4vw, 46px); margin: 0 0 12px }",
  "h2 { font-size: 24px } p { max-width: 58ch; line-height: 1.55 }",
  "label { display: block; margin: 16px 0 4px }",
  "input { display: block; width: min(100%, 460px); padding: 12px; border: 1px solid #999 }",
  "button { margin-top: 20px; padding: 12px 20px; border: 0; background: #194d86; color: white }",
  "footer { padding: 28px 20px; border-top: 1px solid #ccc }",
  "</style></head><body>",
  "<header><nav aria-label=\"Primary\"><a href=\"#settings\">Settings</a>",
  "<a href=\"#activity\">Activity</a><a href=\"#help\">Help</a></nav></header>",
  "<main><section id=\"settings\"><h1>Account settings</h1>",
  "<p>Review your preferences and update your contact information.</p>",
  "<form><label for=\"email\">Email address</label>",
  "<input type=\"email\" id=\"email\" value=\"person@example.test\" autocomplete=\"email\">",
  "<label for=\"name\">Display name</label>",
  "<input id=\"name\" value=\"Test account\"><button type=\"button\">Save changes</button></form>",
  "</section><section id=\"activity\"><h2>Recent activity</h2>",
  "<p>Account updated on Monday.</p></section>",
  "<section id=\"help\"><h2>Need help?</h2>",
  "<p>Contact support from your account dashboard.</p></section>",
  "</main><footer>Browser fixture: no external assets or scripts</footer>",
  "</body></html>",
].join("\n"));

try {
  const result = await runQualityAudit([
    "--profile", "deep",
    "--path", page, "--project-root", root,
    "--route", "/settings", "--output-root", root,
    "--require-taste", "--html", page, "--taste-root", skillRoot,
    "--page-kind", "software", "--category", "Account settings",
    "--primary", "Save changes",
  ]);
  const statuses = result.coverage.statuses;
  const failures = statuses.filter((s) => !["PASS", "FINDINGS"].includes(s.status));
  if (failures.length) {
    throw new Error("Incomplete real browser/provider evidence: " +
      JSON.stringify({ failures, artifacts: result.artifacts }));
  }
  assert.deepEqual(statuses.map((s) => s.provider),
    ["impeccable", "native-dwa", "taste-skill"]);
  assert.equal(result.coverage.complete, true);
  assert.ok(["SCOPED_CLEAR", "REVIEW", "BLOCKED"].includes(result.status));
  assert.equal(result.completionEligible, false);
  process.stdout.write(JSON.stringify({
    status: result.status, coverage: statuses,
    artifactDirectory: result.artifacts.directory,
    browser: "real Chrome / upstream consistency.mjs, 1440/768/390",
    productCompletionEligible: false,
  }, null, 2) + "\n");
} finally {
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
