# Memory Engine

Portable reference implementation derived from Memory Ratchet 0.1.0 research.

This directory is implementation code. It is intentionally separate from the hub's `memory/` directory, which remains reserved for episodic lessons.

## Runtime

Node.js 24 or newer is required.

The foundation uses Node's built-in `node:sqlite` module so the hub does not need a native npm dependency or a platform-specific SQLite package.

## Current scope

The reference implementation currently owns:

- canonical SQLite storage in WAL mode;
- stable project registration;
- append-only evidence records, including Evidence-only capture before Claim assertion;
- deterministic claim lifecycle for `supersede` and `reject`;
- strict project and branch filtering before lexical ranking;
- current versus historical recall;
- durable provenance fields;
- mandatory secret redaction before canonical storage or indexing;
- Git path/blob freshness checks for repository-grounded evidence;
- explicit claim-conflict edges;
- explicit source-authority classes;
- retrieval separated from use-specific reliance;
- structured, scoped action approval capabilities;
- atomic one-time approval consumption and revocation;
- a rebuildable FTS5 lexical index;
- deterministic redacted embedding documents;
- rebuildable semantic vector rows keyed by exact model ID and revision;
- correctness-filtered semantic candidates that reuse project, branch, lifecycle, and Git-freshness eligibility;
- deterministic Reciprocal Rank Fusion (RRF) with a fixed `k = 60`;
- an asynchronous `HybridMemoryRetriever` with injected embedder ownership;
- lexical fallback when the semantic provider is missing or query embedding fails;
- explicit hybrid recall caps of at most 10 items and 16 KiB serialized payload;
- portable canonical export/import with derived-state rebuild;
- interrupted-write recovery through transactional canonical state and derived-state rebuild.

The concrete local E5 provider is now isolated behind the hybrid embedder contract:

- `@huggingface/transformers@4.3.0`;
- model `intfloat/multilingual-e5-small`;
- revision `6a0d452a575215f80b8f66276dd4ee5d504942c6`;
- ONNX graph `model_qint8_avx512_vnni.onnx`;
- qint8 model weights with 384-dimensional Float32 normalized embedding output;
- CPU execution;
- mean pooling with normalized output;
- local-files-only normal runtime.

Real-model semantic evaluation is available through the explicit `Memory semantic eval` workflow. Normal tests and normal recall do not download the model.

## Canonical versus derived state

Canonical state:

- `project_registry`
- `evidence`
- `claims`
- `lifecycle_events`
- `conflicts`
- `approvals`

Derived state:

- `repository_path_state`
- `claim_fts`
- `claim_embeddings`

Derived state is never the source of truth. Claim lifecycle, observed repository blob identity, and provenance remain valid even if freshness snapshots or search indexes are rebuilt later.

`repository_path_state` is a rebuildable snapshot of the repository revision being queried. It stores the current commit and path object ID used to decide whether path-grounded evidence is still eligible for current recall. Portable export must not treat this snapshot as durable memory truth.

## Portable export and rebuild

`exportCanonical()` emits only canonical memory state. It includes projects, evidence, claims, lifecycle events, conflicts, and approvals.

It deliberately excludes:

- `claim_fts`;
- `repository_path_state`;
- `claim_embeddings`.

Those are derived state and are rebuilt instead of trusted during import. Canonical import rebuilds the lexical FTS index synchronously, but semantic vectors remain empty until an explicit asynchronous `HybridMemoryRetriever.rebuildSemanticIndex(...)` runs with a configured embedder.

`importCanonical(...)` requires an otherwise empty memory store. The import validates authority classes, claim states, JSON fields, approval use counts, and secret boundaries before writing. Canonical rows and the rebuilt FTS index are committed in one transaction.

Claims are restored in two phases so `superseded_by_claim_id` references remain valid even when the target claim appears later in export order.

Repository freshness snapshots remain empty after import. The reference adapter recomputes them against the revision being queried, so portable restore cannot accidentally preserve stale "current" state from another checkout.

A failed import rolls back instead of leaving a partially restored canonical store.

## Git blob freshness

Repository-grounded evidence can record both an immutable commit SHA and the Git object ID for its source path. Current recall is fail-closed for path-grounded evidence:

- no recorded current path state means the evidence is not current truth;
- the same blob ID at a later commit remains fresh;
- a changed blob ID marks the old observation stale for current recall;
- a deleted path is stale because its current blob ID is null;
- historical recall keeps the old evidence and reports `fresh`, `stale`, or `unchecked` freshness metadata.

This intentionally compares the path object ID, not only the commit SHA. Unrelated commits therefore do not invalidate unchanged repository evidence.

The reference Ratchet adapter resolves object IDs with `git ls-tree` at the immutable observation revision and again at the requested current revision. The engine itself stays Git-provider agnostic.

## Reference adapter trust boundary

The Memory Ratchet reference adapter deliberately does **not** consume the fixture's hidden `trust` oracle.

Authority is derived from observable source channel, event semantics, and an explicit repository-policy allowlist:

```text
user_direct
repo_trusted
tool_observation
agent_inference
external_untrusted
unclassified
```

Repository relevance does not grant repository authority. Only declared policy surfaces such as accepted ADRs and configured project-policy files become `repo_trusted`; other repository documents remain `external_untrusted`.

Retrieval and reliance are separate. Retrieved evidence can remain visible while `evaluateReliance` refuses to use it for a stronger purpose:

- planning may inspect all authority classes;
- normal answers may rely on `user_direct`, `repo_trusted`, and `tool_observation`;
- project policy may rely only on `user_direct` and `repo_trusted`;
- external and destructive actions are never authorised by ordinary reliance; they require a matching structured approval capability through `authorizeAction(...)`.

Authority never bypasses Git freshness. Repository-grounded evidence must first pass the revision-bound blob check before it can enter current recall and therefore before reliance can select it.

Project identity is likewise stable and path-independent. Temporary checkout paths are not used as canonical repository identity.

## Action approval boundary

Action approval is a separate capability API. Normal recall cannot authorise an external or destructive action.

An approval records exact structured scope:

```text
project
actor/source
action
target
environment
artifact
constraints
issued_at
expires_at
max_uses
uses
revoked_at
source_evidence_id
```

Only `user_direct` evidence can mint an approval. `agent_inference`, repository text, tool observations, and external documents cannot create action authority.

`authorizeAction(...)` requires an exact action, target, environment, and artifact match. Required structured constraints must also match. Expired, revoked, exhausted, or not-yet-valid approvals fail closed.

A successful `authorizeAction(...)` always consumes one use in the same immediate SQLite transaction that checks the capability. A one-time approval cannot be checked successfully and then reused for another execution.

The evaluation timestamp comes from the engine clock, not from the action request. Callers cannot backdate a request to resurrect an expired approval. Tests may inject a deterministic clock when constructing the engine.

Free-text similarity is never used to decide action authority.

## Evidence and claims

Evidence records what was observed or stated.

Claims represent the current applicability of that evidence.

The engine supports both write shapes:

