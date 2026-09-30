# Cross-Harness Memory Protocol Design

Date: 2026-09-30

Status: implemented on main; original design retained for historical context

## Implementation status

The production integration track shipped as designed:

- PR #18, `feat: add evidence-first memory primitives`, added standalone Evidence capture and later Claim assertion without weakening legacy ingest atomicity.
- PR #19, `feat: add frozen memory protocol v1`, added the transport-neutral versioned protocol with fail-closed authority and Claim-assertion boundaries.
- PR #20, `feat: add Codex memory hook adapter`, added the first real host adapter using the documented Codex `UserPromptSubmit` command-hook schema, Git blob freshness refresh, bounded context injection, explicit project identity, and fail-soft behavior.

The first production adapter deliberately does not parse transcripts, persist every tool result, summarize sessions, or create Claims automatically. Direct prompt capture is off by default and, when enabled, stores Evidence only.

Additional host adapters are not roadmap blockers. Add them only after their current official event/config schemas are verified.


## Context

The reference memory engine now passes Memory Ratchet M01-M15 and has bounded hybrid retrieval with a pinned local E5 provider. The remaining roadmap gap is production cross-harness integration.

The current implementation proves the semantics through `tests/memory-ratchet/reference-adapter.mjs`, but that adapter is fixture-specific:

- setup depends on prepared Ratchet cases;
- repository paths and Git state come from fixture inputs;
- event types and lifecycle relations are already normalized by the fixture;
- it is not a stable production transport for Codex, Claude Code, Cursor, or another host.

There is also no production consumer of `memory-engine/` outside tests and documentation.

This matters because a test adapter can prove engine correctness without proving that real harness events can enter and leave the engine without weakening the trust model.

## New host evidence

The prior runtime capability review for Codex is stale for lifecycle hooks.

Current OpenAI documentation now describes Codex hooks with stable event JSON for:

- `SessionStart`;
- `UserPromptSubmit`;
- `PreToolUse`;
- `PostToolUse`;
- `PreCompact`;
- `PostCompact`;
- `Stop`;
- `SessionEnd`;
- subagent lifecycle events.

Codex command hooks receive JSON on stdin. `SessionStart` and `UserPromptSubmit` can return `hookSpecificOutput.additionalContext`, which makes bounded memory recall injection possible without parsing the transcript.

Codex plugin packages can also ship `hooks/hooks.json` and hook scripts.

Sources:

- https://developers.openai.com/docs/hooks
- https://developers.openai.com/plugins/build/plugins

The Codex transcript path is explicitly documented as a convenience rather than a stable hook interface. The first adapter must therefore use event fields, not transcript parsing, as its protocol source.

## Problem

The engine's current write API is:

```js
engine.ingest({ evidence, claim, lifecycle })
```

That API is correct for already-normalized Ratchet events, but it is too coupled for a real host boundary.

A real host can observe facts before it can safely assert a durable claim.

Examples:

- `UserPromptSubmit` proves what the user directly typed. It does not prove that every prompt is a durable project decision.
- `PostToolUse` proves a tool result was observed. It does not make that result project policy.
- an assistant-generated summary is an agent inference unless a stronger source independently supports it.
- a repository read can prove file content at a revision, but repository relevance does not automatically grant repository authority.

Automatically turning each observed host event into an active claim would collapse Evidence and Claim again and reintroduce the exact authority failures that Memory Ratchet rejected.

## Design decision

Add a small, versioned, transport-neutral production protocol that keeps host event capture separate from claim assertion.

The first integration sequence is:

```text
trusted host event
  |
  v
capture evidence
  |
  +---- immutable evidence only
  |
  v
optional explicit claim assertion
  |
  +---- lifecycle / authority-safe claim
  |
  v
bounded recall
```

Host adapters translate native events into this protocol.

The engine remains the canonical correctness core.

## Protocol version

The first protocol version is:

```text
memory.protocol.v1
```

