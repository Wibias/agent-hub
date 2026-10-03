import { createHash } from 'node:crypto';

import { inspectMemoryTextSensitivity } from './index.mjs';

export const AGENT_DECISION_CAPTURE_POLICY_VERSION = 'agent-capture-v1';

const MAX_DECISIONS_PER_MESSAGE = 3;
const MAX_DECISION_LENGTH = 1_000;

const TENTATIVE = [
  /\bmaybe\b/iu,
  /\bperhaps\b/iu,
  /\bpossibly\b/iu,
  /\bmight\b/iu,
  /\bcould\b/iu,
  /\bwe should consider\b/iu,
  /\bi(?:'d| would) consider\b/iu,
  /\bvielleicht\b/iu,
  /\beventuell\b/iu,
  /\bkönnt(?:e|en)\b/iu,
  /\bsollten wir\b/iu,
];

const DECISION_PATTERNS = [
  /^\s*(?:decision|chosen approach|selected approach)\s*:\s*\S/iu,
  /^\s*(?:entscheidung|gewählter ansatz|gewählte lösung)\s*:\s*\S/iu,
  /\bI\s+(?:decided|chose|selected|switched|moved|kept|standardized)\b/iu,
  /\bI\s+(?:will use|will keep|am using|use)\b/iu,
  /\bwe\s+(?:decided|chose|selected|switched|moved|kept|standardized)\b/iu,
  /\bwe\s+(?:will use|will keep|are using|use)\b/iu,
  /\bthe project\s+(?:will use|uses|now uses|standardizes on)\b/iu,
  /\bich\s+(?:habe mich entschieden|habe gewählt|verwende|nutze|setze auf|bleibe bei)\b/iu,
  /\bwir\s+(?:haben uns entschieden|haben gewählt|verwenden|nutzen|setzen auf|bleiben bei)\b/iu,
  /\bdas projekt\s+(?:verwendet|nutzt|setzt auf|wird .* verwenden)\b/iu,
];

function normalizeCandidateText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/^\s*[-*+]\s+/u, '')
    .replace(/^\s*\d+[.)]\s+/u, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function splitDecisionUnits(message) {
  const lines = String(message ?? '')
    .split(/\r?\n/u)
    .map(normalizeCandidateText)
    .filter(Boolean);

  const units = [];
  for (const line of lines) {
    if (line.length <= MAX_DECISION_LENGTH) {
      units.push(line);
      continue;
    }

    for (const sentence of line.split(/(?<=[.!?])\s+/u)) {
      const normalized = normalizeCandidateText(sentence);
      if (
        normalized.length > 0
        && normalized.length <= MAX_DECISION_LENGTH
      ) {
        units.push(normalized);
      }
    }
  }
  return units;
}

export function agentDecisionFingerprint({
  value,
  agentType = 'root',
}) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError('value must be a non-empty string');
  }
  if (typeof agentType !== 'string' || agentType.trim().length === 0) {
    throw new TypeError('agentType must be a non-empty string');
  }

  return createHash('sha256')
    .update('agent_inference\ndecision\n', 'utf8')
    .update(agentType.trim().toLowerCase(), 'utf8')
    .update('\n', 'utf8')
    .update(
      value.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLowerCase(),
      'utf8',
    )
    .digest('hex');
}

export function classifyAgentDecisionMessage(message, {
  agentType = 'root',
  maxDecisions = MAX_DECISIONS_PER_MESSAGE,
} = {}) {
  if (typeof message !== 'string') return [];
  if (!Number.isInteger(maxDecisions) || maxDecisions < 1 || maxDecisions > 10) {
    throw new RangeError('maxDecisions must be an integer between 1 and 10');
  }

  const results = [];
  const seen = new Set();

  for (const unit of splitDecisionUnits(message)) {
    if (/[?？]\s*$/u.test(unit)) continue;
    if (TENTATIVE.some((pattern) => pattern.test(unit))) continue;
    if (!DECISION_PATTERNS.some((pattern) => pattern.test(unit))) continue;

    const sensitivity = inspectMemoryTextSensitivity(unit);
    if (sensitivity.containsSecret) continue;

    const fingerprint = agentDecisionFingerprint({
      value: unit,
      agentType,
    });
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);

    results.push({
      type: 'decision',
      value: unit,
      sourceAuthority: 'agent_inference',
      decisionReason: 'rule:agent_decision:explicit_commitment',
      policyVersion: AGENT_DECISION_CAPTURE_POLICY_VERSION,
      fingerprint,
    });

    if (results.length >= maxDecisions) break;
  }

  return results;
}
