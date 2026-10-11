function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function buildCodexIsolatedJudgeExecArgs({
  workspace,
  resultPath,
  reasoningEffort = 'medium',
  model = null,
} = {}) {
  if (!nonEmpty(workspace)) throw new TypeError('workspace must be a non-empty string');
  if (!nonEmpty(resultPath)) throw new TypeError('resultPath must be a non-empty string');
  if (!['low', 'medium', 'high'].includes(reasoningEffort)) {
    throw new TypeError('reasoningEffort must be low, medium, or high');
  }
  if (model !== null && !nonEmpty(model)) {
    throw new TypeError('model must be null or a non-empty string');
  }

  const args = [
    'exec',
    '--cd', workspace,
    '--ephemeral',
    '--json',
    '--output-last-message', resultPath,
    '-c', 'model_reasoning_effort="' + reasoningEffort + '"',
  ];
  if (model) args.push('--model', model);
  args.push('-');
  return args;
}
