import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (part) => readFileSync(path.join(root, part), 'utf8');

test('DWA remains the sole command owner for new Impeccable integration', () => {
  const skill = read('SKILL.md');
  const routes = read('references/impeccable-routes.md');
  assert.match(skill, /^name: design-with-ai$/m);
  assert.match(skill, /impeccable <verb>/);
  assert.match(skill, /internal\/impeccable/);
  assert.doesNotMatch(skill, /Explicit Impeccable requests stay with Impeccable/);
  assert.match(routes, /no second design-skill/);
  assert.match(routes, /not a separate/);
  assert.match(routes, /NOT_VERIFIED/);
  assert.equal(existsSync(path.join(root, 'internal/impeccable/SKILL.md')), false,
    'never introduce nested discoverable Impeccable SKILL.md');
});

test('important optional Impeccable implementation assets move as one internal tree', () => {
  for (const file of [
    'internal/impeccable/UPSTREAM.md',
    'internal/impeccable/reference/live.md',
    'internal/impeccable/reference/hooks.md',
    'internal/impeccable/reference/critique.md',
    'internal/impeccable/scripts/impeccable',
    'internal/impeccable/scripts/impeccable.cmd',
    'internal/impeccable/scripts/VERSION',
    'internal/impeccable/scripts/engine-checksums.txt',
    'internal/impeccable/scripts/live-server.mjs',
    'internal/impeccable/scripts/hook-admin.mjs',
    'internal/impeccable/scripts/detect.mjs',
  ]) assert.ok(statSync(path.join(root, file)).isFile(), file);
});

test('static source detector uses bundled DWA-local JS and never invokes the engine', () => {
  const provider = read('scripts/providers/impeccable.mjs');
  assert.match(provider, /internal\/impeccable\/scripts\/detect\.mjs/);
  assert.doesNotMatch(provider, /spawn.*impeccable\.cmd|spawn.*scripts\/impeccable/);
  assert.match(read('references/impeccable-routes.md'), /no engine launch/i);
});

test('hook management accepts legacy installations and writes current DWA paths', () => {
  const hooks = read('internal/impeccable/scripts/hook-admin.mjs');
  assert.match(hooks, /skills\/design-with-ai\/internal\/impeccable\/scripts\/hook\.mjs/);
  assert.match(hooks, /skills\/impeccable\/scripts\/hook\.mjs/);
  assert.match(hooks, /Legacy installations are recognized/);
  const context = read('internal/impeccable/scripts/context.mjs');
  assert.match(context, /skills\/design-with-ai\/internal\/impeccable\/scripts\/hook\.mjs/);
  assert.match(context, /skills\/impeccable\/scripts\/hook\.mjs/);
});

test('internal helper text points explicit command users to the canonical owner', () => {
  const provider = read('internal/impeccable/scripts/lib/provider.mjs');
  assert.match(provider, /design-with-ai impeccable/);
  assert.doesNotMatch(provider, /`\$\{IMPECCABLE_COMMAND_PREFIX\}impeccable`/);
});
