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
  parseAcceptanceRulesArgs, selectVerbatimAcceptanceRules,
  extractAcceptanceRules, runAcceptanceRulesCommand,
} from '../../scripts/extract-memory-shadow-acceptance-rules.mjs';

const projectId = 'github.com/example/acceptance-rules-fixture';
const sourceId = 'user-evidence-plan44';
const oldFact = 'The team must always use Win32_Process.Create for every job.';
const newFact = 'For acceptance reports, determine runtime from zeit.txt rather than estimates.';
const general = `Regeln aus plans/regeln-abnahme.md, woertlich (gelten fuer die Test-/Bildphase):
# Harte Regeln fuer alle kuenftigen Abnahme-Prompts
- ZEITBUDGET nennen (Minuten). Startzeit sofort in zeit.txt; vor jedem groesseren Schritt pruefen.
- Spaetestens 35 Minuten nach Start abbrechen: eigene PIDs beenden, aufraeumen, last.txt als Teilbericht (Langfassung), done.txt mit ABBRUCH-ZEIT.
- Stack-Prozesse nur losgeloest (Start-Process -WindowStyle Hidden, Ausgabe in Logdateien), nie im selben Shell-Aufruf wie Tests oder Aufraeumen, nie mit geerbter Konsole.
- Playwright-Diff/Actual/Expected roter Tests VOR dem Aufraeumen nach shots\\diff\\ kopieren.
- Hoechstens eine Nachaufnahme je Bild.
- Laufzeit im Bericht aus zeit.txt messen, nicht schaetzen.
Nachtrag 12.11.2026:
- Jeder Job hat seinen eigenen Vite-Cache. Kein gemeinsam genutzter Optimizer-Cache.
- Bei Vite-Dep-Cache-Konflikt genau eine Wiederholungslauf der betroffenen Suite.
`;
const whole = `BAU build-plan44l-1115 (task-specific). Win32_Process.Create for THIS run.
Regeln aus plans/regeln-bau.md, woertlich:
# Harte Regeln fuer kuenftige Bau-Prompts
- Kein Force Push und kein Rebase.
${general}
Repo Wibias/streamer-content. Worktree from this one-off assignment.
- one-off plan 44 only: use Win32_Process.Create.
`;
const ref = id => '~p' + createHash('sha256').update(id).digest('hex').slice(0,12);