- `recordEvidence(...)` commits immutable Evidence without making it recallable as a Claim;
- `assertClaim({ evidenceId, claim, lifecycle })` attaches a Claim later while preserving the original Evidence provenance;
- `ingest({ evidence, claim, lifecycle })` remains the atomic combined path for callers that already have both.

Standalone Evidence is included in canonical export/import, but it does not enter FTS, embeddings, or recall until a Claim references it.

Evidence is inserted once and is not rewritten to hide later history. A lifecycle transition updates claim state instead:

```text
active -> superseded
active -> rejected
```

`assertClaim(...)` and legacy `ingest(...)` apply Claim creation, lifecycle changes, conflicts, and FTS updates in one immediate SQLite transaction. A failed lifecycle validation cannot leave a partial Claim or mutate an existing target. Legacy `ingest(...)` also keeps Evidence + Claim atomic, so a failed Claim transaction does not leave orphaned Evidence.

These primitives are trusted engine APIs. A future host protocol must derive source authority outside generic caller input rather than expose `authorityClass` as a self-assigned transport field.

Historical recall can still return lifecycle-retained claims with their state.

## Secret boundary

Secret scanning runs before any evidence content, claim value, source reference, or metadata enters canonical SQLite or FTS.

Detected values are replaced with:

```text
[REDACTED_SECRET]
```

The original value is not stored in the semantic database.

The initial detector covers common API-key, bearer-token, token, secret, and password assignment shapes. It is intentionally a pre-storage boundary, not a recall-time cosmetic filter.

## Minimal API

```js
import {
  MemoryEngine,
  evaluateReliance,
} from './memory-engine/index.mjs';

const memory = new MemoryEngine({ dbPath: './memory.sqlite3' });

memory.registerProject({
  projectId: 'project-a',
  repoIdentity: 'project-a',
});

// Evidence may be captured before a durable Claim is known.
memory.recordEvidence({
  id: 'evidence-observation',
  projectId: 'project-a',
  harness: 'codex',
  sessionId: 'session-1',
  sourceKind: 'tool',
  sourceRef: 'tool:observer',
  capturedAt: '2026-09-29T00:00:00Z',
  branch: 'main',
  commitSha: null,
  path: null,
  blobOid: null,
  content: 'Observed the current database configuration.',
  authorityClass: 'tool_observation',
  metadata: {},
});

// Existing atomic Evidence + Claim ingestion remains supported.
memory.ingest({
  evidence: {
    id: 'evidence-1',
    projectId: 'project-a',
    harness: 'codex',
    sessionId: 'session-1',
    sourceKind: 'user_direct',
    sourceRef: 'session:session-1',
    capturedAt: '2026-09-29T00:00:00Z',
    branch: 'main',
    commitSha: null,
    path: null,
    blobOid: null,
    content: 'Use Postgres.',
    authorityClass: 'user_direct',
    metadata: {},
  },
  claim: {
    id: 'claim-1',
    kind: 'decision',
    subject: 'database',
    predicate: 'uses',
    value: 'Postgres',
    branchScope: 'main',
    createdAt: '2026-09-29T00:00:00Z',
  },
});

const current = memory.recall({
  projectId: 'project-a',
  branch: 'main',
  query: 'database Postgres',
  mode: 'current',
});

const answerEvidence = evaluateReliance({
  items: current.items,
  conflicts: current.conflicts,
  use: 'answer',
});

memory.close();
```

## Cross-harness protocol v1

`memory-engine/protocol.mjs` exposes the transport-neutral integration contract:

```text
memory.protocol.v1
```

The protocol does not define a socket, CLI, MCP server, or host hook. A trusted host adapter owns transport and calls `createMemoryProtocol(...).handle(request)`.

Every request uses:

```json
{
  "protocol": "memory.protocol.v1",
  "operation": "recall",
  "request_id": "request-123",
  "payload": {}
}
```

Every response echoes the protocol and request ID and returns either `ok: true` with `result`, or `ok: false` with a fixed error `code` and safe message.

Frozen V1 operations:

- `capture_evidence`: record standalone Evidence;
- `assert_claim`: attach a Claim to existing Evidence;
- `recall`: bounded current recall;
- `history`: bounded historical recall;
- `authorize`: exact structured action-capability evaluation;
- `export`: canonical portable export;
- `import`: canonical portable restore;
- `status`: content-free canonical counts.

Trust rules:

- wire callers cannot provide `authority_class`;
- `capture_evidence` requires an injected trusted `classifyAuthority(...)` callback;
- `assert_claim` is default-deny and requires an injected trusted `authorizeClaim(...)` callback;
- unknown wire fields fail closed instead of being silently accepted;
- operation failures return fixed messages rather than raw Engine errors or payload values;
- recall/history always enforce at most 10 items and at most 16 KiB serialized output.

Example construction:

```js
import { createMemoryProtocol } from './memory-engine/protocol.mjs';

const protocol = createMemoryProtocol({
  memory,
  classifyAuthority(channel) {
    return classifyTrustedHostChannel(channel);
  },
  authorizeClaim(context) {
    return trustedClaimPolicy(context);
  },
});

const response = await protocol.handle({
  protocol: 'memory.protocol.v1',
  operation: 'recall',
  request_id: 'request-123',
  payload: {
    project_id: 'project-a',
    branch: 'main',
    revision_sha: null,
    query: 'Which database handles concurrent writers?',
    max_items: 10,
    max_serialized_bytes: 16_384,
  },
});
```

The protocol is a local integration boundary, not an untrusted network authorization layer. Host adapters remain responsible for resolving configured project identity and observed source channels outside prompt-controlled text.

## Codex command-hook adapter

The first production host adapter uses the documented OpenAI Codex `UserPromptSubmit` command hook.

Entrypoint:

```text
memory-engine/adapters/codex-hook-cli.mjs
```

The command reads one Codex hook event as JSON from stdin. When current memory is available, it performs broad bounded recall, applies the engine's existing `answer` reliance policy, and writes only reliance-selected evidence as Codex-compatible `hookSpecificOutput.additionalContext` JSON to stdout. `user_direct`, `repo_trusted`, and `tool_observation` may enter normal answer context; `agent_inference`, `external_untrusted`, and `unclassified` remain retrievable but are not injected. Unresolved conflicts also fail closed at this boundary. Missing configuration, Git-context failure, unavailable memory, recall failure, or an empty reliance-selected result produces no output and does not block the user prompt.

### Configuration

The adapter requires explicit shared memory configuration in the Codex process environment:

```text
AGENT_HUB_MEMORY_DB=/absolute/shared/memory.sqlite3
AGENT_HUB_MEMORY_PROJECT_ID=project-a
```

Optional:

```text
AGENT_HUB_MEMORY_REPO_IDENTITY=github.com/example/project
AGENT_HUB_MEMORY_CAPTURE_PROMPTS=false
```

`AGENT_HUB_MEMORY_REPO_IDENTITY` defaults to the configured project ID.

Direct prompt capture is disabled by default. Setting `AGENT_HUB_MEMORY_CAPTURE_PROMPTS=true` stores the exact direct prompt as standalone `user_direct` Evidence only. It does not assert a Claim and does not make every prompt durable project truth.

