import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const app = readFileSync(new URL('../../memory-ui/app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../memory-ui/styles.css', import.meta.url), 'utf8');

function helper(name, end, context = {}) {
  const start = app.indexOf('function ' + name + '(');
  const stop = app.indexOf(end, start);
  assert.ok(start >= 0 && stop > start, name + ' exists');
  return vm.runInNewContext(app.slice(start, stop) + '\n' + name, context);
}

const summary = helper('graphVerificationSummary', '\nfunction graphRelationOriginLabel(');
const authority = helper('graphAuthorityLabel', '\n/** Git verification');
const help = helper('graphFreshnessHelp', '\n/** Summarize all scoped');
const node = (status) => ({ freshness: { status }, value: 'PRIVATE_VALUE' });
const graph = (status, nodes) => ({ gitContext: { status }, nodes });

test('D12 status overview never invents repository verification', () => {
  const none = summary(graph('verified', [node('not_repository')]));
  assert.equal(none.tone, 'neutral');
  assert.match(none.title, /No repository-backed memories/);
  assert.equal(none.count, '0 Git-linked');

  const ok = summary(graph('verified', [node('fresh'), node('not_repository')]));
  assert.equal(ok.tone, 'verified');
  assert.equal(ok.count, '1 / 1 verified');

  const unavailable = summary(graph('unbound', [node('unchecked')]));
  assert.equal(unavailable.tone, 'caution');
  assert.match(unavailable.message, /must not be treated as fresh/);
  assert.doesNotMatch(JSON.stringify(unavailable), /PRIVATE_VALUE/);
});

test('D12 stale and unchecked nodes are not presented as fresh', () => {
  for (const [kind, expected] of [['stale', /review/], ['unchecked', /unchecked/]]) {
    const result = summary(graph('verified', [node('fresh'), node(kind)]));
    assert.equal(result.tone, 'caution');
    assert.match(result.title, expected);
    assert.equal(result.count, '1 / 2 verified');
  }
});

test('D12 source authority is not confused with Git state', () => {
  assert.equal(authority('user_direct'), 'Direct user statement');
  assert.equal(authority('agent_inference'), 'Agent interpretation');
  assert.equal(authority('repo_trusted'), 'Repository-backed evidence');
  assert.match(help('stale'), /could not be verified/);
  assert.match(help('stale'), /may have changed/);
  assert.match(help('not_repository'), /does not apply/);
  assert.doesNotMatch(help('unchecked'), /verified against/);
});

test('D12 graph search, filters and selected node retain keyboard focus', () => {
  assert.match(app, /state\.graphSearch = search\.value;\s*renderGraph\(\);\s*restoreGraphControlFocus\('graph-search', selection\)/);
  for (const id of ['graph-origin-filter', 'graph-group-filter', 'graph-state-filter']) {
    assert.ok(app.includes("restoreGraphControlFocus('" + id + "')"));
  }
  assert.match(app, /next\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(app, /aria-pressed="\$\{node\.id === selected\?\.id/);
  assert.match(app, /button\.setAttribute\('aria-current', 'page'\)/);
  const calls = [];
  const restore = helper('restoreGraphControlFocus', '\n/** Format distinct', {
    document: { getElementById(id) {
      assert.equal(id, 'graph-search');
      return {
        focus(options) { calls.push(['focus', options.preventScroll]); },
        setSelectionRange(a, b) { calls.push(['select', a, b]); },
      };
    } },
  });
  restore('graph-search', { start: 2, end: 2 });
  assert.deepEqual(calls, [['focus', true], ['select', 2, 2]]);
});

test('D12 improves type hierarchy, responsive placement and metadata clarity', () => {
  assert.match(css, /@media \(max-width: 980px\)[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /@media \(max-width: 560px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(css.slice(css.indexOf('\/\* D12:')), /transition:\s*all/);
  assert.match(app, /Technical metadata/);
  assert.match(app, /Advisory typed · not proof/);
  assert.match(app, /Source & state/);
});
