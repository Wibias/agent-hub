function optionalNonNegativeInteger(value, name, { required = false } = {}) {
  if (value === undefined || value === null) {
    if (required) throw new TypeError(name + ' must be a non-negative integer');
    return null;
  }
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(name + ' must be a non-negative integer');
  }
  return value;
}

function normalizeUsage(usage) {
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) {
    throw new TypeError('turn.completed usage must be an object');
  }
  return {
    input_tokens: optionalNonNegativeInteger(
      usage.input_tokens,
      'input_tokens',
      { required: true },
    ),
    cached_input_tokens: optionalNonNegativeInteger(
      usage.cached_input_tokens,
      'cached_input_tokens',
      { required: true },
    ),
    cache_write_input_tokens: optionalNonNegativeInteger(
      usage.cache_write_input_tokens,
      'cache_write_input_tokens',
    ),
    output_tokens: optionalNonNegativeInteger(
      usage.output_tokens,
      'output_tokens',
      { required: true },
    ),
    reasoning_output_tokens: optionalNonNegativeInteger(
      usage.reasoning_output_tokens,
      'reasoning_output_tokens',
    ),
  };
}

export function parseCodexExecJsonUsage(stdout) {
  if (typeof stdout !== 'string' || stdout.length === 0) return null;

  let last = null;
  for (const rawLine of stdout.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line.startsWith('{')) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event?.type !== 'turn.completed') continue;
    last = normalizeUsage(event.usage);
  }
  return last;
}