Project identity is never derived from prompt text or the checkout path.

### Codex hook registration

For production hybrid recall, register two independent command hooks:

1. an asynchronous `SessionStart` launcher that makes sure the warm E5 worker exists;
2. the normal `UserPromptSubmit` memory hook with `--hybrid-recall`.

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume|clear|compact",
        "hooks": [
          {
            "type": "command",
            "command": "node /absolute/path/to/agent-hub/memory-engine/embedding-worker-launcher.mjs --cache-dir /absolute/path/to/agent-hub/.cache/memory-engine/e5",
            "commandWindows": "node C:\\absolute\\path\\to\\agent-hub\\memory-engine\\embedding-worker-launcher.mjs --cache-dir C:\\absolute\\path\\to\\agent-hub\\.cache\\memory-engine\\e5",
            "timeout": 45,
            "async": true,
            "statusMessage": "Starting project memory embeddings"
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node /absolute/path/to/agent-hub/memory-engine/adapters/codex-hook-cli.mjs --ignore-memory-env --explicit-memory-requests --hybrid-recall --candidate-capture",
            "commandWindows": "node C:\\absolute\\path\\to\\agent-hub\\memory-engine\\adapters\\codex-hook-cli.mjs --ignore-memory-env --explicit-memory-requests --hybrid-recall --candidate-capture",
            "timeout": 10,
            "statusMessage": "Recalling project memory",
            "additionalContextLimit": 2500
          }
        ]
      }
    ]
  }
}
```

Replace the example paths with the real checkout path. The prompt hook inherits the memory environment variables from the Codex process.

The launcher is idempotent. It first uses the IPC `health` operation, which verifies the pinned model identity without running inference. If no worker is ready, a cross-process lock ensures that only one concurrent Codex session spawns the detached worker. Other sessions wait for the same worker instead of loading another E5 runtime. A stale launcher lock is recoverable.


`SessionStart` is a warm-start optimization, not a correctness dependency. Some Codex
host paths can discover and trust lifecycle hooks without dispatching the command. When
`--hybrid-recall` is enabled, the `UserPromptSubmit` adapter therefore performs the
same idempotent worker check against the prepared local E5 cache before constructing the
hybrid retriever. If the worker is absent, it may start the detached local worker and wait
for readiness for at most 5 seconds. If startup fails, the prompt remains fail-soft and
uses lexical recall.

Prompt-time recovery never prepares or downloads a model. It only runs when the
repository-local prepared cache already exists, and the worker still opens that cache with
remote loading disabled.

The launcher writes no normal stdout because `SessionStart` stdout becomes developer context. Worker stdout/stderr instead append to `embedding-worker.log` beside the model-cache directory.

Codex requires changed non-managed hooks to be reviewed again because hook trust is bound to the exact hook definition. After adding or changing these handlers, open `/hooks` in Codex and trust the current definitions.

The main memory adapter handles only `UserPromptSubmit`. It deliberately does not capture `PostToolUse`, summarize on `SessionEnd`, or parse `transcript_path`. Codex documents the transcript path as a convenience rather than a stable hook interface.

### Deterministic memory-candidate capture

Production Codex can opt into conservative candidate capture with:

```text
--candidate-capture
```

This is **not automatic durable memory**. It is the first stage of the automatic-memory pipeline.

For an ordinary direct-user prompt, the adapter first applies a deterministic `capture-v1` policy. The policy currently recognizes only strong signals in these categories:

```text
decision
preference
constraint
correction
rejected_approach
known_issue
```

Examples that can become pending candidates:

```text
We decided to use Postgres for concurrent writers.
Wir müssen bei GitHub Free bleiben.
I prefer dark editorial UI over generic SaaS cards.
Bei Rollenwechsel keinen Reconnect verwenden.
Korrektur: Die Produktionsdatenbank ist Postgres, nicht SQLite.
Known issue: Host camera crop is still incorrect.
```

The deterministic filter rejects at least:

- short/transient task controls such as `go`, `Fahre fort`, `Run tests`;
- tentative language such as `maybe`, `perhaps`, `vielleicht`, `sollten wir`;
- questions;
- assistant-directed task requests such as `I want you to run the tests`, `Ich will, dass du ...`, `Kannst du ...`;
- explicit memory-management commands;
- prompts containing material matched by the memory secret detector.

When a prompt qualifies:

1. the exact prompt is stored as redacted `user_direct` Evidence;
2. a separate `memory_candidates` row is created with status `pending`;
3. project, branch, and authority are derived from the Evidence, not supplied by the candidate classifier;
4. the proposed value must exactly equal the redacted Evidence text;
5. a stable project+branch fingerprint suppresses duplicate candidate Evidence;
6. **no Claim is asserted**.

Pending candidates therefore never enter lexical recall, semantic recall, answer-reliance selection, lifecycle conflict resolution, or `memory list`.

The ledger intentionally separates operational capture state from canonical memory:

```text
User prompt
   -> redacted Evidence
   -> pending Candidate
   -> future judge/promotion layer
   -> canonical Claim
