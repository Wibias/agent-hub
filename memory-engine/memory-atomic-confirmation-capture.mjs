import { inspectMemoryTextSensitivity } from './index.mjs';

/** Exact, opt-in direct-user command. Never turns a chat transcript into Evidence. */
const RESERVED_PREFIX = /^\s*memory\s+confirm\s+permanent\s+project\s+rule\b/iu;
const COMMAND = /^MEMORY CONFIRM PERMANENT PROJECT RULE (~d[0-9a-f]{16}) FOR ([^\s@:]+)@([^\s:]+): ([^\r\n]+)$/u;

export function isAtomicRuleConfirmationAttempt(prompt) {
  return typeof prompt === 'string' && RESERVED_PREFIX.test(prompt);
}

export function parseAtomicRuleConfirmationPrompt(prompt) {
  if (typeof prompt !== 'string'
    || prompt.length < 80 || prompt.length > 1024
    || prompt !== prompt.trim() || /[\r\n\u0000-\u001f\u007f]/u.test(prompt)) {
    return null;
  }
  const matched = COMMAND.exec(prompt);
  if (!matched) return null;
  const [, draftRef, projectId, branch, ruleText] = matched;
  if (ruleText.length < 40 || ruleText.length > 500
    || ruleText !== ruleText.trim()
    || /[@:]/u.test(projectId)
    || inspectMemoryTextSensitivity(ruleText).containsSecret
    || /\b(?:api[_-]?key|access[_-]?token|password|passwort)\s*[:=]/iu.test(ruleText)) {
    return null;
  }
  return {
    mode: 'atomic_rule_confirm',
    draftRef, projectId, branch, ruleText,
  };
}

/**
 * Validate the stored, protocol-classified Evidence, never trust the adapter's
 * request payload as proof of successful capture.
 */
export function verifyCapturedAtomicConfirmationEvidence(evidence, {
  command, projectId, branch, sessionId, evidenceId,
} = {}) {
  const parsed = parseAtomicRuleConfirmationPrompt(command);
  if (!parsed || parsed.projectId !== projectId || parsed.branch !== branch
    || !evidence || evidence.id !== evidenceId
    || evidence.project_id !== projectId || evidence.branch !== branch
    || evidence.harness !== 'codex' || evidence.source_kind !== 'session'
    || evidence.authority_class !== 'user_direct'
    || evidence.sensitivity !== 'normal'
    || evidence.session_id !== sessionId
    || evidence.source_ref !== 'session:' + sessionId
    || evidence.content_redacted !== command
    || evidence.metadata?.event_type !== 'user_prompt'
    || evidence.metadata?.hook_event_name !== 'UserPromptSubmit'
    || evidence.metadata?.explicit_memory !== true
    || evidence.metadata?.explicit_memory_mode !== 'atomic_rule_confirm'
    || evidence.metadata?.atomic_rule_draft_ref !== parsed.draftRef
    || evidence.path !== null) {
    return false;
  }
  return true;
}
