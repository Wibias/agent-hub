# Observability verification

Instrumentation is code and must be tested against actual emitted evidence.

## Proof checklist

Choose representative paths for the feature and verify the relevant signals:

- **Structured logs:** trigger a success and an expected failure/degradation; query by correlation identifier; confirm event names and fields are structured and sensitive fields are absent/redacted.
- **Metrics:** generate representative traffic/work; verify expected series appear; confirm labels are bounded and values change in the expected direction.
- **Traces:** follow at least one operation through each boundary the design claims to trace; confirm parent/child continuity and meaningful span names/attributes.
- **Alerts:** test-fire or safely lower the threshold in an isolated environment when the platform permits; verify delivery and the runbook/first-action link. Restore the threshold afterward.

## Result semantics

- `pass` - the required signal was observed and matched the contract.
- `fail` - the signal was observed but was wrong/missing/incomplete.
- `blocked` - the required runtime/backend/access path could not be exercised.

A source-only review can report risks and missing instrumentation but cannot produce a live `pass`.

## Evidence discipline

Record the environment, operation exercised, relevant query/dashboard/trace identifier or artifact path, and important caveats. Never copy secrets or sensitive payloads into the evidence report.