```

The v1 ledger separates capture from evaluation. The AI importance judge described below may populate the reserved evaluation fields, but relation classification, canonical promotion, supersession, and confirmation handling remain separate later stages.

Pending candidates for the current Git project and branch can be inspected read-only with:

```text
memory candidates
```

Example:

```text
Pending memory candidates for the current project and branch:
- ~8d21f0a74c [constraint] We must stay on GitHub Free.
```

Candidate refs use `~` to remain distinct from durable Claim refs, which use `@`.

Candidate capture is deliberately independent from `AGENT_HUB_MEMORY_CAPTURE_PROMPTS=true`. The legacy environment flag still means full direct-prompt Evidence capture. `--candidate-capture` instead stores only prompts accepted by the deterministic policy.

The memory doctor treats a missing candidate ledger or a managed Codex hook without `--candidate-capture` as **degraded**, not broken. Canonical memory and recall remain usable, but automatic candidate capture is not ready.

### AI candidate importance judge

Pending candidates can be evaluated with the isolated Codex importance judge:

```powershell
node .\scripts\judge-memory-candidates.mjs
```

The command is dry-run by default. Persisting evaluation metadata requires an explicit:

```powershell
node .\scripts\judge-memory-candidates.mjs --apply
```

Useful bounded options:

```text
--limit 1..20
--model <codex-model>
--reasoning-effort low|medium|high
--cwd <repository>
--db-path <memory.sqlite3>
```

The judge uses policy `importance-v1` and returns exactly one structured recommendation per candidate:

```json
{
  "decision": "promote",
  "suggested_type": "decision",
  "durability": "long",
  "future_utility": "high",
  "specificity": "high",
  "confidence": "high",
  "meaning_preserved": true,
  "canonical_fact": "The project uses Postgres for concurrent writers.",
  "reason": "Explicit durable architecture decision likely to affect future work.",
  "risk_flags": []
}
```

Allowed decisions are:

```text
promote
ignore
keep_candidate
needs_confirmation
```

`promote` is only a recommendation in this stage. It does **not** create a Claim and does not enter recall.

A promote recommendation is rejected unless all deterministic postconditions hold:

```text
durability       = long
future_utility   = high
confidence       = high
meaning_preserved = true
canonical_fact   = non-empty
risk_flags       = []
```

Invalid or malformed model output leaves the candidate unevaluated. The runner continues with later candidates instead of converting an evaluator failure into memory state.

Persisted operational mapping is:

```text
ignore              -> status=ignored
needs_confirmation  -> status=needs_confirmation
promote             -> status=pending + evaluated_at/evaluation_json
keep_candidate      -> status=pending + evaluated_at/evaluation_json
```

The evaluation write rechecks the source Evidence boundary before mutation:

- candidate and Evidence must still be `user_direct`;
- Evidence must not be secret-redacted;
- project and branch must still match;
- candidate value must still equal the exact redacted Evidence text;
- a candidate can be evaluated only once.

The judge itself runs through the locally authenticated `codex exec`, but not inside the user's normal Codex state. For every judge run Agent Hub creates:

- a fresh temporary `CODEX_HOME` containing only copied `auth.json`;
- an empty temporary Git repository;
- an ephemeral Codex session;
- no inherited hooks, config, Agent Hub memory environment, or legacy native memory.

The prompt treats the candidate as untrusted quoted data, forbids tools/outside knowledge, and asks the model to prefer precision over recall. The temporary judge environment is removed after the run.

An evaluated pending recommendation is visible through `memory candidates`, for example:

```text
- ~8d21f0a74c [constraint] We must stay on GitHub Free. | judge=promote durability=long utility=high confidence=high
```

Even then, `memory list` remains unchanged because no canonical Claim exists.

### AI candidate relation and dedupe judge

Candidates that already have a valid `importance-v1` `promote` recommendation can be compared against existing active durable user memory with:

```powershell
node .\scripts\judge-memory-relations.mjs
```

The command is dry-run by default. Persisting relation metadata requires explicit `--apply`:

```powershell
node .\scripts\judge-memory-relations.mjs --apply
```

The relation policy is `relation-v1` and has exactly four outcomes:

```text
same
update
contradict
unrelated
```

Definitions:

- `same`: the candidate and one existing durable memory express the same durable proposition, allowing harmless paraphrase;
- `update`: the candidate clearly presents a newer replacement/change to one existing memory;
- `contradict`: the candidate is incompatible with one existing memory but does not safely establish replacement semantics;
- `unrelated`: no supplied active durable memory is close enough to the same proposition.

Only active durable `user_direct` Claims from the **same project and branch** are supplied to the judge. For `same`, `update`, and `contradict`, the model must return one opaque `@...` ref copied from that supplied set. Unknown refs fail closed.

When no active durable memory exists in scope, Agent Hub resolves the candidate to `unrelated` deterministically without invoking the AI judge.

Like the importance judge, the relation judge runs in a fresh isolated Codex home with auth only, an empty temporary Git repository, no inherited hooks/config/native memory, and no Agent Hub workspace context.

Persisted relation state is operational only:

```text
importance=promote
      ↓
relation-v1
      ↓
memory_candidates.relation / related_claim_id
      +
