// Classify upstream evidence independently of the local adoption decision.
// A remote commit never, by itself, proves an applicable update.
export function classifyUpstreamStatus({ advanced, scopedChanges = null, decision }) {
  if (typeof advanced !== 'boolean' ||
      !['current', 'not-applicable', 'separate-pr', 'update-pending'].includes(decision) ||
      ![null, true, false].includes(scopedChanges)) {
    throw new TypeError('invalid upstream classification inputs');
  }
  if (!advanced && scopedChanges !== null) {
    throw new TypeError('scoped changes are only meaningful for an advanced remote');
  }

  const pending = decision === 'update-pending';
  if (!advanced) return pending ? 'PENDING' : 'CURRENT';
  if (scopedChanges === false) return pending ? 'PENDING' : 'REMOTE_ADVANCED';
  if (scopedChanges === true) return 'SCOPE_CHANGED';
  return 'REVIEW';
}

export function needsUpstreamAction(status) {
  return !['CURRENT', 'REMOTE_ADVANCED'].includes(status);
}
