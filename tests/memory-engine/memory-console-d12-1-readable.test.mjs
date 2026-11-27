import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../../memory-ui/app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../memory-ui/styles.css', import.meta.url), 'utf8');
const start = app.indexOf('function memoryDisplayTitle(');
const stop = app.indexOf('function graphAuthorityLabel(', start);
assert.ok(start >= 0 && stop > start);
const ui = vm.runInNewContext(app.slice(start, stop)
  + '\n({ memoryDisplayTitle, graphLabelLines, graphPositions, graphNodeCircleSvg, graphSelectedRelationNote })', {
  escapeHtml: value => String(value ?? '').replaceAll('&','&amp;')
    .replaceAll('<','&lt;').replaceAll('>','&gt;')
    .replaceAll('"','&quot;').replaceAll("'",'&#039;'),
  graphAuthorityLabel: value => value === 'user_direct' ? 'Direct user statement' : String(value),
  graphRelationLabel: edge => edge.relation.replaceAll('_',' '),
});

test('claim-derived graph title is meaningful, bounded and never shows ref as title', () => {
  assert.equal(ui.memoryDisplayTitle('memory: database is CockroachDB'), 'database is CockroachDB');
  const node = ui.graphNodeCircleSvg({
    value: 'memory: database is CockroachDB',
    state: 'rejected',
    authority: 'user_direct',
    ref: '@abcdef0123',
  }, { radius: 12, community: { color: 2 }, labelVisible: true });
  assert.match(node, /circle/);
  assert.match(node, /database is CockroachDB/);
  assert.doesNotMatch(node, /@abcdef0123/);
  const lines = ui.graphLabelLines('memory: database is CockroachDB with more words and extra detail');
  assert.ok(lines.length <= 2 && lines.every(x => [...x].length <= 27));
  assert.doesNotMatch(ui.graphNodeCircleSvg({
    value: '<img src=x onerror=alert(1)>',
    state: 'active',
    authority: 'user_direct',
  }, { radius: 10, community: { color: 0 }, labelVisible: true }), /<img/);
});

test('14 visible nodes use bounded organic circular positions', () => {
  const nodes = Array.from({length:14},(_,i)=>({id:'n'+i}));
  const edges = Array.from({length:13},(_,i)=>({
    from:'n'+i, to:'n'+(i+1), origin:'inferred', source:'embedding_similarity',
  }));
  const positions = ui.graphPositions(nodes, edges);
  assert.equal(positions.size, 14);
  const coordinates = [...positions.values()];
  for (const point of coordinates) {
    assert.ok(point.x >= 56 && point.x <= 944);
    assert.ok(point.y >= 56 && point.y <= 624);
  }
  for (let i=0;i<coordinates.length;i+=1) {
    for (let j=i+1;j<coordinates.length;j+=1) {
      assert.ok(
        coordinates[i].x !== coordinates[j].x
        || coordinates[i].y !== coordinates[j].y,
      );
    }
  }
});

test('edge annotation comes from recorded selected relation only', () => {
  const from={x:10,y:30},to={x:300,y:30};
  const edge={from:'a',to:'b',relation:'supersedes',origin:'explicit',source:'canonical'};
  assert.match(ui.graphSelectedRelationNote(edge,from,to,{id:'a'}),/supersedes/);
  assert.equal(ui.graphSelectedRelationNote(edge,from,to,{id:'c'}),'');
  assert.match(ui.graphSelectedRelationNote({from:'a',to:'b',relation:'related_to',
    origin:'inferred',source:'typed_relation'},from,to,{id:'a'}),/graph-edge-note advisory/);
});

test('mobile graph and memories details are on-demand and dismissible', () => {
  assert.match(app,/id="graph-close-details"/);
  assert.match(app,/id="memory-close-details"/);
  assert.match(app,/graphInspectorOpen = true/);
  assert.match(app,/memoryInspectorOpen = true/);
  assert.match(css,/\.graph-layout:not\(\.is-details-open\) > \.graph-inspector/);
  assert.match(css,/\.memory-layout:not\(\.is-details-open\) > \.inspector/);
});

test('no n/a pipeline rows in the default inspector, but zero is preserved', () => {
  const a=app.indexOf('function definitionOptional(');
  const b=app.indexOf('function renderClaimActions(',a);
  assert.ok(a>=0&&b>a);
  const fn=vm.runInNewContext(app.slice(a,b)+'\ndefinitionOptional',
    {definition: rows=>rows.map(x=>x.join('=')).join(',')});
  assert.equal(fn([['Candidate','n/a'],['Other',null]]),'');
  assert.equal(fn([['Retrieved',0],['Candidate','n/a']]),'Retrieved=0');
  assert.match(app,/optionalInspectorSection\('Pipeline details'/);
});