function setup(t, sourceText = whole) {
  const root = mkdtempSync(join(tmpdir(), 'acceptance-rules-shadow-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, 'AgentHub-Evidence-Shadow-' + 'd'.repeat(32));
  mkdirSync(dir);
  const dbPath = join(dir, 'memory-shadow.sqlite3');
  const memory = new MemoryEngine({ dbPath });
  try {
    memory.registerProject({ projectId, repoIdentity: projectId });
    memory.recordEvidence({
      id: sourceId, projectId, branch:'fix5-plan44',
      sourceKind:'session', sourceRef:'session:plan44', harness:'codex',
      capturedAt:'2026-11-15T04:02:00.000Z',
      authorityClass:'user_direct', content:sourceText,
    });
  } finally { memory.close(); }
  const store = new EvidenceBoundProposalStore({
    dbPath, inspectTextSensitivity: () => ({ containsSecret: false }),
  });
  try {
    store.record({
      id:'proposal-existing-v1', projectId, branch:'fix5-plan44',
      kind:'procedure', canonicalFact:oldFact,
      evidenceIds:[sourceId],
      fingerprint:evidenceExtractionFingerprint({kind:'procedure',canonicalFact:oldFact}),
      policyVersion:'evidence-extraction-v1',
      evaluatorId:'synthetic-fixture:extraction',
      createdAt:'2026-11-15T04:10:00.000Z',
    });
  } finally { store.close(); }
  return { root,dbPath,sourceProposalRef:ref('proposal-existing-v1') };
}
function counts(dbPath) {
  const db = new DatabaseSync(dbPath,{readOnly:true});
  try {
    return {
      evidence:db.prepare('SELECT COUNT(*) n FROM evidence').get().n,
      claims:db.prepare('SELECT COUNT(*) n FROM claims').get().n,
      proposals:db.prepare('SELECT COUNT(*) n FROM memory_evidence_proposals').get().n,
      oldState:{...db.prepare("SELECT status,policy_version FROM memory_evidence_proposals WHERE id='proposal-existing-v1'").get()},
    };
  } finally { db.close(); }
}

test('scope selector is exact verbatim block, excludes the one-off Win32 instruction',()=>{
  const excerpt=selectVerbatimAcceptanceRules(whole);
  assert.ok(whole.includes(excerpt));
  assert.ok(excerpt.startsWith('Regeln aus plans/regeln-abnahme.md'));
  assert.match(excerpt,/Laufzeit im Bericht aus zeit.txt messen/u);
  assert.match(excerpt,/shots\\diff/u);
  assert.doesNotMatch(excerpt,/Win32_Process.Create/u);
  assert.doesNotMatch(excerpt,/Repo Wibias\/streamer-content/u);
  assert.throws(()=>selectVerbatimAcceptanceRules('Not the rule block'));
  assert.throws(()=>selectVerbatimAcceptanceRules(whole+'\n'+whole),/ambiguous/u);
});

test('default inspection is fully read-only and sends no source content to stdout', async t=>{
  const f=setup(t);
  const before=counts(f.dbPath);
  let called=false;
  const r=await extractAcceptanceRules({
    dbPath:f.dbPath,projectId,branch:'fix5-plan44',
    sourceProposalRef:f.sourceProposalRef,localAppData:f.root,
    createJudge:()=>{called=true;throw Error('unexpected');},
  });
  assert.equal(called,false);
  assert.equal(r.status,'shadow_acceptance_rules_inspected');
  assert.equal(r.modelCallAttempted,false);
  assert.equal(r.evidenceExcerptIsVerbatim,true);
  assert.equal(r.sourceEvidenceRowsCreated,0);
  assert.deepEqual(counts(f.dbPath),before);
  assert.doesNotMatch(JSON.stringify(r),/ZEITBUDGET|Win32_Process|zeit.txt/u);
});

test('explicit single model call stores only pending v2 proposal linked to original source',async t=>{
  const f=setup(t);
  let calls=0,closed=0;
  const r=await extractAcceptanceRules({
    dbPath:f.dbPath,projectId,branch:'fix5-plan44',
    sourceProposalRef:f.sourceProposalRef,localAppData:f.root,runModel:true,
    createJudge:async()=>({
      evaluatorId:'synthetic-fixture:one-model-call',
      async judge(prompt) {
        calls++;
        assert.match(prompt,/evidence-extraction-v2/u);
        assert.match(prompt,/Laufzeit im Bericht aus zeit.txt messen/u);
        assert.match(prompt,/user-evidence-plan44/u);
        assert.doesNotMatch(prompt,/Win32_Process.Create/u);
        assert.doesNotMatch(prompt,/BAU build-plan44l/u);
        return JSON.stringify({memories:[{
          kind:'procedure',canonical_fact:newFact,evidence_ids:[sourceId],
        }]});
      },
      async close(){closed++;},
    }),
  });
  assert.equal(r.status,'shadow_acceptance_rules_extracted_unreviewed');
  assert.equal(r.modelCallAttempted,true);
  assert.equal(r.proposedOrMatched,1);
  assert.equal(r.newProposalRows,1);
  assert.equal(calls,1);
  assert.equal(closed,1);
  assert.equal(r.claimsCreated,0);
  assert.equal(r.protectedApproval,false);
  assert.deepEqual(counts(f.dbPath),{
    evidence:1,claims:0,proposals:2,
    oldState:{status:'pending',policy_version:'evidence-extraction-v1'},
  });
  const db=new DatabaseSync(f.dbPath,{readOnly:true});
  try{
    const newer=db.prepare("SELECT * FROM memory_evidence_proposals WHERE policy_version='evidence-extraction-v2'").get();
    assert.equal(newer.status,'pending');
    assert.equal(newer.importance_json,null);
    assert.equal(newer.support_json,null);
    const src=db.prepare("SELECT evidence_id FROM memory_evidence_proposal_evidence WHERE proposal_id=?").all(newer.id);
    assert.deepEqual(src.map(x=>x.evidence_id),[sourceId]);
    assert.equal(db.prepare('SELECT content_redacted FROM evidence WHERE id=?').get(sourceId).content_redacted,whole);
  } finally {db.close();}
  assert.doesNotMatch(JSON.stringify(r),/ZEITBUDGET|Win32_Process|zeit.txt/u);
});

test('failure never falls back to full evidence or calls model; errors are sanitized',async t=>{
  const f=setup(t,'Only a task-specific plan 44 command without general sections.');
  let calls=0;
  await assert.rejects(extractAcceptanceRules({
    dbPath:f.dbPath,projectId,branch:'fix5-plan44',
    sourceProposalRef:f.sourceProposalRef,localAppData:f.root,
    runModel:true,createJudge:()=>{calls++;throw Error('never called');},
  }),/boundaries/u);
  assert.equal(calls,0);
  assert.equal(counts(f.dbPath).claims,0);
  let output='';
  const code=await runAcceptanceRulesCommand({
    argv:['--shadow-db',f.dbPath,'--project-id',projectId,
      '--branch','fix5-plan44','--source-proposal-ref',f.sourceProposalRef,'--run-model'],
    run:args=>extractAcceptanceRules({...args,localAppData:f.root}),
    write:s=>{output+=s;},
  });
  assert.equal(code,2);
  assert.equal(JSON.parse(output).status,'shadow_acceptance_rules_failed');
  assert.equal(JSON.parse(output).model_call_attempted,false);
  assert.doesNotMatch(output,/task-specific plan 44|Only a task/u);
});

test('wrong source ref and extraneous write flags fail closed',async t=>{
  const f=setup(t);
  const args=['--shadow-db',f.dbPath,'--project-id',projectId,
    '--branch','fix5-plan44','--source-proposal-ref',f.sourceProposalRef];
  assert.equal(parseAcceptanceRulesArgs(args).runModel,false);
  assert.equal(parseAcceptanceRulesArgs([...args,'--run-model']).runModel,true);
  assert.throws(()=>parseAcceptanceRulesArgs([...args,'--write']));
  assert.throws(()=>parseAcceptanceRulesArgs([...args,'--run-model','--run-model']));
  await assert.rejects(extractAcceptanceRules({
    dbPath:f.dbPath,projectId,branch:'fix5-plan44',
    sourceProposalRef:'~p000000000000',localAppData:f.root,runModel:true,
  }),/ref not unique/u);
});
