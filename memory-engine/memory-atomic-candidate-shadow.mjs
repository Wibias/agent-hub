import { createHash } from 'node:crypto';
import { inspectMemoryTextSensitivity } from './index.mjs';

export const ATOMIC_CANDIDATE_SHADOW_POLICY_VERSION = 'atomic-shadow-v1';

const DURABLE_CUE = /\b(?:always|going forward|from now on|in the future|in future|for every future|across future|future sessions|as a general rule|permanently|künftig|zukünftig|ab jetzt|ab sofort|immer|grundsätzlich|dauerhaft|in zukünftigen|bei allen künftigen)\b/iu;
const BOUNDED_CUE = /\b(?:until|through this release|during this phase|for this migration|before the cutover|until launch|bis zum|bis zur|bis die|solange|während dieser phase|für diese phase|bis zum release)\b/iu;
const TENTATIVE_CUE = /\b(?:maybe|perhaps|possibly|might|could|consider|vielleicht|eventuell|könnte|könnten|überlegen)\b/iu;
const SCOPED_AUDIT_CUE = /\b(?:strict read.only|read.only audit|validation and research task|do not implement recommendations|for this audit|in this audit|audit[- ]auftrag|ausschließlich für diese prüfung)\b/iu;
const FEEDBACK_CUE = /\b(?:too quickly|too fast|rushed|did not research|not researched|check properly|test properly|vorschnell|zu schnell|nicht richtig recherchiert|nicht gründlich|ordentlich und sorgfältig|vorher testen)\b/iu;
const TASK_CUE = /^(?:please |now |then |next |add\b|implement\b|create\b|fix\b|run\b|test\b|upload\b|füge\b|erstelle\b|teste\b|prüfe\b|wiederhole\b|setze\b|mach\b|mache\b|dann\b|jetzt\b)/iu;
const RULE_CUE = /\b(?:must|must not|should|prefer|we use|we decided|i prefer|we prefer|always|use|verify|review|test|check|require|never|müssen|muss|soll|sollte|bevorzuge|verwenden|prüfen|testen|nicht|künftig|vorher)\b/iu;

function hash(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Exact UTF-16 offsets into the original source, without rewriting the text. */
function segment(source) {
  const result = [];
  let cursor = 0;
  const delimiters = /(?<=[.!?])\s+|(?:\r?\n){2,}/gu;
  function push(value, start) {
    if (!value.trim()) return;
    const left = value.length - value.trimStart().length;
    const right = value.trimEnd().length;
    const fragment = value.slice(left, right);
    const at = start + left;
    result.push({ start: at, end: at + fragment.length, text: fragment });
  }
  for (const match of source.matchAll(delimiters)) {
    push(source.slice(cursor, match.index), cursor);
    cursor = match.index + match[0].length;
  }
  push(source.slice(cursor), cursor);
  return result;
}

function classifyFragment(fragment) {
  if (/[?？]\s*$/u.test(fragment) || TENTATIVE_CUE.test(fragment)) return null;
  if (SCOPED_AUDIT_CUE.test(fragment)) return null;
  if (DURABLE_CUE.test(fragment) && RULE_CUE.test(fragment)) {
    return { disposition: 'durable_review', reasonCode: 'explicit_future_scope' };
  }
  if (BOUNDED_CUE.test(fragment) && RULE_CUE.test(fragment)) {
    return { disposition: 'bounded_review', reasonCode: 'explicit_bounded_scope' };
  }
  if (FEEDBACK_CUE.test(fragment) && !TASK_CUE.test(fragment)) {
    return { disposition: 'ambiguous_review', reasonCode: 'quality_feedback_without_duration' };
  }
  return null;
}

/**
 * No candidate storage or promotion. Source text remains unmodified.
 * Only verbatim, contiguous source spans with verifiable offsets are returned.
 * Every suggestion requires later independent human/semantic review.
 */
export function proposeAtomicCandidateShadows(source, { sourceAuthority = 'user_direct' } = {}) {
  const reject = (reason) => ({
    policyVersion: ATOMIC_CANDIDATE_SHADOW_POLICY_VERSION,
    mode: 'shadow_only', reason, segmentsInspected: 0, suggestions: [],
  });
  if (sourceAuthority !== 'user_direct') return reject('non_user_authority');
  if (typeof source !== 'string' || !source.trim()) return reject('empty');
  if (source.length > 20_000) return reject('source_too_large');
  if (inspectMemoryTextSensitivity(source).containsSecret
    || /https?:\/\/\S*(?:token|secret|key)=/iu.test(source)) return reject('sensitive_source');

  // Strictly scoped research plans must not be broken into global prohibitions.
  if ((/^#{1,6}\s/mu.test(source) || source.length > 1800)
    && SCOPED_AUDIT_CUE.test(source)) return reject('scoped_audit_protocol');
  if (source.includes(String.fromCharCode(96).repeat(3))) return reject('code_block');

  const chunks = segment(source);
  if (chunks.length > 24) return reject('too_many_segments');
  const sourceHash = hash(source);
  const suggestions = [];
  for (const chunk of chunks) {
    if (chunk.text.length < 20 || chunk.text.length > 1000) continue;
    const classification = classifyFragment(chunk.text);
    if (!classification) continue;
    suggestions.push({
      ...classification,
      start: chunk.start,
      end: chunk.end,
      sourceHash,
      fragmentHash: hash(chunk.text),
      fragment: chunk.text,
    });
  }
  return {
    policyVersion: ATOMIC_CANDIDATE_SHADOW_POLICY_VERSION,
    mode: 'shadow_only',
    reason: suggestions.length ? 'review_suggestions' : 'no_confident_suggestions',
    segmentsInspected: chunks.length,
    suggestions,
  };
}

/** Default privacy-safe report. Source snippets require explicit local opt-in. */
export function summarizeAtomicCandidateShadows(result, { includeLocalText = false } = {}) {
  if (!result || result.mode !== 'shadow_only' || !Array.isArray(result.suggestions)) {
    throw new TypeError('invalid shadow result');
  }
  const counts = { durable_review: 0, bounded_review: 0, ambiguous_review: 0 };
  const suggestions = result.suggestions.map((suggestion) => {
    if (!Object.hasOwn(counts, suggestion.disposition)) throw new Error('unknown disposition');
    counts[suggestion.disposition] += 1;
    return {
      disposition: suggestion.disposition,
      reasonCode: suggestion.reasonCode,
      start: suggestion.start,
      end: suggestion.end,
      sourceHash: suggestion.sourceHash,
      fragmentHash: suggestion.fragmentHash,
      ...(includeLocalText ? { localSourceFragment: suggestion.fragment } : {}),
    };
  });
  return {
    type: 'agent_hub_memory_atomic_shadow_v1',
    policyVersion: result.policyVersion,
    mode: 'shadow_only',
    readOnly: true,
    promotionAllowed: false,
    reason: result.reason,
    segmentsInspected: result.segmentsInspected,
    counts,
    suggestions,
  };
}
