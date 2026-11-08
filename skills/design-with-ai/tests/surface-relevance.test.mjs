import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { classifySurfaceFindings } from "../scripts/surface-relevance.mjs";

function project() {
  const root = mkdtempSync(join(tmpdir(), "dwa-surface-relevance-"));
  const write = (path, content) => {
    const absolute = join(root, path);
    mkdirSync(join(absolute, ".."), { recursive: true });
    writeFileSync(absolute, content);
  };
  write("src/App.tsx", [
    'import { Route, Routes } from "react-router";',
    'const SettingsPage = lazy(() => import("./pages/SettingsPage"));',
    'export function App() {',
    '  return <Routes><Route path="/settings/*" element={<SettingsPage />} /></Routes>;',
    '}',
  ].join("\n"));
  write("src/pages/SettingsPage.tsx", [
    'import { SettingsTabs } from "./SettingsTabs";',
    'import "./SettingsPage.css";',
    'export function SettingsPage() {',
    '  return <div role="tablist"><button role="tab" aria-selected="true">Interface</button><SettingsTabs /></div>;',
    '}',
  ].join("\n"));
  write("src/pages/SettingsTabs.tsx", [
    'export function SettingsTabs() {',
    '  return <label><input type="checkbox" /> Seamless setup</label>;',
    '}',
  ].join("\n"));
  write("src/pages/SettingsPage.css", [
    ".tab { background: transparent; }",
    ".tab:hover { background: rgba(255,255,255,.06); }",
  ].join("\n"));
  write("src/pages/AboutPage.tsx", 'export const copy = "Welcome — start here";\n');
  write("src/components/UpdateDialog.tsx", 'export const copy = "Update failed — retry";\n');
  write("src/lib/settings/tabs.ts", 'export const tabs = ["interface"];\n');
  return root;
}

test("route closure separates direct, shared, contextual and unbound findings", () => {
  const root = project();
  try {
    const result = classifySurfaceFindings({
      projectRoot: root,
      target: join(root, "src"),
      route: "/settings/interface",
      visibleText: "Interface Theme Close to tray",
      findings: [
        {
          id: "about-copy", category: "copy-convention", priority: "P1",
          message: "Visible em/en dash", providerRuleId: "G29",
          location: { route: "/settings/interface", file: "src/pages/AboutPage.tsx", line: 1 },
          evidence: [{ kind: "source", ref: "src/pages/AboutPage.tsx:1", snippet: 'Welcome — start here' }],
        },
        {
          id: "shared-copy", category: "copy-generic", priority: "P1",
          message: "Possible generic marketing copy", providerRuleId: "G41",
          location: { route: "/settings/interface", file: "src/pages/SettingsTabs.tsx", line: 2 },
          evidence: [{ kind: "source", ref: "src/pages/SettingsTabs.tsx:2", snippet: '"Seamless setup"' }],
        },
        {
          id: "direct-a11y", category: "accessibility", priority: "P2",
          message: "Control boundary needs review", providerRuleId: "A11Y",
          location: { route: "/settings/interface", file: "src/pages/SettingsTabs.tsx", line: 2 },
          evidence: [{ kind: "source", ref: "src/pages/SettingsTabs.tsx:2", snippet: '<input type="checkbox" />' }],
        },
        {
          id: "outside", category: "copy-generic", priority: "P1",
          message: "Possible generic marketing copy", providerRuleId: "G41",
          location: { route: "/settings/interface", file: "src/not-in-scope.tsx", line: 1 },
          evidence: [{ kind: "source", ref: "src/not-in-scope.tsx:1", snippet: '"Unleash"' }],
        },
      ],
    });

    assert.equal(result.binding.routeBinding, "static-route-closure");
    assert.ok(result.binding.anchors.some((entry) => entry.file === "src/App.tsx"));
    assert.equal(result.counts.routeRelevant, 1);
    assert.equal(result.counts.contextOnly, 2);
    assert.equal(result.counts.unbound, 1);
    const byId = Object.fromEntries(result.findings.map((finding) => [finding.id, finding.surface]));
    assert.equal(byId["about-copy"].relevance, "CONTEXT");
    assert.equal(byId["about-copy"].surfacePriority, "P3");
    assert.equal(byId["shared-copy"].relation, "direct");
    assert.equal(byId["shared-copy"].visibility, "not-visible");
    assert.equal(byId["shared-copy"].relevance, "CONTEXT");
    assert.equal(byId["shared-copy"].surfacePriority, "P3");
    assert.equal(byId["direct-a11y"].relevance, "ROUTE");
    assert.equal(byId["outside"].relevance, "UNBOUND");
    assert.ok(result.plan.requiredChecks.some((check) => check.id === "control-boundary-contrast"));
    assert.ok(result.plan.requiredChecks.some((check) => check.id === "tablist-keyboard-aria"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("visible copy stays on-surface and is capped at P2", () => {
  const root = project();
  try {
    const result = classifySurfaceFindings({
      projectRoot: root,
      target: join(root, "src"),
      route: "/settings/interface",
      visibleText: "Interface Seamless setup Close to tray",
      findings: [{
        id: "visible-copy", category: "copy-generic", priority: "P1",
        message: "Possible generic marketing copy", providerRuleId: "G41",
        location: { route: "/settings/interface", file: "src/pages/SettingsTabs.tsx", line: 2 },
        evidence: [{ kind: "source", ref: "src/pages/SettingsTabs.tsx:2", snippet: '"Seamless setup"' }],
      }],
    });
    assert.equal(result.findings[0].surface.visibility, "visible");
    assert.equal(result.findings[0].surface.relevance, "ROUTE");
    assert.equal(result.findings[0].surface.surfacePriority, "P2");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("no route anchor falls back honestly instead of claiming closure", () => {
  const root = mkdtempSync(join(tmpdir(), "dwa-surface-fallback-"));
  try {
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src", "Widget.tsx"), "export const Widget = () => <button>Save</button>;\n");
    const result = classifySurfaceFindings({
      projectRoot: root,
      target: join(root, "src"),
      route: "/not-present",
      findings: [{
        id: "widget", category: "copy-generic", priority: "P1",
        message: "Possible generic copy", providerRuleId: "G41",
        location: { route: "/not-present", file: "src/Widget.tsx", line: 1 },
        evidence: [{ kind: "source", ref: "src/Widget.tsx:1", snippet: 'Save' }],
      }],
    });
    assert.equal(result.binding.routeBinding, "declared-source-route");
    assert.equal(result.findings[0].surface.confidence, "fallback");
    assert.equal(result.findings[0].surface.surfacePriority, "P3");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
