import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = file => readFileSync(new URL(file, import.meta.url), 'utf8');
const skill = read('../SKILL.md');
const handoff = read('../references/developer-handoff.md');
const lineage = read('../references/design-decision-lineage.md');
test('handoff stays bounded and cannot mint acceptance', () => {
  assert.match(skill, /design-spec handoff/);
  assert.match(handoff, /SPEC_ONLY/);
  assert.match(handoff, /does not mint new approval|cannot mint approval/i);
  assert.match(lineage, /cannot mint or upgrade a human approval/);
});
test('handoff carries sourced identity and uncertainty, not fictional precision', () => {
  for (const field of ['briefRef', 'directionSetRef', 'ownerDecisionRef', 'representativeSliceRef']) {
    assert.ok(handoff.includes(field), 'Missing handoff lineage: ' + field);
  }
  for (const grade of ['MEASURED', 'APPROVED', 'PROPOSED', 'UNKNOWN']) {
    assert.ok(handoff.includes(grade), 'Missing evidence grade: ' + grade);
  }
});
test('retired prototype skill is not an active DWA handoff dependency', () => {
  assert.doesNotMatch(skill, /skills\/prototype/);
  assert.doesNotMatch(handoff, /skills\/prototype/);
});