memory_candidate_relations audit row
```

It does **not** mutate canonical memory. In particular:

- `same` does not delete or merge Claims;
- `update` does not supersede the existing Claim;
- `contradict` does not open or resolve a lifecycle conflict;
- `unrelated` does not create a new Claim.

Those lifecycle actions belong to the later deterministic promotion policy.

Stored relations are visible through `memory candidates`, for example:

```text
~8d21f0a74c [decision] We use Postgres. | judge=promote durability=long utility=high confidence=high | relation=same target=@7fa31c9e42
```

Relation evaluation is exactly-once. The write rechecks that the candidate still has a valid `promote` importance judgment and that any target is still an active durable direct-user memory in the candidate's current project and branch.

### Deterministic candidate promotion policy

Candidates with both a valid `importance-v1` `promote` recommendation and a stored relation can enter the final deterministic stage with:

```powershell
node .\scripts\promote-memory-candidates.mjs
```

The command is dry-run by default. Canonical mutation requires explicit `--apply`:

```powershell
node .\scripts\promote-memory-candidates.mjs --apply
```

Policy `promotion-v1` contains no model call. It maps the already stored importance and relation results to one fixed action:

```text
same        -> candidate status=superseded; no new Claim
unrelated   -> create one active durable Claim
update      -> create one active durable Claim and supersede the exact relation target
contradict  -> create one active durable Claim and open a conflict with the exact relation target
```

Promotion is fail-closed. Before any mutation the engine rechecks:

- the candidate is still pending;
- the importance judgment still validates as `promote`;
- the stored relation audit is present and consistent with candidate metadata;
- the source Evidence is still same-project, same-branch, `user_direct`, non-secret, and exactly matches the captured candidate value;
- any relation target is still an active durable direct-user Claim in the same project and branch;
- the opaque target ref still resolves to that exact Claim;
- relation confidence is `high`;
- relation `meaning_preserved` is `true`.

A relation with lower confidence or unsafe meaning preservation becomes `needs_confirmation` and creates no Claim.

New automatically promoted Claims keep the durable direct-user shape used by explicit memory:

```text
kind=user_direct
subject=user memory
predicate=states
```

Their value is the validated `canonical_fact` from the importance judgment. The original direct-user Evidence remains attached as immutable provenance and is included in search text.

For `update` and `contradict`, Claim creation plus lifecycle/conflict mutation plus candidate status plus promotion audit are committed in one immediate SQLite transaction. A crash cannot leave an automatically promoted Claim without its candidate finalization, or mutate a target without the new Claim.

`contradict` never chooses a winner. Both Claims remain active and the existing recall/reliance conflict gate handles the unresolved conflict fail-closed.

Promotion decisions are recorded in the operational `memory_candidate_promotions` audit table. Like the candidate and relation ledgers, this table is not canonical memory and is excluded from portable canonical export.

### Explicit durable-memory prompts

Production Codex can opt into durable direct-user memory with the hook CLI flag:

```text
--explicit-memory-requests
```

When enabled, only a prompt whose first non-whitespace text matches the strict,
case-insensitive marker below is persisted:

```text
memory: <exact direct-user statement>
```

Examples:

```text
memory: The production database is Postgres.
memory: Keep Survival camera quality at 720p HIGH.
```

Without `--candidate-capture` or full prompt capture, ordinary prompts are not
persisted, even if they contain natural-language wording such as "please remember".
With `--candidate-capture`, qualifying ordinary prompts may become **pending
candidates only**; they still do not become durable Claims. The explicit-memory boundary
does not use semantic intent classification. Leading whitespace and marker case are
ignored, but `memory:` without a non-whitespace statement is not a durable-memory
request.

For an explicit `memory:` prompt, the `UserPromptSubmit` adapter:

1. stores the exact prompt as `user_direct` Evidence;
2. marks that Evidence as an explicit memory request in trusted adapter metadata;
3. asserts one fixed exact-text Claim on the current Git branch;
4. returns a terminal `UserPromptSubmit` block result so the command itself is not
   forwarded to the model.

The terminal result uses Codex's documented command-hook shape:

```json
{
  "decision": "block",
  "reason": "Memory stored for the current project and branch."
}
```

The Claim uses the same non-reinterpretation contract as the explicit commit CLI:
`kind=user_direct`, `subject=user memory`, `predicate=states`, and the Claim value
is the redacted Evidence content exactly. No lifecycle relation is inferred
automatically.

Capture or Claim failure remains fail-soft for the Codex process, but the explicit
memory command is still consumed and reports that memory was not changed. Ordinary
non-command prompts keep the existing bounded recall path.

#### List active durable memories

The read-only management prompt

```text
memory list
```

returns the active durable `user_direct` memories for the current Git project and
branch in the terminal hook `reason`. The command is consumed with
`decision: "block"`, so Codex does not reinterpret `memory list` as a normal task.
It does not capture Evidence, assert Claims, mutate lifecycle state, or fall back to
semantic intent detection.

Only Claims with the fixed durable-user shape are listed:

```text
kind      = user_direct
subject   = user memory
predicate = states
state     = active
```

The paired Evidence must also be `user_direct`. Superseded/rejected history,
other branches, other projects, and non-user-direct Claims are excluded. The injected
list is bounded by the normal Codex hook context budget.

Each listed memory includes a stable opaque short reference derived from its Claim ID:

```text
- @7fa31c9e42 memory: database is Postgres
```

The reference is a 10-hex-character SHA-256 prefix and does not expose the underlying
session/turn Claim ID. It is stable for the lifetime of that Claim. Reference resolution
is limited to active durable user memories in the current Git project and branch, and
requires exactly one match; zero matches or a collision fail closed.

#### Explain a recall decision

The read-only diagnostic command

```text
memory explain: <query>
```

runs the same current-project/current-branch retrieval path used by normal Codex recall
and consumes the command with `decision: "block"`. It does not capture Evidence or
assert a Claim.

The diagnostic reports, for the bounded top candidates:

- final retrieval rank;
- lexical rank when present;
- semantic rank and similarity when present;
- RRF score when hybrid fusion ran;
- lexical fallback reason when semantic query embedding was unavailable;
- source authority class;
- whether the existing `answer` reliance policy selected or blocked the candidate.

Example shape:

```text
Recall diagnostics for the current project and branch:
Mode: hybrid
Fallback: none
- @7fa31c9e42 | final #1 | lexical #2 | semantic #1 (0.9123) | RRF 0.032522 | answer: selected | authority: user_direct | memory: database is Postgres
```

The diagnostic API lives in the retrieval/Codex adapter layer. It does not add an
operation to frozen `memory.protocol.v1`, and normal recall keeps the same result
shape and bounded context contract.

#### Forget an active durable memory

A current durable memory can be explicitly removed from current recall with:

```text
memory forget: <exact stored memory value>
```

The target can be either the exact durable `memory:` value or the stable reference
shown by `memory list`:

```text
memory forget: memory: database is Postgres
memory forget: @7fa31c9e42
```

The adapter matches by exact value among active Claims in the current Git project and
branch. Forget proceeds only when exactly one target matches. Zero matches or multiple
matches fail closed for lifecycle mutation and return a terminal no-change result.

The forget request is stored as direct-user Evidence. Its lifecycle source Claim is a
non-current control Claim:

```text
kind      = memory_control
subject   = user memory
predicate = forgets
state     = expired
value     = exact forgotten memory value
```

That control Claim rejects the target Claim through the existing lifecycle transaction.
The forgotten Claim becomes `rejected` and disappears from current recall; historical
recall can still recover both the rejected Claim and the Evidence that caused the
transition. No Evidence rows or historical Claims are physically deleted.

#### Explicit supersession

An existing durable memory can be replaced without semantic or embedding-based target
selection:

```text
memory replace: <exact old stored value> => <exact new durable value>
```

The replacement value must be a valid `memory:` value. The old target can be either
its exact stored value or the stable reference shown by `memory list`:

```text
memory replace: memory: database is SQLite => memory: database is Postgres
memory replace: @7fa31c9e42 => memory: database is Postgres
```

Reference targeting is deterministic only; no lexical, embedding, or LLM similarity is
used to choose a lifecycle target.

The adapter matches the old value by exact equality among active Claims in the current
Git project and branch. Replacement proceeds only when exactly one target matches.
Zero matches or multiple matches fail closed for mutation and return a terminal
no-change result.

The replacement Evidence stores the exact user prompt. The new Claim value is the exact
syntactic payload after `=>`; it is not semantically rewritten. The protocol
authorizer independently verifies the parsed old/new values, target Claim identity,
active state, project, and branch before allowing the `supersedes` lifecycle edge.

After a successful replacement, current recall excludes the old Claim and retains the
new Claim as active. Historical recall can still recover the old Claim as superseded
history.

### Explicit Codex claim commit

Durable, recallable memory is committed through a separate explicit CLI:

```text
memory-engine/adapters/codex-memory-commit-cli.mjs
```

The command reads one JSON object from stdin:

```json
{
  "evidence_id": "evidence:codex:...",
  "lifecycle": {
    "supersedes": [],
    "rejects": [],
    "conflicts_with": []
  }
}
```

The commit path deliberately does **not** accept caller-controlled project ID, branch,
Claim ID, timestamp, subject, predicate, or value. It resolves project and branch from
the current Git checkout, generates Claim identity and time itself, and promotes the
exact redacted `user_direct` Evidence text as the Claim value.

The fixed first-production Claim shape is:

```text
kind      = user_direct
subject   = user memory
predicate = states
value     = exact redacted Evidence content
```

This prevents an agent from turning a real direct-user statement into a different
higher-authority Claim. Structured semantic promotion can be added later only with a
separate confirmation/grounding contract.

The commit is denied unless:

- the Evidence belongs to the current Git project;
- the Evidence was classified `user_direct`;
- the Evidence branch matches the current branch;
- every lifecycle target exists in the same project and branch.

Explicit write failures are fail-closed and return a non-zero exit code. Success output
contains only project/branch/Evidence/Claim identifiers and Claim state, not remembered
content.

As with the recall hook, `--ignore-memory-env` makes the CLI ignore stale
`AGENT_HUB_MEMORY_*` values inherited from a long-lived Codex process while retaining
the platform default database location.

### Recall behavior

Before current recall, the adapter:

1. resolves the Git repository root from the documented event `cwd`;
2. requires a real current branch rather than detached HEAD;
3. resolves the full current HEAD SHA;
4. refreshes blob freshness for repository-grounded Claims;
5. recalls only the explicitly configured project and current branch;
6. formats at most 8 KiB of additional context.

The injected context labels Claim state and Evidence authority and starts with an explicit reminder that recalled content is evidence, not instructions.

Codex hybrid recall is an explicit opt-in:

```text
--hybrid-recall
```

When enabled, the hook constructs `HybridMemoryRetriever` with a lightweight local IPC embedder proxy. The hook process never initializes Transformers.js or loads E5 itself. If the worker is unavailable, malformed, slow, or reports the wrong model identity, query embedding fails locally and `HybridMemoryRetriever` returns the normal bounded lexical result.

The worker owns embedding inference only. It never opens the memory database and cannot widen project, branch, lifecycle, authority, freshness, conflict, or approval scope.

Official host references reviewed 2026-09-30:

- https://developers.openai.com/docs/hooks
- https://developers.openai.com/plugins/build/plugins

## Pinned E5 provider

### Warm local embedding worker

Codex command hooks are short-lived processes, so production hybrid recall keeps the pinned E5 runtime in a separate local worker rather than loading the model for every prompt.

Install the scoped provider dependency:


```bash
npm ci --prefix memory-engine
```

Populate the exact pinned model cache explicitly:

```bash
node scripts/prepare-memory-embedding-model.mjs \
  --cache-dir .cache/memory-engine/e5