Every transport request includes:

```json
{
  "protocol": "memory.protocol.v1",
  "operation": "...",
  "request_id": "...",
  "payload": {}
}
```

Every response includes:

```json
{
  "protocol": "memory.protocol.v1",
  "request_id": "...",
  "ok": true,
  "result": {}
}
```

Failures use:

```json
{
  "protocol": "memory.protocol.v1",
  "request_id": "...",
  "ok": false,
  "error": {
    "code": "...",
    "message": "..."
  }
}
```

The transport may later be CLI JSON, MCP, or another harness-native mechanism. The semantic contract must not depend on that choice.

## V1 operations

The production protocol should stay smaller than the internal engine API.

### `capture_evidence`

Persist one immutable observation without creating an active claim.

Required concepts:

```text
project_id
harness
session_id
source_kind
source_ref
captured_at
branch
commit_sha
path
blob_oid
content
metadata
```

The caller does not supply `authority_class`.

Authority is derived by the trusted adapter/policy layer from the observed channel.

The result returns the canonical evidence ID and derived authority class.

### `assert_claim`

Create a claim from an already-recorded evidence ID.

Required concepts:

```text
evidence_id
kind
subject
predicate
value
branch_scope
created_at
lifecycle
```

This operation never rewrites the source evidence.

An agent-created interpretation remains `agent_inference` unless the asserted value is directly grounded by stronger evidence under a defined promotion rule.

The first implementation must not provide a generic caller-controlled authority override.

### `recall`

Return bounded current recall for an explicit:

```text
project_id
branch
revision_sha
query
```

The normal output limits remain:

- at most 10 items;
- at most 16 KiB serialized payload.

A host adapter may convert this result into its native context-injection format.

### `history`

Return the same bounded view with historical lifecycle state enabled.

This is a protocol operation rather than a separate storage model.

### `authorize`

Evaluate an already-recorded structured action approval.

This may consume a one-time approval exactly as the current engine does.

The protocol must not expose approval minting through generic recalled text.

### `export`

Return canonical portable state.

Derived indexes and embeddings remain excluded.

### `import`

Restore canonical portable state into an otherwise empty store using the existing validation rules.

### `status`

Return bounded operational metadata such as:

```text
project count
evidence count
claim count
open conflict count
approval count
derived-index availability
protocol version
```

Status must not dump remembered content.

## No generic `forget` operation in V1

The synthesis proposed a protocol "roughly" containing `forget`.

A destructive generic delete is not safe to freeze yet.

The canonical model is append-only Evidence plus explicit Claim lifecycle. Deleting an Evidence row can destroy provenance for lifecycle, approvals, or historical truth.

V1 therefore uses existing lifecycle semantics:

- supersede;
- reject;
- expire when supported by claim validity;
- revoke approval.

A future privacy deletion operation needs a separate design with referential-integrity and audit semantics. It must not be disguised as ordinary claim rejection.

## Trust boundary

The protocol must preserve this rule:

> Relevance never upgrades authority.

The protocol caller may provide content and operation intent. It may not choose its own authority class.

Authority comes from the adapter-observed source channel plus repository policy.

Initial channel mapping remains consistent with the existing authority policy:

- direct user decision/rejection/approval event -> `user_direct`;
- trusted repository policy path -> `repo_trusted`;
- tool result / code observation -> `tool_observation`;
- assistant proposal / inference -> `agent_inference`;
- other repository/external content -> `external_untrusted` or `unclassified`.

Host-specific event names must be normalized before they reach engine claim logic.

### Process-level limitation

This boundary protects against untrusted content being promoted by normal adapter behavior. It is not a sandbox boundary against an arbitrary local process that can modify the memory database or adapter files directly.

Host process isolation and filesystem permissions remain separate concerns.

## Evidence-first engine change

The current schema already permits Evidence to exist independently of a Claim. The public API does not.

The first implementation therefore needs an explicit Evidence write operation such as:

```js
memory.recordEvidence(evidence)
```

Requirements:

- same pre-storage redaction as `ingest`;
- same project and authority validation;
- one transaction;
- no FTS or embedding row because no Claim exists yet;
- duplicate IDs fail;
- canonical export includes the evidence normally;
- recall cannot surface it until a Claim references it.

The existing `ingest({ evidence, claim, lifecycle })` remains supported and atomic.

A later claim-assertion operation may attach a Claim to an existing Evidence record without rewriting that Evidence.

## Claim assertion from existing Evidence

The next engine primitive should create a Claim from an existing evidence ID.

Conceptually:

```js
memory.assertClaim({
  evidenceId,
  claim,
  lifecycle,
})
```

Requirements:

- evidence must exist;
- claim project is inherited from evidence, not caller-selected independently;
- branch scope must be compatible with the evidence/project rules;
- lifecycle targets remain in the same project and branch as today;
- FTS is written only when the Claim transaction commits;
- secret-bearing content cannot be reintroduced through claim fields;
- existing `ingest` behavior remains backward compatible.

The implementation should share internal transaction helpers instead of duplicating lifecycle SQL.

## Codex adapter V1

Codex is the first real adapter because the host now documents the required lifecycle surface.

### Recall path

Use `UserPromptSubmit` for query-time recall.

Inputs supplied by Codex include:

- `session_id`;
- `turn_id`;
- `cwd`;
- `prompt`;
- `hook_event_name`.

