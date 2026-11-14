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
  assert.match(app, /focusSelectedGraphNode\(nodeId\)/);
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


test('D12 scoped evidence summary qualifies empty views when records were truncated', () => {
  const limited = summary({
    gitContext: { status: 'verified' },
    stats: { truncated: true, omittedClaims: 12 },
    nodes: [],
  });
  assert.equal(limited.tone, 'neutral');
  assert.match(limited.title, /returned graph/);
  assert.match(limited.message, /Omitted memories may include Git-linked/);
  assert.equal(limited.count, '0 Git-linked shown');
  const full = summary({ gitContext: { status: 'verified' }, stats: { truncated: false }, nodes: [] });
  assert.match(full.title, /No repository-backed memories in this scope/);
});

test('D12 relation filters keep advisory typed edges out of similarity-only results', () => {
  const graphState = {
    graphOrigin: 'all',
    graph: {
      nodes: [{ id: 'a' }, { id: 'b' }],
      edges: [
        { from: 'a', to: 'b', origin: 'explicit', source: 'canonical', relation: 'supports' },
        { from: 'a', to: 'b', origin: 'inferred', source: 'typed_relation', relation: 'depends_on' },
        { from: 'a', to: 'b', origin: 'inferred', source: 'embedding', relation: 'semantic_similarity' },
      ],
    },
  };
  const filter = helper('graphFilteredEdges', '\nfunction graphPositions(', { state: graphState });
  assert.equal(filter(graphState.graph.nodes).length, 3);
  graphState.graphOrigin = 'typed';
  assert.deepEqual(filter(graphState.graph.nodes).map(x => x.source), ['typed_relation']);
  graphState.graphOrigin = 'inferred';
  assert.deepEqual(filter(graphState.graph.nodes).map(x => x.source), ['embedding']);
  graphState.graphOrigin = 'explicit';
  assert.deepEqual(filter(graphState.graph.nodes).map(x => x.source), ['canonical']);
});

/**
 * Node-only DOM stand-in parses actual rendered SVG and inspector HTML.
 * The selection test cannot invent matching nodes when the rendered
 * markup and production query selector disagree.
 */