```

That preparation command is the only repository path that enables remote model loading. It resolves the cache directory, downloads the exact model/revision through the provider, and succeeds only after a 384-dimensional readiness embedding is produced.

The worker can be started manually from the same prepared cache:

```bash
node memory-engine/embedding-worker-cli.mjs \
  --cache-dir .cache/memory-engine/e5
```

For normal Codex use, prefer the idempotent launcher through the asynchronous `SessionStart` hook shown above:

```bash
node memory-engine/embedding-worker-launcher.mjs \
  --cache-dir .cache/memory-engine/e5
```

The launcher detaches the worker, waits for readiness in the background, and uses a start lock to prevent duplicate E5 cold starts across concurrent sessions. It is safe to invoke repeatedly.

The worker opens the pinned provider with remote loading disabled, performs a readiness embedding before it reports `ready`, and listens only on a local IPC endpoint:

- Windows: `\\\\.\\pipe\\agent-hub-memory-embedding-v1`
- Unix: a user-scoped socket below `XDG_RUNTIME_DIR` or the OS temporary directory

Then add `--hybrid-recall` to the Codex hook command. A production command that also uses the explicit memory controls can therefore be:

```text
node .../memory-engine/adapters/codex-hook-cli.mjs --ignore-memory-env --explicit-memory-requests --hybrid-recall --candidate-capture
```

If the worker is not running, Codex continues with lexical recall. There is no implicit model startup or download from the prompt hook.

Successful active Claim assertion triggers best-effort semantic indexing after the canonical transaction commits. Embedding failure never rolls back the Claim. To repair missing or stale semantic rows after worker downtime, run the explicit reindex command while the worker is available:

```bash
node scripts/reindex-memory-semantic.mjs \
  --db-path /absolute/path/to/memory.sqlite3 \
  --project-id github.com/example/project \
  --branch main
```

The repair command probes the worker once, then reindexes canonical Claim documents one at a time. Semantic vectors remain derived state.

Normal runtime reuses the same cache with remote loading disabled:

```js
import { createE5Embedder } from './memory-engine/e5-embedder.mjs';

const embedder = await createE5Embedder({
  cacheDir: '.cache/memory-engine/e5',
});
```

Normal provider creation passes `local_files_only: true`. A missing or incomplete cache therefore fails provider initialization instead of silently downloading model files. The surrounding `HybridMemoryRetriever` can still operate in lexical fallback mode when no semantic provider is available.

Model files live below the repository's ignored `.cache/` tree and are not committed.

### Real semantic evaluation

The manual `Memory semantic eval` workflow installs the scoped provider dependency, restores or prepares the exact pinned model cache, then runs `tests/memory-engine/e5-semantic-eval.test.mjs` with normal provider creation (`local_files_only: true`).

Measured against the pinned `intfloat/multilingual-e5-small` revision `6a0d452a575215f80b8f66276dd4ee5d504942c6`:

| Query | Target | Lexical rank | Semantic rank | Fused rank |
| --- | --- | ---: | ---: | ---: |
| Which database was selected because concurrent writers are required? | Postgres | 1 | 1 | 1 |
| Which storage engine did we choose to handle multiple processes writing at once? | Postgres | — | 1 | 1 |
| Welche Datenbank haben wir wegen paralleler Schreibzugriffe gewählt? | Postgres | — | 1 | 1 |
| For how long do we preserve security event records? | 30-day audit retention | — | 1 | 1 |

Every evaluated hybrid result remains within the core limits of at most 10 items and 16 KiB serialized output.

The manual evaluation also emits a machine-readable recall-quality summary over
positive and negative queries, including domain-near hard negatives with lexical overlap.
The summary measures lexical, semantic, and fused:

- hit rate at 1, 5, and 10;
- false-negative rate at 1, 5, and 10;
- mean reciprocal rank;
- negative-query non-empty rate;
- relevant semantic similarity distribution;
- negative-query top-1 semantic similarity distribution.

It also reports a finer semantic threshold sweep at top 5 around the observed decision
boundary, plus per-case top-1/top-2 similarity margin and the target's margin over the
best irrelevant candidate. The sweep includes query-level precision, recall, F1,
positive hit rate, and negative suppression rate. These numbers are measurement evidence
only. Production recall does not apply a semantic cutoff until a separate change chooses
and justifies one from measured data.

The provider uses the measured qint8 ONNX graph on CPU while preserving 384-dimensional Float32 normalized embedding output. ANN/vector database, GPU requirements, and learned reranking remain outside this delivery.

### Codex memory behavioral evaluation

The production reliance contract is covered by a separate manual end-to-end runner:

```powershell
$env:MEMORY_E5_MODEL_CACHE = (Resolve-Path .\.cache\memory-engine\e5).Path
$env:MEMORY_BEHAVIORAL_MODEL = "gpt-5.6-sol"

