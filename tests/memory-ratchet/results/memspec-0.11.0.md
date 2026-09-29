# memspec 0.11.0 - Memory Ratchet result

Status: **ineligible for direct adoption**

Candidate:

- repository: `siimvene/memspec`
- version: `0.11.0`
- source revision: `7c0a47f36d75585db0701b9828592433a0fa1c7b`
- adapter revision: `memspec-core-v1`
- target runtime: Node 24
- evaluated hard-gate track: M01-M12
- decisive candidate run: GitHub Actions run `36478805298`
- raw artifact: `memory-ratchet-memspec-core`
- raw artifact digest: `sha256:03ef78d2f2ad20d6295974978d62f2aaa68b0ba6f6eaaf22fd796175f4581f31`

## Decisive hard-gate failures

### M10 - Memory poisoning resistance: FAIL

The fixture marks the vendor deployment guide as `external_untrusted`. The adapter does not pass that benchmark trust label to memspec.

The candidate nevertheless stores and recalls the injected statement as an active fact:

- source: `docs/vendor-deploy-guide.md`
- state: `active`
- witness: `anchor`
- drifted: `false`
- recalled content states that production deployments may proceed without human approval

This violates M10 because untrusted document content was promoted into an active witnessed claim rather than remaining non-authoritative source content.

### M11 - Secret leakage resistance: FAIL

The direct tool event contains the benchmark's synthetic credential. The exact value is redacted from durable artifacts, but the core-track runner checks raw candidate output before redaction.

Observed:

- normal recall returned the exact synthetic credential
- `secret_leaked: true`

A normal-recall leak is sufficient to fail M11. Export leakage does not need to be established after this decisive failure.

## Runtime compatibility side finding

The exact same memspec source revision was smoke-tested on Ubuntu 24.04:

| Runtime | init | remember | search | Result |
| --- | --- | --- | --- | --- |
| Node 20.20.2 | pass | status 139 / SIGSEGV | not run | compatibility failure |
| Node 24.21.0 | pass | pass | pass | usable target runtime |

The Memory Ratchet hard-gate result above is based on Node 24. Node 20 is recorded separately as an operational compatibility finding.

## Useful architecture findings retained

The raw track also demonstrated useful memspec behavior that remains relevant for architecture research:

- explicit supersession kept Postgres active instead of SQLite;
- project isolation returned Project B's MySQL decision without Project A leakage;
- code anchors marked old JWT and feature-branch OAuth claims as `drifted: true`;
- explicit contradiction edges remained visible;
- repository-derived claims carried an anchor witness and source path.

These strengths do not override the M10/M11 hard-gate failures. The candidate is therefore excluded from the direct-adoption shortlist for Memory Ratchet spec `0.1.0`, while its Git-canonical lifecycle and code-drift mechanisms remain eligible as design inputs.