function mountedGraph(nodeBounds) {
  const state = {
    graphLoading: false, graphError: '', graphSearch: '',
    graphOrigin: 'all', graphGroup: 'all', graphNodeState: 'all',
    selectedGraphNodeId: 'a',
    graph: {
      nodes: [
        { id: 'a', ref: '@aaaaaaaaaa', value: 'First', state: 'active', group: 'user_direct', authority: 'user_direct', freshness: { status: 'not_repository' } },
        { id: 'b', ref: '@bbbbbbbbbb', value: 'Second', state: 'active', group: 'user_direct', authority: 'user_direct', freshness: { status: 'not_repository' } },
      ],
      edges: [{ from: 'a', to: 'b', origin: 'explicit', source: 'canonical', relation: 'supports', provenance: {} }],
      groups: [],
      stats: { nodeCount: 2, edgeCount: 1 },
      gitContext: { status: 'verified' },
    },
  };
  let focused = null;
  let scrollCalls = 0;
  const viewport = { width: 390, height: 820 };
  const visibleCanvas = { left: 0, top: 0, right: 390, bottom: 460 };
  const view = {
    _html: '',
    elements: [],
    set innerHTML(html) {
      this._html = html;
      this.elements = [];
      // SVG nodes must come from the actual production-rendered <g> tags.
      for (const match of html.matchAll(/<g\b([^>]*)>/g)) {
        const attrs = match[1];
        if (!/\bclass="graph-node(?:\s|")/.test(attrs)) continue;
        const id = attrs.match(/\bdata-graph-node="([^"]+)"/)?.[1];
        if (!id) continue;
        this.elements.push(makeElement('g', id, attrs));
      }
      for (const match of html.matchAll(/<button\b([^>]*)>/g)) {
        const id = match[1].match(/\bdata-graph-node="([^"]+)"/)?.[1];
        if (id) this.elements.push(makeElement('button', id, match[1]));
      }
    },
    get innerHTML() { return this._html; },
    querySelectorAll(selector) {
      if (selector === '[data-graph-node]') return [...this.elements];
      if (selector === '.graph-node[data-graph-node]') {
        return this.elements.filter(x => x.tag === 'g' && x.className.startsWith('graph-node'));
      }
      throw new Error('Unexpected query selector ' + selector);
    },
  };
  function makeElement(tag, id, attrs) {
    return {
      tag, dataset: { graphNode: id }, className: attrs.match(/\bclass="([^"]+)"/)?.[1] ?? '',
      listeners: {},
      addEventListener(type, handler) { this.listeners[type] = handler; },
      focus(options) { assert.equal(options?.preventScroll, true); focused = this; },
      getBoundingClientRect() { return nodeBounds; },
      closest(selector) {
        assert.equal(selector, '.graph-canvas-wrap');
        return { getBoundingClientRect() { return visibleCanvas; } };
      },
      scrollIntoView(options) {
        assert.equal(options.block, 'nearest');
        assert.equal(options.inline, 'nearest');
        scrollCalls++;
      },
    };
  }
  const document = {
    querySelector(id) {
      if (id === '#graph-open-memory' || id === '#graph-close-details') return null;
      if (['#graph-search', '#graph-origin-filter', '#graph-group-filter', '#graph-state-filter'].includes(id)) {
        return { addEventListener() {} };
      }
      throw new Error('Unexpected query selector ' + id);
    },
    getElementById() { return null; },
  };
  const start = app.indexOf('function graphFilteredNodes(');
  const end = app.indexOf('async function loadGraph(', start);
  assert.ok(start >= 0 && end > start, 'bounded production graph functions');
  const ctx = {
    state, el: { view }, document, window: { innerWidth: viewport.width, innerHeight: viewport.height },
    escapeHtml: (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
    number: (value) => String(value ?? 0),
    dateTime: (value) => String(value ?? ''),
    statusClass: () => '',
    definition: () => '',
    compactTechnicalId: (value) => String(value),
    loading: () => {},
  };
  const render = vm.runInNewContext(app.slice(start, end) + '\nrenderGraph', ctx);
  render();
  return {
    state, view, render, get focused() { return focused; },
    get scrollCalls() { return scrollCalls; },
  };
}

test('D12 selects the matching node from its rendered SVG markup and restores keyboard focus', () => {
  const visible = mountedGraph({ left: 120, right: 150, top: 130, bottom: 155 });
  const neighbor = visible.view.elements.find(x => x.tag === 'button' && x.dataset.graphNode === 'b');
  assert.ok(neighbor, 'inspector neighbor is rendered as a real data-graph-node button');
  neighbor.listeners.click();
  assert.equal(visible.state.selectedGraphNodeId, 'b');
  assert.ok(visible.focused, 'focus must reach an SVG node rendered after the selection');
  assert.equal(visible.focused.dataset.graphNode, 'b');
  assert.equal(visible.focused.tag, 'g');
  assert.equal(visible.scrollCalls, 0, 'already visible target should not scroll');

  const offscreen = mountedGraph({ left: 900, right: 930, top: 130, bottom: 155 });
  const nextNeighbor = offscreen.view.elements.find(x => x.tag === 'button' && x.dataset.graphNode === 'b');
  assert.ok(nextNeighbor);
  nextNeighbor.listeners.click();
  assert.equal(offscreen.focused?.dataset.graphNode, 'b');
  assert.equal(offscreen.scrollCalls, 1, 'offscreen SVG node must become visible');
});

test('D12 keeps full-size scrollable graph canvas on mobile without shrinking viewBox labels', () => {
  assert.match(css, /@media \(max-width: 980px\)[\s\S]*?\.graph-canvas-wrap\s*\{[^}]*overflow:\s*auto/);
  assert.match(css, /@media \(max-width: 980px\)[\s\S]*?\.graph-canvas\s*\{[^}]*min-width:\s*1000px/);
  assert.match(css, /\.graph-canvas\s*\{[^}]*min-width:\s*1000px;\s*min-height:\s*680px/);
});