node .\scripts\eval-codex-memory-behavior.mjs
```

The runner creates an ephemeral SQLite memory store containing only this synthetic direct-user memory:

```text
memory: widget telemetry for compliance audits is retained for 37 days
```

It then rebuilds the real pinned E5 semantic index, routes every case through the real Codex memory hook adapter, and sends the exact resulting `additionalContext` to `codex exec --ephemeral`.

The four behavioral cases are:

- exact compliance-audit question -> supported, `37 days`;
- paraphrased compliance question -> supported, `37 days`;
- performance-debugging retention -> unsupported, null answer;
- product-analytics retention -> unsupported, null answer.

The Codex subprocess is deliberately isolated from existing local Codex state. The runner creates a fresh temporary `CODEX_HOME`, copies only `auth.json` from the authenticated source Codex home, and does not inherit `config.toml`, hooks, Codex memory databases, rollout/session state, or `AGENT_HUB_MEMORY_*` overrides. The temporary workspace contains no project policy or memory fixture beyond the injected Agent Hub context.

If the authenticated Codex home is not the normal `CODEX_HOME` / `~/.codex`, point the runner at it with `MEMORY_BEHAVIORAL_SOURCE_CODEX_HOME`. The runner refuses to fall back to the full existing Codex home when `auth.json` is unavailable because doing so would make the result vulnerable to legacy-memory contamination.

The runner emits one `codex_memory_behavioral_case` JSON record per case and a final `codex_memory_behavioral_summary`. A failing case exits non-zero. This remains a manual/provider-backed evaluation so normal PR CI does not spend Codex usage or download E5 model files. Ordinary CI tests the fixture, scoring, parser, isolation rules, and orchestration with deterministic fakes.

### Codex state isolation audit

Before changing normal Codex startup or deleting legacy state, inspect the active Codex home with:

```powershell
node .\scripts\audit-codex-state.mjs
```

The command uses `CODEX_HOME` when it is set and otherwise inspects the normal user `.codex` directory. A different location can be supplied explicitly:

```powershell
node .\scripts\audit-codex-state.mjs --codex-home C:\path\to\.codex
```

The audit is intentionally metadata-only. It lists top-level file and directory names, classifies known state surfaces, and reads only the structure of `hooks.json` to determine whether the Agent Hub `UserPromptSubmit` adapter and its required flags are configured. It does not open Codex memory, state, thread-history, or session databases and does not emit raw hook commands.

The report distinguishes:

- `direct_memory`: known memory database/directory naming patterns;
- `conversation_state`: thread/session/history/rollout surfaces;
- `persistent_runtime_state`: other known persistent Codex runtime databases;
- `instruction_surface`: global instruction, skill, rule, or prompt locations;
- `runtime_config`, `hooks`, and `auth`;
- unknown top-level surfaces.

Conversation/session state is reported separately and is **not** automatically labeled direct-memory contamination. The audit only treats explicitly memory-named surfaces as direct legacy memory risk. Its purpose is to decide whether a follow-up normal-runtime isolation change is justified, not to delete or migrate anything.

### Native Codex memory isolation

When a real state audit confirms that Agent Hub is active while native Codex durable memory is also present, isolate only the native memory feature rather than replacing the full `CODEX_HOME`.

Preview the exact change first:

```powershell
node .\scripts\isolate-native-codex-memory.mjs
```

The default mode is dry-run. It reads `config.toml`, reports the current and planned memory settings, and does not write anything.

After reviewing the dry-run, apply with:

```powershell
node .\scripts\isolate-native-codex-memory.mjs --apply
```

The command manages only:

```toml
[features]
memories = false

[memories]
use_memories = false
generate_memories = false
```

On apply it:

- creates a timestamped backup of the existing `config.toml`;
- atomically replaces only the config file;
- preserves unrelated config lines and comments;
- refuses ambiguous duplicate target sections/keys and non-boolean target values;
- verifies that the known native memory surfaces present before the change remain present afterward;
- never deletes or edits `memories/`, `memories_1.sqlite`, sessions/history, auth, hooks, skills, rules, or other Codex runtime databases.

The operation is idempotent. Once all three managed settings are `false`, later runs report no change and create no additional backup.

Restart Codex after an applied change before validating effective behavior. The retained native-memory files are historical state only; the isolation change intentionally does not erase them.

### Native Codex memory drift guard

The existing GitHub Delivery maintenance path now checks the isolation read-only whenever the Agent Hub Codex recall hook is active.

The guard requires all three managed settings to be explicitly `false`. A `true`, missing, duplicate, dotted alias, or invalid managed value is treated as drift rather than silently accepting Codex defaults.

Run the normal doctor command to inspect the state:

```powershell
node .\skills\github-delivery\scripts\github-delivery-cli.mjs doctor --json
```

The machine report includes `nativeCodexMemory`. Human-readable doctor output also shows a dedicated `Native Codex memory` section.

Expected healthy state:

```text
status: isolated
features.memories = false
memories.use_memories = false
memories.generate_memories = false
```

When drift is detected, bootstrap setup no longer reports `ready`. It returns `native_memory_drift` with guidance to run the existing isolation command, review the dry-run, apply it explicitly, and restart Codex.

The guard is read-only. It does not start a background process, change `config.toml`, delete native memory state, or add model-backed CI work. If Agent Hub recall is not installed, the check reports `not_applicable`.

### Agent Hub memory doctor

Use the operational doctor when you want one read-only answer for the complete memory path:

```powershell
node .\scripts\doctor-memory.mjs
```

The command emits one machine-readable JSON object and exits with:

- `0`: `healthy`
- `1`: `degraded`
- `2`: `broken`

The doctor checks:

- current Git project/branch/revision resolution;
- the canonical memory SQLite file using `DatabaseSync(..., { readOnly: true })`;
- `PRAGMA quick_check`, foreign keys, required schema, and WAL mode;
- project registration plus lexical FTS coverage;
- current pinned E5 embedding coverage and vector shape;
- E5 cache presence without allowing remote downloads;
- the already-running embedding worker with a health probe and a real query-vector canary;
- the Agent Hub Codex hook, required recall flags, and SessionStart launcher;
- native Codex memory isolation;
- active, stale, or malformed restore-maintenance state.

Status semantics are deliberately asymmetric:

- canonical DB corruption/missing schema, broken Git scope, missing critical Agent Hub hook controls, unsafe native-memory isolation, or a stale/malformed restore transaction -> `broken`;
- missing E5 cache, unavailable worker, missing SessionStart launcher, incomplete derived lexical/semantic state, or an active restore transaction -> `degraded`;
- healthy required state with all resilience checks passing -> `healthy`.

The doctor is strictly diagnostic. It does **not**:

- checkpoint SQLite;
- create or migrate schema;
- rebuild FTS or semantic indexes;
- launch the embedding worker;
- download an E5 model;
- modify Codex config/hooks;
- write, replace, or forget any durable memory.

Optional path overrides are available for controlled diagnostics:

```powershell
node .\scripts\doctor-memory.mjs --cwd C:\repo --db-path C:\state\memory.sqlite3 --cache-dir C:\repo\.cache\memory-engine\e5 --codex-home C:\path\.codex
```

### Durable memory backup and restore

Create a consistent backup of the live WAL-mode database with SQLite's online backup API:

```powershell
node .\scripts\backup-memory.mjs
```

By default backups are written below the canonical memory state directory in `backups/`. A backup directory contains:

```text
memory.sqlite3
manifest.json
```

The backup database is a standalone SQLite file normalized to DELETE journal mode for portability. The manifest contains only operational metadata: backup format version, timestamp, SHA-256, byte size, page count, integrity result, and row counts. It does not copy absolute source paths into the manifest.

The backup path can be overridden:

```powershell
node .\scripts\backup-memory.mjs --output-dir C:\safe\agent-hub-backups
```

Restore is validation-only by default:

```powershell
node .\scripts\restore-memory.mjs C:\safe\agent-hub-backups\agent-hub-memory-...
```

Only an explicit apply mutates the target:

```powershell
node .\scripts\restore-memory.mjs C:\safe\agent-hub-backups\agent-hub-memory-... --apply
```

Before apply, the restore validates the manifest, SHA-256, byte size, SQLite `quick_check`, foreign keys, schema, and row counts. During apply it:

- creates a restore-maintenance lock beside the canonical database;
- makes Agent Hub Codex hooks fail soft while the lock is present;
- creates a full `pre_restore` backup of the current target database;
- uses an exclusive SQLite transaction as a quiescence barrier for an in-flight writer;
- builds and validates a temporary restore candidate;
- stages the current main database and known `-wal`, `-shm`, and `-journal` sidecars;
- swaps the candidate into place;
- restores WAL mode and validates the installed database;
- rolls staged files back if the swap or post-restore validation fails.

A restore lock is acquired with exclusive file creation. If another restore is active, apply fails closed instead of running concurrently. The lock is removed in the normal success and failure paths.

For the smallest operational risk, close interactive Codex sessions before a production `--apply`. The maintenance lock prevents new Agent Hub hook entries during the restore, but it is not intended as a general process manager for unrelated software that may access the SQLite file directly.

#### Interrupted restore recovery

Every applied restore also maintains a durable journal beside the target database:

```text
memory.sqlite3.restore.lock
memory.sqlite3.restore-journal.json
```

The journal records the operation id, current phase, restore candidate, pre-restore backup, deterministic staged-file mappings, and expected row counts.

Restore phases are:

```text
preparing
candidate_ready
snapshot_ready
staging
installing
installed
verified
```

A normal success or successfully rolled-back ordinary exception removes the journal and lock. A hard process exit can leave them behind intentionally so the next operator can diagnose what happened.

The memory doctor is read-only and reports this state through `restoreRecovery`:

- no interrupted transaction -> `ok`;
- currently active restore owner -> `degraded` with `restore_in_progress`;
- stale transaction -> `broken` with `stale_restore_transaction`;
- malformed recovery metadata -> `broken` and fail-closed.

Recovery is always explicit:

```powershell
node .\scripts\restore-memory.mjs --recover
```

Recovery refuses to run while the recorded restore owner process is still alive.

For a stale transaction it chooses the conservative action from the durable phase:

- `preparing`, `candidate_ready`, `snapshot_ready`: remove the unused candidate and clear stale metadata because the target was not staged yet;
- `staging`, `installing`: restore any staged original files and remove candidate/new artifacts;
- `installed`, `verified`: validate the installed database against the journaled expected restore state; finish cleanup only when it is valid, otherwise restore the staged previous target;
- stale lock with no journal: clear it only when the current target is healthy and no unjournaled restore artifacts exist;
- ambiguous or malformed state: refuse automatic recovery.

The doctor never invokes recovery itself.

Custom target and pre-restore-backup locations are supported:

```powershell
node .\scripts\restore-memory.mjs C:\safe\backup --db-path C:\state\memory.sqlite3 --backup-root C:\safe\pre-restore --apply
```

## Hybrid retrieval core

`HybridMemoryRetriever` is an asynchronous relevance layer above `MemoryEngine`. It accepts an injected embedder with the contract:

```js
{
  modelId,
  modelRevision,
  dimensions,
  embedQuery(text),
  embedPassages(texts),
}
```

The core does not import an ML package. Tests use a deterministic fake provider; the concrete pinned E5 provider is delivered separately.

Semantic indexing uses deterministic passage text built only from already-redacted canonical memory. Vectors are stored in `claim_embeddings` as derived state together with exact model ID, model revision, text hash, dimensions, and index time.

Hybrid recall proceeds as:

```text
correctness-scoped lexical top 32
        +