The adapter resolves explicit configured project identity plus current Git branch/revision, calls protocol `recall`, and returns only a bounded context summary through:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "..."
  }
}
```

Do not inject raw canonical exports or unbounded history.

### Session-start path

`SessionStart` may inject a small current-state capsule when configured.

It must not automatically enumerate unrelated projects.

### Direct user evidence capture

A `UserPromptSubmit` hook may record the exact direct prompt as immutable Evidence only.

It must not automatically create an active project-policy Claim.

Whether direct-prompt capture is enabled is an explicit adapter setting because many prompts are ephemeral and should not become durable memory by default.

Default for V1: **capture disabled** until the explicit claim workflow is present.

### Tool observations

Do not persist every `PostToolUse` result by default.

Tool output can be large, secret-bearing, noisy, and transient. The first adapter may use tool events for explicitly requested evidence capture only.

### Session end

Do not parse Codex transcript files for canonical memory in V1.

The official documentation says transcript format is not a stable hook interface.

Do not use `SessionEnd` for automatic summarization or autonomous memory consolidation.

## Project identity and database location

Filesystem checkout paths are not stable project identity.

The adapter requires an explicit or canonical repository identity.

Preferred project identity order:

1. explicitly configured project ID;
2. normalized canonical repository remote when a verified helper is added;
3. otherwise fail closed rather than using an absolute checkout path.

The database path is configuration, not project identity.

For cross-harness use, all adapters that should share memory must point to the same configured database.

Do not hide the database below a host-specific cache directory if that would prevent another harness from using the same canonical store.

## Repository freshness

A host adapter that recalls repository-grounded claims must refresh path state before current recall.

The existing Ratchet reference adapter demonstrates the correct Git behavior with `git ls-tree`.

Production integration should extract this into a small reusable Git freshness helper rather than import the test adapter.

The memory engine itself remains Git-provider agnostic.

## Hybrid provider boundary

The protocol may receive an optional hybrid retriever.

Correctness must not depend on it.

If the E5 provider is unavailable:

- canonical writes still work;
- lexical recall still works;
- protocol responses remain valid.

No protocol operation may trigger an implicit model download.

## Security and privacy

Required:

- secret redaction before Evidence persistence;
- no raw transcript ingestion;
- no caller-controlled authority class;
- no automatic external/destructive action approval;
- no model network access during normal recall;
- bounded context injected into hosts;
- no cross-project recall;
- repository freshness before current repository claims can surface.

## Failure behavior

Adapter failure must fail soft for ordinary host use:

- memory recall failure does not block a user prompt;
- evidence-capture failure does not make the host session fail;
- canonical database corruption is surfaced explicitly;
- action authorization remains fail closed;
- a protocol version mismatch returns a structured error.

A hook must never return fabricated memory when the store is unavailable.

## Testing strategy

### Engine tests

Add RED -> GREEN coverage for:

1. standalone Evidence persistence;
2. standalone Evidence secret redaction;
3. standalone Evidence export/import;
4. standalone Evidence is not recallable without a Claim;
5. Claim assertion from existing Evidence;
6. lifecycle operations remain atomic;
7. existing `ingest` remains backward compatible.

### Protocol tests

Prove:

1. exact protocol version validation;
2. deterministic operation dispatch;
3. caller cannot set `authority_class`;
4. project/branch scope is preserved;
5. `recall` and `history` remain bounded;
6. structured errors do not leak secrets;
7. export/import round-trip keeps standalone Evidence;
8. status reveals counts, not memory content.

### Adapter tests

For Codex fixture JSON matching the documented hook schema:

1. `UserPromptSubmit` recall emits valid `additionalContext`;
2. missing memory configuration returns no injected memory rather than blocking;
3. project scope cannot be widened by prompt text;
4. transcript contents are never parsed;
5. direct-prompt persistence is disabled by default;
6. when explicit direct-prompt capture is enabled, the prompt becomes Evidence only;
7. current Git revision refreshes repository freshness before recall.

### Ratchet regression

M01-M15 remain unchanged and green.

The frozen Ratchet fixture must not be weakened to make host integration easier.

## Delivery sequence

### PR 1: Evidence-first engine primitives

Implement:

- `recordEvidence`;
- `assertClaim` from existing evidence;
- internal transaction helpers;
- export/import regression for unclaimed Evidence;
- backward compatibility for `ingest`.

No host-specific code.

### PR 2: Frozen protocol V1

Implement:

- versioned request/response envelope;
- `capture_evidence`;
- `assert_claim`;
- `recall`;
- `history`;
- `authorize`;
- `export`;
- `import`;
- `status`;
- protocol tests.

No Codex-specific fields in the protocol.

### PR 3: Codex adapter

Implement:

- current documented hook JSON parser;
- bounded `UserPromptSubmit` recall injection;
- optional Evidence-only direct-prompt capture, default off;
- reusable Git freshness helper;
- host capability registry update with reviewed 2026-09-30 sources;
- adapter tests using documented event fixtures.

Do not add transcript parsing or automatic memory summarization.

### Later adapters

Add Claude Code, Cursor, or another host only after its current official event/config schema is verified.

Each adapter maps native fields into the same protocol. It does not fork canonical memory semantics.

## Acceptance criteria

The cross-harness integration track is complete when:

- the production engine can persist Evidence without immediately asserting a Claim;
- claims can be attached later without rewriting source Evidence;
- a versioned portable protocol exists outside the Ratchet test tree;
- generic callers cannot self-assign authority class;
- current recall remains project/branch/freshness safe;
- Codex can inject bounded recall through documented hooks;
- Codex hook failure does not block normal prompts;
- raw transcript parsing is not required;
- normal recall remains offline;
- M01-M15 and hybrid semantic evaluation remain green.

## Non-goals

This track does not add:

- autonomous summarization;
- background reflection;
- automatic persistence of every prompt or tool result;
- transcript scraping;
- a vector database or ANN index;
- GPU requirements;
- generic destructive forgetting;
- host-specific semantics in the canonical engine.

## Conclusion

The remaining roadmap gap is no longer "build more retrieval."

The missing piece is a trustworthy bridge from real harness events into the already-correct engine.

The correct first change is Evidence-first capture. Without that, a host adapter would have to turn every observation into a Claim and would weaken the architecture to make integration convenient.
