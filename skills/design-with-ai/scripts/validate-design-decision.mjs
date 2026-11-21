#!/usr/bin/env node
// Read-only, dependency-free identity checks for optional DWA deep design packets.
// Mechanical validity is not evidence of genuine human approval or design quality.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function canonicalStringify(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalStringify).join(',') + ']';
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonicalStringify(value[k])).join(',') + '}';
  }
  throw new TypeError('Unsupported value in decision packet; use plain JSON only');
}

export function hashArtifact(value) {
  return createHash('sha256').update(canonicalStringify(value), 'utf8').digest('hex');
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function keys(value, required, optional, label, errors) {
  if (!object(value)) {
    errors.push(label + ': expected object');
    return false;
  }
  for (const key of required) if (!Object.hasOwn(value, key)) errors.push(label + ': missing ' + key);
  for (const key of Object.keys(value)) if (!required.includes(key) && !optional.includes(key)) errors.push(label + ': unexpected ' + key);
  return true;
}

function str(value, label, errors) {
  if (typeof value !== 'string' || !value.trim()) errors.push(label + ': expected nonempty string');
}

function list(value, label, errors, allowEmpty = true) {
  if (!Array.isArray(value)) {
    errors.push(label + ': expected string array');
    return [];
  }
  if (!allowEmpty && value.length === 0) errors.push(label + ': cannot be empty');
  const seen = new Set();
  for (const item of value) {
    str(item, label + ' item', errors);
    if (typeof item === 'string') {
      if (seen.has(item)) errors.push(label + ': duplicate ' + item);
      seen.add(item);
    }
  }
  return value;
}

function specificRef(ref, label, errors) {
  str(ref, label, errors);
  if (typeof ref === 'string' && /(^|[:/#@])latest($|[:/#@])/i.test(ref)) errors.push(label + ': unversioned latest ref');
}

function validHash(value, label, errors) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) errors.push(label + ': expected lowercase SHA-256 hex');
}

export function validateDecisionPacket(packet) {
  const errors = [];
  const required = ['schemaVersion', 'artifactType', 'artifactId', 'workflowRoute', 'profile', 'brief', 'directions', 'recommendation'];
  if (!keys(packet, required, [], 'packet', errors)) return { errors, checkpointHash: null, briefHash: null };
  if (packet.schemaVersion !== 1 || packet.artifactType !== 'DIRECTION_SET') errors.push('packet: unsupported schemaVersion or artifactType');
  str(packet.artifactId, 'packet.artifactId', errors);
  if (!['redesign-existing', 'build-product-surface', 'direction-selection'].includes(packet.workflowRoute)) errors.push('packet.workflowRoute: unknown route');
  if (!['standard', 'deep'].includes(packet.profile)) errors.push('packet.profile: unknown profile');
  if (keys(packet.brief, ['id', 'purpose', 'targetUsers', 'contentModel', 'contentIds', 'constraints', 'successCriteria'], [], 'packet.brief', errors)) {
    for (const k of ['id', 'purpose', 'targetUsers', 'contentModel']) str(packet.brief[k], 'packet.brief.' + k, errors);
    list(packet.brief.contentIds, 'packet.brief.contentIds', errors, false);
    list(packet.brief.constraints, 'packet.brief.constraints', errors);
    list(packet.brief.successCriteria, 'packet.brief.successCriteria', errors, false);
  }
  if (!Array.isArray(packet.directions) || packet.directions.length < 2 || packet.directions.length > 3) errors.push('packet.directions: expected 2-3 directions');
  const directionIds = new Set();
  if (Array.isArray(packet.directions)) for (const [i, direction] of packet.directions.entries()) {
    const label = 'packet.directions[' + i + ']';
    if (!keys(direction, ['id', 'title', 'structuralModel', 'primaryContent', 'groupingModel', 'interactionOrganization', 'visualWorld', 'tradeoffs'], [], label, errors)) continue;
    for (const k of ['id', 'title', 'structuralModel', 'groupingModel', 'interactionOrganization', 'visualWorld']) str(direction[k], label + '.' + k, errors);
    if (directionIds.has(direction.id)) errors.push('packet.directions: duplicate ID ' + direction.id);
    directionIds.add(direction.id);
    for (const contentId of list(direction.primaryContent, label + '.primaryContent', errors, false)) {
      if (Array.isArray(packet.brief?.contentIds) && !packet.brief.contentIds.includes(contentId)) errors.push(label + ': unknown content ID ' + contentId);
    }
    list(direction.tradeoffs, label + '.tradeoffs', errors, false);
  }
  if (packet.recommendation !== null && !directionIds.has(packet.recommendation)) errors.push('packet.recommendation: must name a displayed candidate or be null');
  return {
    errors,
    checkpointHash: errors.length ? null : hashArtifact(packet),
    briefHash: errors.length ? null : hashArtifact(packet.brief),
  };
}

export function validateOwnerDecision(decision, packet, packetCheck) {
  const errors = [];
  if (!keys(decision, ['schemaVersion', 'artifactType', 'artifactId', 'checkpointHash', 'briefHash', 'selectedDirectionId', 'actorKind'], ['ownerResponseRef', 'delegationRef', 'rationale'], 'decision', errors)) return errors;
  if (decision.schemaVersion !== 1 || decision.artifactType !== 'DIRECTION_DECISION') errors.push('decision: unsupported schemaVersion or artifactType');
  str(decision.artifactId, 'decision.artifactId', errors);
  validHash(decision.checkpointHash, 'decision.checkpointHash', errors);
  validHash(decision.briefHash, 'decision.briefHash', errors);
  if (!packetCheck.checkpointHash || decision.checkpointHash !== packetCheck.checkpointHash) errors.push('decision: stale or unrecognized checkpointHash');
  if (!packetCheck.briefHash || decision.briefHash !== packetCheck.briefHash) errors.push('decision: stale briefHash');
  const ids = new Set(Array.isArray(packet?.directions) ? packet.directions.map(x => x?.id) : []);
  if (decision.selectedDirectionId !== 'REJECT_BOTH' && !ids.has(decision.selectedDirectionId)) errors.push('decision: selectedDirectionId not in displayed directions');
  if (decision.actorKind === 'HUMAN_OWNER') {
    specificRef(decision.ownerResponseRef, 'decision.ownerResponseRef', errors);
    if (Object.hasOwn(decision, 'delegationRef')) errors.push('decision: human approval cannot contain delegationRef');
  } else if (decision.actorKind === 'AGENT_DELEGATE') {
    specificRef(decision.delegationRef, 'decision.delegationRef', errors);
    if (Object.hasOwn(decision, 'ownerResponseRef')) errors.push('decision: delegated selection is not human approval');
    if (packet?.workflowRoute === 'redesign-existing' && packet?.profile === 'deep') errors.push('decision: deep redesign requires HUMAN_OWNER approval');
  } else errors.push('decision.actorKind: expected HUMAN_OWNER or AGENT_DELEGATE');
  if (Object.hasOwn(decision, 'rationale')) str(decision.rationale, 'decision.rationale', errors);
  return errors;
}

export function validateRepresentativeSlice(slice, packet, decision, packetCheck) {
  const errors = [];
  const required = ['schemaVersion', 'artifactType', 'artifactId', 'sourceDirectionSetHash', 'sourceDecisionHash', 'sourceDirectionId', 'flow', 'coveredContent', 'omittedContent', 'representativenessRationale', 'views', 'transitions', 'criticalStates', 'responsiveBehavior', 'visualDecisions', 'tradeoffs'];
  if (!keys(slice, required, [], 'slice', errors)) return errors;
  if (slice.schemaVersion !== 1 || slice.artifactType !== 'REPRESENTATIVE_SLICE') errors.push('slice: unsupported schemaVersion or artifactType');
  for (const key of ['artifactId', 'flow', 'representativenessRationale']) str(slice[key], 'slice.' + key, errors);
  validHash(slice.sourceDirectionSetHash, 'slice.sourceDirectionSetHash', errors);
  validHash(slice.sourceDecisionHash, 'slice.sourceDecisionHash', errors);
  if (!packetCheck.checkpointHash || slice.sourceDirectionSetHash !== packetCheck.checkpointHash) errors.push('slice: stale sourceDirectionSetHash');
  if (!decision || slice.sourceDecisionHash !== hashArtifact(decision)) errors.push('slice: stale or absent sourceDecisionHash');
  if (!decision || decision.selectedDirectionId === 'REJECT_BOTH' || slice.sourceDirectionId !== decision.selectedDirectionId) errors.push('slice: sourceDirectionId not selected');
  const covered = list(slice.coveredContent, 'slice.coveredContent', errors, false);
  const omitted = list(slice.omittedContent, 'slice.omittedContent', errors);
  const all = new Set([...covered, ...omitted]);
  const allowed = Array.isArray(packet?.brief?.contentIds) ? packet.brief.contentIds : [];
  for (const id of covered) if (omitted.includes(id)) errors.push('slice: covered/omitted content overlap ' + id);
  for (const id of all) if (!allowed.includes(id)) errors.push('slice: unknown content ' + id);
  for (const id of allowed) if (!all.has(id)) errors.push('slice: content not covered or omitted ' + id);
  if (!Array.isArray(slice.views) || slice.views.length < 1 || slice.views.length > 3) errors.push('slice.views: expected 1-3 views');
  const views = new Set();
  if (Array.isArray(slice.views)) for (const [i, view] of slice.views.entries()) {
    const label = 'slice.views[' + i + ']';
    if (!keys(view, ['id', 'label'], [], label, errors)) continue;
    str(view.id, label + '.id', errors); str(view.label, label + '.label', errors);
    if (views.has(view.id)) errors.push('slice.views: duplicate ID ' + view.id);
    views.add(view.id);
  }
  if (!Array.isArray(slice.transitions)) errors.push('slice.transitions: expected array');
  const edges = new Map();
  if (Array.isArray(slice.transitions)) for (const [i, tr] of slice.transitions.entries()) {
    const label = 'slice.transitions[' + i + ']';
    if (!keys(tr, ['from', 'to', 'trigger'], [], label, errors)) continue;
    for (const k of ['from', 'to', 'trigger']) str(tr[k], label + '.' + k, errors);
    if (!views.has(tr.from) || !views.has(tr.to)) errors.push(label + ': dangling view reference');
    if (!edges.has(tr.from)) edges.set(tr.from, []);
    edges.get(tr.from).push(tr.to);
  }
  if (Array.isArray(slice.views) && slice.views.length) {
    const entry = slice.views[0]?.id, reached = new Set([entry]), queue = [entry];
    for (let index = 0; index < queue.length; index++) for (const next of edges.get(queue[index]) || []) {
      if (!reached.has(next)) { reached.add(next); queue.push(next); }
    }
    for (const view of slice.views) if (!reached.has(view?.id)) errors.push('slice: unreachable view ' + view?.id);
  }
  if (!Array.isArray(slice.criticalStates)) errors.push('slice.criticalStates: expected array');
  if (Array.isArray(slice.criticalStates)) for (const [i, state] of slice.criticalStates.entries()) {
    if (!keys(state, ['viewId', 'state'], [], 'slice.criticalStates[' + i + ']', errors)) continue;
    if (!views.has(state.viewId)) errors.push('slice.criticalStates[' + i + ']: unknown viewId');
    str(state.state, 'slice.criticalStates[' + i + '].state', errors);
  }
  list(slice.responsiveBehavior, 'slice.responsiveBehavior', errors);
  list(slice.visualDecisions, 'slice.visualDecisions', errors);
  list(slice.tradeoffs, 'slice.tradeoffs', errors);
  return errors;
}

export function validateAll({ packet, decision = null, slice = null }) {
  const packetCheck = validateDecisionPacket(packet);
  const errors = [...packetCheck.errors];
  if (decision !== null) errors.push(...validateOwnerDecision(decision, packet, packetCheck));
  if (slice !== null) {
    if (decision === null) errors.push('slice: decision artifact is required');
    else errors.push(...validateRepresentativeSlice(slice, packet, decision, packetCheck));
  }
  return {
    ok: errors.length === 0,
    errors,
    hashes: {
      checkpointHash: packetCheck.checkpointHash,
      briefHash: packetCheck.briefHash,
      decisionHash: decision && errors.length === 0 ? hashArtifact(decision) : null,
      sliceHash: slice && errors.length === 0 ? hashArtifact(slice) : null,
    },
    limitations: ['Source refs and HUMAN_OWNER declarations must be corroborated from actual owner-channel evidence.', 'Structural distinctness, design quality, and rendered correctness are not mechanically verified.'],
  };
}

function usage() {
  return 'Usage: node validate-design-decision.mjs --packet direction-set.json [--decision decision.json] [--slice representative-slice.json] [--json]';
}

export function runCli(argv = process.argv.slice(2)) {
  if (argv.includes('--help')) { console.log(usage()); return 0; }
  const paths = {};
  const allowed = new Set(['--packet', '--decision', '--slice']);
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--json') { json = true; continue; }
    if (!allowed.has(flag) || !argv[i + 1] || argv[i + 1].startsWith('--') || paths[flag]) {
      console.error(usage()); return 2;
    }
    paths[flag] = argv[++i];
  }
  if (!paths['--packet']) { console.error(usage()); return 2; }
  try {
    const read = path => JSON.parse(readFileSync(path, 'utf8'));
    const result = validateAll({
      packet: read(paths['--packet']),
      decision: paths['--decision'] ? read(paths['--decision']) : null,
      slice: paths['--slice'] ? read(paths['--slice']) : null,
    });
    if (json) console.log(JSON.stringify(result, null, 2));
    else console.log((result.ok ? 'PASS' : 'FAIL') + ' design decision identity\n' + JSON.stringify(result, null, 2));
    return result.ok ? 0 : 1;
  } catch (error) {
    console.error('FAIL: ' + error.message);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = runCli();
