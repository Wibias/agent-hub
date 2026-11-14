import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../../memory-ui/app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../memory-ui/styles.css', import.meta.url), 'utf8');
const start = app.indexOf('function memoryDisplayTitle(');
const stop = app.indexOf('function graphPositions(', start);
assert.ok(start >= 0 && stop > start);
const ui = vm.runInNewContext(app.slice(start, stop)
  + '\n({ memoryDisplayTitle, graphLabelLines, graphReadableLayout, graphNodeCardSvg, graphSelectedRelationNote })', {
  escapeHtml: value => String(value ?? '').replaceAll('&','&amp;')
    .replaceAll('<','&lt;').replaceAll('>','&gt;')
    .replaceAll('"','&quot;').replaceAll("'",'&#039;'),
  graphAuthorityLabel: value => value === 'user_direct' ? 'Direct user statement' : String(value),
  graphRelationLabel: edge => edge.relation.replaceAll('_',' '),
});

test('claim-derived graph title is meaningful, bounded and never shows ref as title', () => {
  assert.equal(ui.memoryDisplayTitle('memory: database is CockroachDB'), 'database is CockroachDB');
  const card = ui.graphNodeCardSvg({ value:'memory: database is CockroachDB', state:'rejected',
    authority:'user_direct', ref:'@abcdef0123' });
  assert.match(card,/database is CockroachDB/);
  assert.doesNotMatch(card,/@abcdef0123/);
  const lines = ui.graphLabelLines('memory: database is CockroachDB with more words and extra detail');
  assert.ok(lines.length <= 2 && lines.every(x => [...x].length <= 27));
  assert.doesNotMatch(ui.graphNodeCardSvg({value:'<img src=x onerror=alert(1)>',state:'active',
    authority:'user_direct'}),/<img/);
});

test('14 visible nodes fit in stable non-overlapping semantic card layout', () => {
  const nodes = Array.from({length:14},(_,i)=>({id:'n'+i}));
  const layout = ui.graphReadableLayout(nodes,[{from:'n0',to:'n1'}]);
  assert.equal(layout.width,1200);
  const coordinates = [...layout.positions.values()];
  assert.equal(coordinates.length,14);
  for(let i=0;i<coordinates.length;i++) for(let j=i+1;j<coordinates.length;j++) {
    assert.ok(Math.abs(coordinates[i].x-coordinates[j].x)>=252
      || Math.abs(coordinates[i].y-coordinates[j].y)>=84);
  }
  assert.equal(ui.graphReadableLayout(Array.from({length:25},(_,i)=>({id:''+i})),[]),null);
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