correctness-scoped semantic top 32
        |
        v
deterministic RRF (k = 60)
        |
        v
correctness-safe ID materialization
        |
        v
<= 10 items and <= 16 KiB
```

Semantic similarity is relevance only. Project and branch isolation, lifecycle state, repository freshness, conflicts, reliance, and action approvals are never inferred from vectors.

If no embedder is configured or query embedding fails, hybrid recall returns the bounded lexical result instead of making canonical memory unavailable.

Semantic rebuild is explicit:

```js
import { HybridMemoryRetriever } from './memory-engine/hybrid-retrieval.mjs';

const hybrid = new HybridMemoryRetriever({
  memory,
  embedder,
});

await hybrid.rebuildSemanticIndex({
  projectId: 'project-a',
  branch: 'main',
});

const recalled = await hybrid.recall({
  projectId: 'project-a',
  branch: 'main',
  query: 'Which storage engine handles multiple processes writing at once?',
  maxItems: 10,
  maxSerializedBytes: 16_384,
});
```

## Failure recovery

Canonical writes rely on SQLite transactions in WAL mode. A partially executed ingest is not canonical memory until its transaction commits.

The M15 regression exercises two recovery paths:

- derived-state loss: `claim_fts` and repository freshness snapshots are removed, then rebuilt from canonical rows;
- hard interruption: a separate Node process begins a real SQLite write transaction, inserts the first partial Evidence row, signals the write barrier, and is terminated with `SIGKILL` before commit.

After recovery:

- previously committed current memory remains available;
- superseded history remains available;
- source provenance remains intact;
- the interrupted Evidence row is absent from canonical export;
- no interrupted Claim is present;
- interrupted content cannot surface as trusted recall.

Recovery does not promote WAL fragments or partial writes. It checkpoints surviving committed SQLite state and regenerates derived indexes from canonical truth.

## Bounded recall

The Memory Ratchet M14 regression ingests 2,000 unrelated distractor memories plus the database decision history and requests at most 10 recalled items.

The existing FTS5 retrieval still satisfies the frozen ratchet:

- the target Postgres decision appears in the top five under 2,000 distractors;
- no more than 10 current items are returned;
- the serialized raw recall payload stays within 16 KiB.

A separate deterministic fake-embedder regression now verifies the hybrid layer without changing the frozen Ratchet fixture. It covers lexical-light English and German paraphrases, requires the Postgres decision in the top five, and enforces the same <=10 item / <=16 KiB output limits.

RRF does not replace FTS5. Lexical retrieval remains the deterministic exact-term path, while semantic ranking contributes relevance candidates when an embedder is available.

## Verification

Foundation tests run under Node 24:

```text
node --test tests/memory-engine/*.test.mjs
```

The suite includes direct engine invariants plus Memory Ratchet fixture coverage for:

- M01 cross-harness current truth;
- M02 long-gap cross-session continuity after 27 unrelated sessions;
- M03 project isolation;
- M04 branch isolation;
- M05 Git blob freshness;
- M06 explicit supersession/history;
- M07 contradiction handling;
- M08 provenance;
- M09 rejection/history;
- M10 source-authority / poisoning resistance;
- M11 pre-storage secret redaction;
- M12 structured action trust boundary;
- M13 portable export and rebuild;
- M14 bounded recall under 2,000 distractors;
- M15 interrupted-write and derived-state recovery;
- deterministic hybrid fusion, semantic scope isolation, lexical fallback, and bounded paraphrase recall with an injected fake embedder.

The reference engine now has explicit regression coverage for every Memory Ratchet case M01-M15 plus the hybrid retrieval core. The separate manual `Memory semantic eval` workflow provides real pinned-model coverage for the E5 provider while ordinary CI keeps the model download-free.
