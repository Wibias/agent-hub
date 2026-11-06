import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MemoryEngine } from '../../memory-engine/index.mjs';
import { createMemoryProtocol } from '../../memory-engine/protocol.mjs';
import {
  createCodexMemoryHookAdapter,
} from '../../memory-engine/adapters/codex-hooks.mjs';
import {
  parseCodexHookCliOptions,
} from '../../memory-engine/adapters/codex-hook-cli.mjs';
import {
  shouldPrepareCodexMemoryRecallRuntime,
} from '../../memory-engine/adapters/codex-memory-recall-runtime.mjs';
import {
  isAtomicRuleConfirmationAttempt,
  parseAtomicRuleConfirmationPrompt,
  verifyCapturedAtomicConfirmationEvidence,
} from '../../memory-engine/memory-atomic-confirmation-capture.mjs';
import {
  atomicRuleConfirmationText,
} from '../../memory-engine/memory-atomic-confirmed-staging.mjs';

const PROJECT = 'github.com/example/streamer-project';
const BRANCH = 'main';
const REF = '~d1234567890abcdef';
const RULE = 'For all future overlay reviews, verify required assets and representative test data before reporting defects.';
const COMMAND = atomicRuleConfirmationText({
  projectId: PROJECT, branch: BRANCH, draftRef: REF, ruleText: RULE,
});

function hookEvent(prompt = COMMAND, overrides = {}) {
  return {
    session_id: 'session-confirm',
    cwd: '/test/repo',
    turn_id: 'turn-confirm',
    hook_event_name: 'UserPromptSubmit',
    prompt,
    ...overrides,
  };
}
function fakeGit(branch = BRANCH) {
  return {
    async resolveContext() { return {
      repoPath:'/test/repo',branch,revisionSha:'a'.repeat(40),
    }; },
    async refreshFreshness() { return 0; },
  };
}
async function fixture(action, opts = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'atomic-capture-hook-'));
  const memory = new MemoryEngine({ dbPath: join(dir,'memory.sqlite3') });
  try {
    memory.registerProject({ projectId: PROJECT, repoIdentity: PROJECT });
    const calls = [];
    const underlying = createMemoryProtocol({
      memory,
      classifyAuthority(channel) {
        return channel.sourceKind === 'session'
          && channel.metadata?.event_type === 'user_prompt'
          ? 'user_direct' : 'unclassified';
      },
    });
    const protocol = { async handle(request) {
      calls.push(request.operation);
      return underlying.handle(request);
    }};
    const adapter = createCodexMemoryHookAdapter({
      protocol, memory, projectId: PROJECT, git: fakeGit(opts.branch),
      explicitMemoryRequests: opts.explicitMemoryRequests ?? true,
      atomicRuleConfirmationCapture: opts.atomicRuleConfirmationCapture ?? true,
      candidateCapture: opts.candidateCapture ?? true,
      capturePrompts: opts.capturePrompts ?? false,
      clock: () => '2026-11-06T12:00:00.000Z',
    });
    return await action({memory,calls,adapter});
  } finally {
    memory.close();
    await rm(dir,{recursive:true,force:true});
  }
}

test('strict full-text parser admits one exact scoped sentence only', () => {
  assert.equal(isAtomicRuleConfirmationAttempt(COMMAND),true);
  assert.deepEqual(parseAtomicRuleConfirmationPrompt(COMMAND),{
    mode:'atomic_rule_confirm',draftRef:REF,projectId:PROJECT,branch:BRANCH,ruleText:RULE,
  });
  for(const malformed of [
    ' ' + COMMAND,
    COMMAND + '\nAlso store another secret.',
    COMMAND + ' ',
    COMMAND.replace(REF,'~a1234567890abcdef'),
    COMMAND.replace('PERMANENT','TEMPORARY'),
    COMMAND.replace(RULE,'Short.'),
    COMMAND.replace(RULE, 'Use api_key=abcdefghijklmnop for all future reviews, then run tests.'),
    'Someone said: ' + COMMAND,
    COMMAND + '\u0000',
  ]) assert.equal(parseAtomicRuleConfirmationPrompt(malformed),null);
  assert.equal(isAtomicRuleConfirmationAttempt('Someone said: ' + COMMAND),false);
});

