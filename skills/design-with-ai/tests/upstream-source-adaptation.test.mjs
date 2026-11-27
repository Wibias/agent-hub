import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');

test('explicit WCAG audit does not inherit limited DWA probe as a conformance certification', () => {
  const audit = read('../references/audit-surface-evidence.md');
  const probe = read('../scripts/render-surface-a11y-gate.mjs');
  assert.match(audit, /WCAG 2\.2 AA certification/);
  assert.match(audit, /exact route\(s\)/);
  assert.match(audit, /criterion.*applicability|applicability.*criterion/is);
  assert.match(audit, /not.*WCAG 2\.2 AA compliant/is);
  assert.match(probe, /PASS_SURFACE_A11Y_LIMITED/);
  assert.match(probe, /Measurements and attribute observations are review leads/);
});

test('an unavailable axe or pa11y runner is not recorded as a clean audit', () => {
  const audit = read('../references/audit-surface-evidence.md');
  assert.match(audit, /axe-core or pa11y/);
  for (const token of ['exit code', 'malformed/missing report', 'NOT_VERIFIED', 'nonzero tool exit']) {
    assert.ok(audit.includes(token), 'missing fail-closed evidence term ' + token);
  }
  assert.match(audit, /Do not execute .npx --yes./);
  assert.match(audit, /without explicit authorization/);
  assert.match(audit, /redacting[\s\S]{0,180}authenticated page content/);
});

test('manual keyboard and screen-reader evidence cannot be replaced by ARIA snapshots', () => {
  const audit = read('../references/audit-surface-evidence.md');
  assert.match(audit, /NVDA on Windows or VoiceOver on/);
  assert.match(audit, /DOM\/ARIA snapshot or keyboard[\s\S]{0,70}not/);
  for (const token of ['Shift+Tab', 'Home/End', '200% zoom', 'forced colors', 'reduced-motion']) {
    assert.ok(audit.includes(token), 'missing manual state ' + token);
  }
  assert.match(audit, /untested interaction is .NOT_MEASURED./);
});

test('Penpot MCP 2.19 source review preserves session/host/code/rollback boundaries', () => {
  const penpot = read('../references/penpot-integration.md');
  for (const token of [
    '2.17.0', '2.19.1', 'major.minor',
    '28f63af16e14ae26c51c2e18225180de432af1fb',
    'e20a0d748eb9ae431c27a4a201ee9f7067d955e8',
    'PENPOT_MCP_ALLOWED_HOSTS', 'rollback', 'read-back',
  ]) {
    assert.ok(penpot.includes(token), 'missing Penpot provenance/boundary ' + token);
  }
  assert.match(penpot, /different session|another session/);
  assert.match(penpot, /plugin bridge can execute code/);
  assert.match(penpot, /Do not recommend wildcards/);
  assert.match(penpot, /not proof of the version installed/);
  assert.match(penpot, /does \*\*not\*\* vendor[\s\S]{0,100}enable any new tool/i);
});

test('Nextlevel IME/RTL guidance protects composition without claiming native runtime proof', () => {
  const controls = read('../references/states-interaction.md');
  for (const token of [
    'event.isComposing', 'keyCode===229', 'compositionstart',
    'compositionend', 'Japanese, Chinese, or Korean IME',
    'Shift+Enter', 'NOT_VERIFIED', 'margin-inline-start',
    'padding-inline', 'inset-inline-end', 'dir="auto"',
    'Arabic/Hebrew', 'NOT_MEASURED',
    '72e5fc76a4f3eb37747dc472cb3091bd46e7752a',
  ]) {
    assert.ok(controls.includes(token), 'missing locale interaction evidence: ' + token);
  }
  assert.match(controls, /must[\s\S]{0,30}not submit while/);
  assert.match(controls, /A separate, real Enter after confirmed composition may submit once/);
  assert.match(controls, /Do not mirror entire interfaces/);
  assert.match(controls, /No upstream search engine/);
});

test('Matt irrelevant seven-commit upstream delta is reviewed but not adopted', () => {
  const registry = JSON.parse(read('../../../upstream-sources.json'));
  const matt = registry.sources.find((source) => source.id === 'matt');
  assert.equal(matt.reviewedCommit, '6f7f7831a625f040a8e06a0e7954826b87ce775a');
  assert.equal(matt.reviewedAt, '2026-11-27');
  assert.equal(matt.decision, 'not-applicable');
});
