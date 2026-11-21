import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalStringify, hashArtifact, validateDecisionPacket,
  validateAll, validateOwnerDecision, validateRepresentativeSlice,
} from '../scripts/validate-design-decision.mjs';

function fixture() {
  const packet = {
    schemaVersion: 1, artifactType: 'DIRECTION_SET', artifactId: 'jobs-v1',
    workflowRoute: 'redesign-existing', profile: 'deep',
    brief: { id: 'brief-v1', purpose: 'Review jobs', targetUsers: 'operators',
      contentModel: 'Jobs with review and settings', contentIds: ['queue', 'job', 'help'],
      constraints: ['Keep permission rules'], successCriteria: ['Review faster'] },
    directions: [
      { id: 'A', title: 'Queue first', structuralModel: 'queue',
        primaryContent: ['queue', 'job'], groupingModel: 'queue groups',
        interactionOrganization: 'list to details', visualWorld: 'editorial',
        tradeoffs: ['less reporting'] },
      { id: 'B', title: 'Task workspace', structuralModel: 'workbench',
        primaryContent: ['job', 'help'], groupingModel: 'task groups',
        interactionOrganization: 'step panels', visualWorld: 'industrial',
        tradeoffs: ['needs focus'] },
    ],
    recommendation: 'B',
  };
  const check = validateDecisionPacket(packet);
  const decision = {
    schemaVersion: 1, artifactType: 'DIRECTION_DECISION', artifactId: 'decision-v1',
    checkpointHash: check.checkpointHash, briefHash: check.briefHash,
    selectedDirectionId: 'B', actorKind: 'HUMAN_OWNER',
    ownerResponseRef: 'user-message:123', rationale: 'Task path is clearer',
  };
  const slice = {
    schemaVersion: 1, artifactType: 'REPRESENTATIVE_SLICE', artifactId: 'slice-v1',
    sourceDirectionSetHash: check.checkpointHash, sourceDecisionHash: hashArtifact(decision),
    sourceDirectionId: 'B', flow: 'Review a job',
    coveredContent: ['queue', 'job'], omittedContent: ['help'],
    representativenessRationale: 'Highest-consequence review flow',
    views: [{ id: 'list', label: 'Queue' }, { id: 'detail', label: 'Job details' }],
    transitions: [{ from: 'list', to: 'detail', trigger: 'Choose job' }],
    criticalStates: [{ viewId: 'detail', state: 'permission denied' }],
    responsiveBehavior: ['Narrow view uses stacked details'],
    visualDecisions: ['Task before reporting'], tradeoffs: ['Help deferred'],
  };
  return { packet, decision, slice };
}
function clone(x) { return structuredClone(x); }
function errs(f) { return f.errors.join('; '); }

test('canonical JSON key order does not change the checkpoint hash', () => {
  assert.equal(canonicalStringify({ b: 1, a: { z: 3, x: 2 } }), canonicalStringify({ a: { x: 2, z: 3 }, b: 1 }));
  assert.equal(hashArtifact({ a: 1, b: 2 }), hashArtifact({ b: 2, a: 1 }));
});
test('valid packet, human selection and connected representative slice', () => {
  const f = fixture(); assert.equal(validateAll(f).ok, true, errs(validateAll(f)));
});
test('a mutated direction invalidates the old approval', () => {
  const f = fixture(); f.packet.directions[1].visualWorld = 'different visual world';
  assert.match(errs(validateAll(f)), /stale or unrecognized checkpointHash/);
});
test('a changed brief invalidates both old decision bindings', () => {
  const f = fixture(); f.packet.brief.purpose = 'Review cases';
  assert.match(errs(validateAll(f)), /stale briefHash/);
});
test('candidate IDs are unique and recommendations name an existing candidate', () => {
  const f = fixture(); f.packet.directions[1].id = 'A'; f.packet.recommendation = 'UNKNOWN';
  assert.match(errs(validateAll(f)), /duplicate ID/);
});
test('an unknown selected candidate cannot be approved', () => {
  const f = fixture(); f.decision.selectedDirectionId = 'C';
  assert.match(errs(validateAll(f)), /not in displayed directions/);
});
test('a human owner needs an attributable reply reference', () => {
  const f = fixture(); delete f.decision.ownerResponseRef;
  assert.match(errs(validateAll(f)), /ownerResponseRef/);
});
test('a generic latest owner response reference cannot count', () => {
  const f = fixture(); f.decision.ownerResponseRef = 'messages/latest';
  assert.match(errs(validateAll(f)), /unversioned latest/);
});
test('delegate is not allowed to bypass deep redesign human lock', () => {
  const f = fixture(); f.decision.actorKind = 'AGENT_DELEGATE'; delete f.decision.ownerResponseRef;
  f.decision.delegationRef = 'user-message:120';
  assert.match(errs(validateAll(f)), /requires HUMAN_OWNER/);
});
test('authorized delegation is kept separate on deep new surfaces', () => {
  const f = fixture(); f.packet.workflowRoute = 'build-product-surface';
  const c = validateDecisionPacket(f.packet);
  f.decision.checkpointHash = c.checkpointHash; f.decision.briefHash = c.briefHash;
  f.decision.actorKind = 'AGENT_DELEGATE'; delete f.decision.ownerResponseRef;
  f.decision.delegationRef = 'user-message:120';
  assert.deepEqual(validateOwnerDecision(f.decision, f.packet, c), []);
});
test('selection rejection cannot produce a representative slice', () => {
  const f = fixture(); f.decision.selectedDirectionId = 'REJECT_BOTH';
  assert.match(errs(validateAll(f)), /not selected/);
});
test('covered and omitted content cannot overlap', () => {
  const f = fixture(); f.slice.omittedContent.push('job');
  assert.match(errs(validateAll(f)), /overlap/);
});
test('every declared content ID is covered or explicitly omitted', () => {
  const f = fixture(); f.slice.omittedContent = [];
  assert.match(errs(validateAll(f)), /not covered or omitted/);
});
test('transition endpoints must reference actual views', () => {
  const f = fixture(); f.slice.transitions[0].to = 'nonexistent';
  assert.match(errs(validateAll(f)), /dangling view reference/);
});
test('multiple views must be reachable from the first view', () => {
  const f = fixture(); f.slice.transitions = [];
  assert.match(errs(validateAll(f)), /unreachable view/);
});
test('critical states refer to known views', () => {
  const f = fixture(); f.slice.criticalStates[0].viewId = 'removed-view';
  assert.match(errs(validateAll(f)), /unknown viewId/);
});
test('closed schema refuses unexpected fields', () => {
  const f = fixture(); f.decision.selfApproved = true;
  assert.match(errs(validateAll(f)), /unexpected selfApproved/);
});
test('a stale representative-slice decision hash is rejected', () => {
  const f = fixture(); f.slice.sourceDecisionHash = '0'.repeat(64);
  assert.match(errs(validateAll(f)), /stale or absent sourceDecisionHash/);
});
test('a slice without an owner decision is rejected', () => {
  const f = fixture();
  assert.match(errs(validateAll({ packet: f.packet, slice: f.slice })), /decision artifact is required/);
});
test('ordering of arrays is significant to the displayed checkpoint', () => {
  const f = fixture(), before = hashArtifact(f.packet);
  f.packet.directions.reverse();
  assert.notEqual(before, hashArtifact(f.packet));
});
