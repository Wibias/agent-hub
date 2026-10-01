import { createHash } from 'node:crypto';

import {
  inspectMemoryTextSensitivity,
} from './index.mjs';

export const CAPTURE_POLICY_VERSION = 'capture-v1';

function normalizeForFingerprint(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase();
}

export function memoryCandidateFingerprint({
  type,
  value,
}) {
  if (typeof type !== 'string' || type.trim().length === 0) {
    throw new TypeError('type must be a non-empty string');
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError('value must be a non-empty string');
  }

  return createHash('sha256')
    .update(type.trim().toLowerCase() + '\n' + normalizeForFingerprint(value))
    .digest('hex');
}

const TRANSIENT_EXACT = new Set([
  'go',
  'continue',
  'resume',
  'fahre fort',
  'mach weiter',
  'weiter',
  'run tests',
  'run tests.',
  'test it',
  'test it.',
  'merge it',
  'merge it.',
  'okay',
  'ok',
  'ja',
  'yes',
  'done',
  'erledigt',
]);

const TENTATIVE = [
  /\bmaybe\b/iu,
  /\bperhaps\b/iu,
  /\bpossibly\b/iu,
  /\bmight\b/iu,
  /\bcould\b/iu,
  /\bwe should consider\b/iu,
  /\bconsidering\b/iu,
  /\bvielleicht\b/iu,
  /\beventuell\b/iu,
  /\bkönnt(?:e|en)\b/iu,
  /\bsollten wir\b/iu,
  /\bich überlege\b/iu,
  /\bwir überlegen\b/iu,
];

const ASSISTANT_DIRECTIVE = [
  /^\s*please\b/iu,
  /\bi\s+want\s+you\s+to\b/iu,
  /\bi(?:'d| would)\s+like\s+you\s+to\b/iu,
  /\bich\s+will\s*,?\s*dass\s+du\b/iu,
  /\bich\s+möchte\s*,?\s*dass\s+du\b/iu,
  /\bkannst\s+du\b/iu,
  /\bkönntest\s+du\b/iu,
];

const RULES = [
  {
    type: 'correction',
    reason: 'rule:correction:explicit',
    patterns: [
      /^\s*correction\s*:/iu,
      /^\s*korrektur\s*:/iu,
      /\bactually\b[^.!?]{0,120}\b(?:not|instead)\b/iu,
      /\bnicht\b[^.!?]{0,80}\bsondern\b/iu,
    ],
  },
  {
    type: 'known_issue',
    reason: 'rule:known_issue:explicit',
    patterns: [
      /^\s*(?:known issue|known bug)\s*:/iu,
      /^\s*(?:bekanntes problem|bekannter fehler)\s*:/iu,
    ],
  },
  {
    type: 'rejected_approach',
    reason: 'rule:rejected_approach:explicit',
    patterns: [
      /\b(?:do not|don't|never)\s+(?:use|reconnect|enable|add|switch|move|store|capture)\b/iu,
      /\bwe\s+(?:will not|won't)\s+(?:use|reconnect|enable|add|switch|move|store|capture)\b/iu,
      /\b(?:nicht|nie)\s+(?:verwenden|nutzen|einsetzen|aktivieren|speichern)\b/iu,
      /\bkein(?:e|en|er|es)?\s+[^.!?]{0,80}\s+(?:verwenden|nutzen|einsetzen|aktivieren)\b/iu,
      /\bwir\s+(?:verwenden|nutzen|nehmen)\s+[^.!?]{0,80}\s+nicht\b/iu,
    ],
  },
  {
    type: 'constraint',
    reason: 'rule:constraint:explicit',
    patterns: [
      /\b(?:we|i)\s+(?:must|have to|need to)\b/iu,
      /\bmust\s+not\b/iu,
      /\b(?:wir|ich)\s+(?:müssen|muss|dürfen|darf)\b/iu,
      /\b(?:muss|müssen)\b/iu,
      /\bbei\s+[^.!?]{0,40}\s+bleiben\b/iu,
    ],
  },
  {
    type: 'decision',
    reason: 'rule:decision:definitive',
    patterns: [
      /\b(?:we|i)\s+(?:decided(?:\s+to)?|choose|chose|will use|use|are using|stick with|are sticking with|go with)\b/iu,
      /\b(?:wir|ich)\s+(?:verwenden|nutzen|nehmen|setzen auf|bleiben bei|entscheiden uns für)\b/iu,
      /\b(?:wir|ich)\s+haben uns für\b/iu,
    ],
  },
  {
    type: 'preference',
    reason: 'rule:preference:explicit',
    patterns: [
      /\b(?:i|we)\s+(?:prefer|want|like)\b/iu,
      /\bich\s+(?:bevorzuge|möchte|will|mag)\b/iu,
      /\bwir\s+bevorzugen\b/iu,
    ],
  },
];

function explicitMemoryManagementPrompt(value) {
  return /^\s*memory(?:\s+(?:list|candidates|explain|forget|replace)\b|\s*:)/iu.test(value);
}

export function classifyMemoryCandidatePrompt(prompt) {
  if (typeof prompt !== 'string') return null;

  const value = prompt.trim();
  if (value.length === 0) return null;
  if (explicitMemoryManagementPrompt(value)) return null;

  const sensitivity = inspectMemoryTextSensitivity(value);
  if (sensitivity.containsSecret) return null;

  const normalized = value
    .normalize('NFKC')
    .replace(/\s+/gu, ' ')
    .trim();

  if (TRANSIENT_EXACT.has(normalized.toLowerCase())) return null;
  if (/[?？]\s*$/u.test(normalized)) return null;
  if (TENTATIVE.some((pattern) => pattern.test(normalized))) return null;
  if (ASSISTANT_DIRECTIVE.some((pattern) => pattern.test(normalized))) return null;

  for (const rule of RULES) {
    if (!rule.patterns.some((pattern) => pattern.test(normalized))) continue;

    return {
      type: rule.type,
      value,
      decisionReason: rule.reason,
      policyVersion: CAPTURE_POLICY_VERSION,
      fingerprint: memoryCandidateFingerprint({
        type: rule.type,
        value,
      }),
    };
  }

  return null;
}
