import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { MemoryEngine } from '../../memory-engine/index.mjs';
import { EvidenceBoundProposalStore } from '../../memory-engine/evidence-bound-proposal-store.mjs';
import { evidenceExtractionFingerprint } from '../../memory-engine/evidence-bound-extraction.mjs';
import {
  parseVerbatimRuleArgs, selectExactAcceptanceRule,
  stageVerbatimAcceptanceRule, runVerbatimRuleCommand,
} from '../../scripts/seed-memory-shadow-verbatim-acceptance-rule.mjs';

const projectId = 'github.com/example/streamer-content';
const branch = 'fix5-plan44';
const sourceId = 'evidence:original-session';
const oldFact = 'The original Plan 44 instruction was temporary.';
const original = `BAU Plan 44 only: use Win32_Process.Create for THIS run.
Regeln aus plans/regeln-abnahme.md, woertlich (gelten fuer die Test-/Bildphase):
# Harte Regeln für alle künftigen Abnahme-Prompts (ab 12.11.2026)
Pflichtblock in jedem Abnahme-Prompt:
- ZEITBUDGET nennen (Minuten). Startzeit sofort in zeit.txt; vor jedem groesseren Schritt pruefen.
- Spaetestens 35 Minuten nach Start abbrechen: eigene PIDs beenden, aufraeumen, last.txt als Teilbericht (Langfassung), done.txt mit ABBRUCH-ZEIT.
- Stack-Prozesse nur losgeloest (Start-Process -WindowStyle Hidden, Ausgabe in Logdateien), nie im selben Shell-Aufruf wie Tests/Aufraeumen, nie mit geerbter Konsole.
- Playwright-Diff/Actual/Expected roter Tests VOR dem Aufraeumen nach shots\\diff\\ kopieren.
- Hoechstens eine Nachaufnahme je Bild.
- Laufzeit im Bericht aus zeit.txt messen, nicht schätzen.
Nachtrag 12.11.2026:
- Jeder Job hat ausschliesslich einen eigenen Vite-Cache.
- Kein gemeinsam genutzter Optimizer-Cache.
- Bei Vite-Cache-Konflikt genau eine Wiederholung der betroffenen Suite.
Repo Wibias/streamer-content. Worktree in the one-off plan 44.
`;
const ref = id => '~p' + createHash('sha256').update(id).digest('hex').slice(0,12);