test('explicit opt-in CLI flag is separate from existing explicit memory flag', () => {
  assert.equal(parseCodexHookCliOptions([]).atomicRuleConfirmationCapture,undefined);
  const options=parseCodexHookCliOptions([
    '--explicit-memory-requests','--atomic-rule-confirmation-capture',
  ]);
  assert.equal(options.explicitMemoryRequests,true);
  assert.equal(options.atomicRuleConfirmationCapture,true);
  assert.equal(shouldPrepareCodexMemoryRecallRuntime({
    recall(){},materializeRecall(){},semanticCandidates(){},getClaim(){},
  },{explicitMemoryMode:'atomic_rule_confirm'}),false);
});

test('valid trusted hook event captures exactly one source Evidence and no Claim or candidate', async () => {
  await fixture(async ({memory,calls,adapter})=>{
    const outcome=await adapter.handle(hookEvent());
    assert.equal(outcome.decision,'block');
    assert.match(outcome.reason,/Evidence captured for review/);
    const id='evidence:codex:session-confirm:turn-confirm:prompt';
    const evidence=memory.getEvidence(id);
    assert.ok(verifyCapturedAtomicConfirmationEvidence(evidence,{
      command:COMMAND,projectId:PROJECT,branch:BRANCH,
      evidenceId:id,sessionId:'session-confirm',
    }));
    assert.equal(evidence.content_redacted,COMMAND);
    assert.equal(evidence.metadata.explicit_memory_mode,'atomic_rule_confirm');
    assert.equal(evidence.metadata.atomic_rule_draft_ref,REF);
    assert.deepEqual(calls,['capture_evidence']);
    assert.equal(memory.exportCanonical().claims.length,0);
    assert.equal(memory.listCandidates({projectId:PROJECT,branch:BRANCH,limit:20}).length,0);
    const replay=await adapter.handle(hookEvent());
    assert.match(replay.reason,/Evidence captured for review/);
    assert.deepEqual(calls,['capture_evidence']);
  });
});

test('atomic command is reserved and rejected without opt-in or correct branch', async () => {
  for(const opts of [
    {atomicRuleConfirmationCapture:false},
    {explicitMemoryRequests:false},
    {branch:'feature'},
  ]) {
    await fixture(async ({memory,calls,adapter})=>{
      const result=await adapter.handle(hookEvent());
      assert.equal(result.decision,'block');
      assert.match(result.reason,/not captured/);
      assert.deepEqual(calls,[]);
      assert.equal(memory.getEvidence('evidence:codex:session-confirm:turn-confirm:prompt'),null);
      assert.equal(memory.exportCanonical().claims.length,0);
      assert.equal(memory.listCandidates({projectId:PROJECT,branch:BRANCH,limit:20}).length,0);
    },opts);
  }
});

test('malformed atomic prefixes fail closed without a Candidate from embedded rule', async () => {
  await fixture(async ({memory,calls,adapter})=>{
    const result=await adapter.handle(hookEvent(
      COMMAND.replace(RULE,'We must always keep this secret forever.') + '\nAnother instruction',
    ));
    assert.equal(result.decision,'block');
    assert.deepEqual(calls,[]);
    assert.equal(memory.exportCanonical().claims.length,0);
    assert.equal(memory.listCandidates({projectId:PROJECT,branch:BRANCH,limit:20}).length,0);
  });
});

test('foreign or conflicting preexisting Evidence is never treated as a valid confirmation', async () => {
  await fixture(async ({memory,calls,adapter})=>{
    memory.recordEvidence({
      id:'evidence:codex:session-confirm:turn-confirm:prompt',
      projectId:PROJECT,branch:BRANCH,harness:'codex',
      sessionId:'session-confirm',sourceKind:'session',sourceRef:'session:confirm',
      capturedAt:'2026-11-06T12:00:00.000Z',
      authorityClass:'user_direct',content:'Different original user instruction',
      metadata:{event_type:'user_prompt'},
    });
    const output=await adapter.handle(hookEvent());
    assert.equal(output.decision,'block');
    assert.match(output.reason,/provenance checks/);
    assert.deepEqual(calls,[]);
    assert.equal(memory.exportCanonical().claims.length,0);
  });
});

test('non-UserPromptSubmit event cannot capture an atomic confirmation', async () => {
  await fixture(async ({memory,calls,adapter})=>{
    const output=await adapter.handle(hookEvent(COMMAND,{
      hook_event_name:'AssistantStop',
    }));
    assert.equal(output,null);
    assert.deepEqual(calls,[]);
    assert.equal(memory.exportCanonical().evidence.length,0);
  });
});
