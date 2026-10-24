# Reference Graph P17 Local Runtime Actuator Design

## Intent

P17 binds the already-built P15 activation executor and P16 durable nonce ledger to the real production control plane used by AgentHub on the user's machine: the local `~/.agents` runtime. The phase must make an authorized Quick-only Reference Graph activation apply immediately to future design-reference queries without inventing a server deployment provider or relying on stale inherited process environment.

## Current state

- Production design-reference queries are invoked on demand from `~/.agents` with `node knowledge/design-references/scripts/query.mjs ...`.
- `query.mjs` intentionally keeps the P11 activation surface exact: `REFERENCE_GRAPH_QUICK_RUNTIME=graph`; absent/other values remain legacy.
- Standard and Deep remain legacy-only.
- P15 already verifies the external Ed25519 grant, consumes the nonce before mutation, probes the runtime, and rolls back on failure.
- P16 already provides irreversible one-shot nonce consumption in the dedicated Supabase project.
- OpenCodex/Codex processes can retain stale inherited environment, so persistent Windows user-environment mutation plus client restart is not a reliable immediate actuator.
- AgentHub already stores mutable per-user runtime state under `%LOCALAPPDATA%\agent-hub` on Windows and XDG state on POSIX.

## Goals

1. Preserve the P11 runtime contract: `query.mjs` itself continues to consume only `REFERENCE_GRAPH_QUICK_RUNTIME`.
2. Add a local projection layer used by the documented design-reference query path. It reads exact durable local actuator state and projects only `REFERENCE_GRAPH_QUICK_RUNTIME=graph` into the child `query.mjs` process when activated.
3. Bind P15 callbacks to real implementations:
   - `readActivationState`
   - `consumeGrantNonce` via `ReferenceGraphSupabaseStore.consumeActivationGrantNonceP16`
   - `applyActivation`
   - `probeRuntime`
   - `rollbackActivation`
4. Use atomic local state replacement with change IDs and fail closed on malformed/tampered state.
5. Probe Quick plus Standard plus Deep through the same production projection path after mutation and after rollback.
6. Leave live production unchanged until a real external authority enrollment and signed grant exist.

## Non-goals

- No external private key or signer.
- No fabricated authority enrollment or grant.
- No activation merely for testing.
- No new Supabase migration.
- No Docker/Vercel/Railway/VPS deployment path.
- No direct change to P11 selection semantics.
- No permanent global process-environment mutation.

## Approaches considered

### A. Persistent Windows user environment + restart

Rejected. Windows user-environment changes do not update already-running OpenCodex/Codex parents, and the observed `ocx sync --restart-codex` path has not reliably restarted all stale app-server processes. Correctness would depend on host lifecycle behavior outside this repository.

### B. Teach `query.mjs` to read a local activation file directly

Rejected. This would create a second activation surface inside P11 and weaken the deliberately frozen `REFERENCE_GRAPH_QUICK_RUNTIME` contract.

### C. Local projection wrapper around `query.mjs` — chosen

The documented design-reference command moves to a wrapper. The wrapper reads exact P17 actuator state, constructs a child environment from the caller environment, and either removes `REFERENCE_GRAPH_QUICK_RUNTIME` for legacy or sets it to exact `graph` for activated state before spawning the unchanged `query.mjs`. This preserves P11 while avoiding parent-process restart requirements.

## Runtime state

Default path:

- Windows: `%LOCALAPPDATA%\agent-hub\reference-graph\activation-state-v1.json` (fall back to `%USERPROFILE%\AppData\Local\agent-hub\...` when `LOCALAPPDATA` is absent).
- POSIX: `${XDG_STATE_HOME:-~/.local/state}/agent-hub/reference-graph/activation-state-v1.json`.
- Tests/operators may override with `AGENT_HUB_REFERENCE_GRAPH_STATE`.

Exact JSON schema:

```json
{
  "schema": "reference-graph.p17-local-activation-state.v1",
  "mode": "legacy|graph",
  "change_id": "uuid",
  "consumption_id": "string|null",
  "grant_payload_hash": "64-lowercase-hex|null",
  "updated_at": "canonical-UTC-timestamp"
}
```

Malformed state never enables graph. Missing state is legacy. Applying graph atomically writes a complete `graph` state via same-directory temporary file plus rename. Rollback atomically writes a complete `legacy` state and returns a fresh rollback change ID. The runtime state contains no private key, raw signed grant, publishable/service-role key, or caller-supplied authorization boolean.

## Projection wrapper

Create `knowledge/design-references/scripts/query-runtime.mjs`.

- Parse no new business arguments; forward all arguments byte-for-byte/order-preserving to `query.mjs`.
- Read P17 state through the local actuator module.
- For `graph`, spawn Node with `REFERENCE_GRAPH_QUICK_RUNTIME=graph`.
- For legacy/missing/malformed state, spawn Node with the activation variable removed.
- Inherit stdout/stderr and return the exact child exit code.
- Never print state contents or credentials.

The documented query command in `skills/design-with-ai/references/reference-library.md`, `knowledge/build-index.mjs`, generated `knowledge/index.json`, and `knowledge/INDEX.md` moves to `query-runtime.mjs`.

## P15 live adapter

Create `reference-graph/p17-local-runtime-actuator.mjs` for state path resolution, exact validation, atomic writes, apply, rollback, and production probe helpers.

Create `reference-graph/p17-activation-runner.mjs` that composes:

- P15 `executeP15Activation()`;
- P16 Supabase nonce consumption;
- the P17 local actuator;
- real Quick/Standard/Deep probe execution through `query-runtime.mjs` using a bounded fixed fixture request suitable for exact source/parity assertions.

The runner must remain unusable for activation without the existing external P13/P14 evidence, enrollment manifest, signed grant, Supabase URL, and service-role credential. It never generates any of them.

## Verification and evidence

CI uses only disposable temporary state files and fixture/mock Supabase transport for mutation tests. It proves:

- missing/malformed local state projects legacy;
- graph state projects only exact `REFERENCE_GRAPH_QUICK_RUNTIME=graph` to the child;
- caller-supplied conflicting activation env cannot override durable state;
- apply and rollback are atomic and return valid change IDs;
- P15 binds P16 consume exactly once before local mutation;
- graph probe requires Quick Reference Graph plus Standard/Deep legacy;
- failed post-activation probe rolls back and verifies legacy;
- no private key/signing path is introduced;
- repository default remains legacy.

P17 live evidence is read-only: inspect the production local-state path only when available from an operator-run receipt. This repository phase does not fabricate a live local state reading from GitHub CI. Until the real external grant ceremony and local operator execution occur, evidence must report `activation_performed=false`, `production_source=legacy-control`, and the external blocker.