function fixture(t, text = original) {
  const root = mkdtempSync(join(tmpdir(), 'agenthub-verbatim-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const folder = join(root, 'AgentHub-Evidence-Shadow-' + 'f'.repeat(32));
  mkdirSync(folder);
  const dbPath = join(folder, 'memory-shadow.sqlite3');
  const memory = new MemoryEngine({ dbPath });
  try {
    memory.registerProject({ projectId, repoIdentity: projectId });
    memory.recordEvidence({
      id: sourceId, projectId, branch,
      sourceKind:'session', sourceRef:'session:plan44',
      capturedAt:'2026-11-15T04:02:00.000Z',
      authorityClass:'user_direct', harness:'codex', content:text,
    });
  } finally {memory.close();}
  const store = new EvidenceBoundProposalStore({
    dbPath, inspectTextSensitivity: () => ({ containsSecret: false }),
  });
  try {
    store.record({
      id:'proposal:existing-v1', projectId, branch,
      kind:'procedure', canonicalFact:oldFact,
      evidenceIds:[sourceId],
      fingerprint:evidenceExtractionFingerprint({kind:'procedure', canonicalFact:oldFact}),
      policyVersion:'evidence-extraction-v1',
      evaluatorId:'synthetic-fixture:v1',
      createdAt:'2026-11-15T04:10:00.000Z',
    });
  } finally {store.close();}
  return { root, dbPath, sourceProposalRef: ref('proposal:existing-v1') };
}

function counts(dbPath) {
  const db = new DatabaseSync(dbPath, {readOnly:true});
  try {
    return {
      evidence:db.prepare('SELECT COUNT(*) n FROM evidence').get().n,
      claims:db.prepare('SELECT COUNT(*) n FROM claims').get().n,
      proposals:db.prepare('SELECT COUNT(*) n FROM memory_evidence_proposals').get().n,
      original: {...db.prepare(
        "SELECT status,policy_version FROM memory_evidence_proposals WHERE id='proposal:existing-v1'",
      ).get()},
    };
  } finally { db.close(); }
}
function args(f) {
  return {
    dbPath:f.dbPath,projectId,branch,
    sourceProposalRef:f.sourceProposalRef,localAppData:f.root,
  };
}

test('strict general scope and source phrase required, without reading a task-specific Win32 statement', () => {
  const fragment=original.slice(original.indexOf('Regeln aus plans/regeln-abnahme.md'),original.indexOf('Repo Wibias/streamer-content.'));
  const selected=selectExactAcceptanceRule(fragment);
  assert.equal(selected.kind,'procedure');
  assert.equal(selected.canonicalFact,
    'Pflichtblock in jedem Abnahme-Prompt: Laufzeit im Bericht aus zeit.txt messen, nicht schätzen.');
  assert.doesNotMatch(selected.canonicalFact,/Win32_Process.Create/u);
  assert.throws(()=>selectExactAcceptanceRule(fragment.replace('Pflichtblock in jedem Abnahme-Prompt:', 'specific job instruction')));
  assert.throws(()=>selectExactAcceptanceRule(fragment.replace('Harte Regeln für alle künftigen Abnahme-Prompts','Harte Regeln only')));
  assert.throws(()=>selectExactAcceptanceRule(fragment.replace('nicht schätzen.','nur schätzen.')));
});

test('default preview is model-free, read-only, content-free', t => {
  const f=fixture(t);
  const before=counts(f.dbPath);
  const output=stageVerbatimAcceptanceRule(args(f));
  assert.equal(output.status,'shadow_verbatim_rule_inspected');
  assert.equal(output.exactRuleVerifiedInSource,true);
  assert.equal(output.modelCalls,0);
  assert.equal(output.protectedApproval,false);
  assert.deepEqual(counts(f.dbPath),before);
  assert.doesNotMatch(JSON.stringify(output),/zeit.txt|schätzen|Win32_Process/u);
});

test('explicit record stages one pending proposal linked to unchanged original user-direct Evidence', t => {
  const f=fixture(t);
  const result=stageVerbatimAcceptanceRule({...args(f),record:true});
  assert.equal(result.status,'shadow_verbatim_rule_staged_unreviewed');
  assert.equal(result.proposalsCreated,1);
  assert.equal(result.claimsCreated,0);
  assert.equal(result.sourceEvidenceRowsCreated,0);
  assert.equal(result.protectedApproval,false);
  assert.deepEqual(counts(f.dbPath),{
    evidence:1,claims:0,proposals:2,
    original:{status:'pending',policy_version:'evidence-extraction-v1'},
  });
  const db=new DatabaseSync(f.dbPath,{readOnly:true});
  try {
    const proposal=db.prepare(
      "SELECT * FROM memory_evidence_proposals WHERE policy_version='evidence-verbatim-selection-v1'",
    ).get();
    assert.equal(proposal.status,'pending');
    assert.equal(proposal.importance_json,null);
    assert.equal(proposal.support_json,null);
    assert.equal(proposal.canonical_fact,
      'Pflichtblock in jedem Abnahme-Prompt: Laufzeit im Bericht aus zeit.txt messen, nicht schätzen.');
    assert.deepEqual(db.prepare(
      'SELECT evidence_id FROM memory_evidence_proposal_evidence WHERE proposal_id=?',
    ).all(proposal.id).map(x=>x.evidence_id),[sourceId]);
    assert.equal(db.prepare('SELECT content_redacted FROM evidence WHERE id=?').get(sourceId).content_redacted,original);
  } finally {db.close();}
  const repeated=stageVerbatimAcceptanceRule({...args(f),record:true});
  assert.equal(repeated.status,'shadow_verbatim_rule_already_exists');
  assert.deepEqual(counts(f.dbPath),{
    evidence:1,claims:0,proposals:2,
    original:{status:'pending',policy_version:'evidence-extraction-v1'},
  });
});

test('failed literal quote never creates proposals or makes model calls', t=>{
  const f=fixture(t,original.replace('- Laufzeit im Bericht aus zeit.txt messen, nicht schätzen.','- Estimated time is fine.'));
  let output='';
  const rc=runVerbatimRuleCommand({
    argv:['--shadow-db',f.dbPath,'--project-id',projectId,'--branch',branch,
      '--source-proposal-ref',f.sourceProposalRef,'--record-proposal'],
    run:opts=>stageVerbatimAcceptanceRule({...opts,localAppData:f.root}),
    write:s=>{output+=s;},
  });
  assert.equal(rc,2);
  assert.equal(JSON.parse(output).status,'shadow_verbatim_rule_failed');
  assert.equal(JSON.parse(output).model_call_attempted,false);
  assert.doesNotMatch(output,/Estimated time|Win32_Process/u);
  assert.equal(counts(f.dbPath).proposals,1);
});

test('write flags, duplicate scope, unrelated source and canonical file location fail closed', t=>{
  const f=fixture(t);
  const argv=['--shadow-db',f.dbPath,'--project-id',projectId,
    '--branch',branch,'--source-proposal-ref',f.sourceProposalRef];
  assert.equal(parseVerbatimRuleArgs(argv).record,false);
  assert.equal(parseVerbatimRuleArgs([...argv,'--record-proposal']).record,true);
  assert.throws(()=>parseVerbatimRuleArgs([...argv,'--run-model']));
  assert.throws(()=>parseVerbatimRuleArgs([...argv,'--write']));
  assert.throws(()=>parseVerbatimRuleArgs([...argv,'--record-proposal','--record-proposal']));
  assert.throws(()=>stageVerbatimAcceptanceRule({...args(f),sourceProposalRef:'~p000000000000',record:true}));
  assert.equal(counts(f.dbPath).proposals,1);
});
