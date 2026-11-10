import { createHash } from 'node:crypto';

export const CLAUDE_CODE_HARNESS = 'claude-code';

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function digest(...parts) {
  const hash = createHash('sha256');
  for (const part of parts) {
    hash.update(String(part ?? ''), 'utf8');
    hash.update('\0', 'utf8');
  }
  return hash.digest('hex').slice(0, 24);
}

function promptTurnId(event) {
  if (nonEmpty(event.prompt_id)) return 'prompt:' + event.prompt_id;
  return 'prompt:' + digest(event.session_id, event.prompt);
}

export function normalizeClaudePromptEvent(event) {
  if (
    !event
    || typeof event !== 'object'
    || event.hook_event_name !== 'UserPromptSubmit'
    || nonEmpty(event.turn_id)
  ) {
    return event;
  }

  return {
    ...event,
    turn_id: promptTurnId(event),
  };
}

export function normalizeClaudeStopEvent(event) {
  if (
    !event
    || typeof event !== 'object'
    || (event.hook_event_name !== 'Stop'
      && event.hook_event_name !== 'SubagentStop')
  ) {
    return event;
  }

  const agentId = event.hook_event_name === 'SubagentStop'
    ? String(event.agent_id ?? '')
    : 'root';
  const turnId = nonEmpty(event.turn_id)
    ? event.turn_id
    : (nonEmpty(event.prompt_id)
      ? 'prompt:' + event.prompt_id
      : 'stop:' + digest(
        event.session_id,
        agentId,
        event.last_assistant_message,
      ));

  return {
    ...event,
    turn_id: turnId,
    agent_type: event.hook_event_name === 'SubagentStop'
      ? (nonEmpty(event.agent_type) ? event.agent_type : 'subagent')
      : 'root',
  };
}
