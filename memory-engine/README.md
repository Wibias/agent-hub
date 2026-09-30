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

The command reads one Codex hook event as JSON from stdin. When current memory is available, it writes Codex-compatible `hookSpecificOutput.additionalContext` JSON to stdout. Missing configuration, Git-context failure, unavailable memory, or recall failure produces no output and does not block the user prompt.

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

A Codex hook configuration can point `UserPromptSubmit` at the command:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node /absolute/path/to/agent-hub/memory-engine/adapters/codex-hook-cli.mjs",
            "commandWindows": "node C:\\absolute\\path\\to\\agent-hub\\memory-engine\\adapters\\codex-hook-cli.mjs",
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

Replace the example path with the real checkout path. The command inherits the memory environment variables from the Codex process.

The adapter currently handles only `UserPromptSubmit`. It deliberately does not capture `PostToolUse`, summarize on `SessionEnd`, or parse `transcript_path`. Codex documents the transcript path as a convenience rather than a stable hook interface.

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

Ordinary prompts are not persisted, even if they contain natural-language wording such
as "please remember". The adapter does not use semantic intent classification for this
boundary. Leading whitespace and marker case are ignored, but `memory:` without a
non-whitespace statement is not a durable-memory request.

For an explicit `memory:` prompt, the `UserPromptSubmit` adapter:

1. stores the exact prompt as `user_direct` Evidence;
2. marks that Evidence as an explicit memory request in trusted adapter metadata;
3. asserts one fixed exact-text Claim on the current Git branch;
4. performs normal bounded recall.

The Claim uses the same non-reinterpretation contract as the explicit commit CLI:
`kind=user_direct`, `subject=user memory`, `predicate=states`, and the Claim value
is the redacted Evidence content exactly. No lifecycle relation is inferred
automatically.

Capture or Claim failure remains fail-soft for the interactive Codex prompt. The
ordinary recall path still runs.

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

The command currently constructs the frozen protocol without a `HybridMemoryRetriever`, so Codex hook recall is lexical-only in this delivery. This is intentional: the adapter does not implicitly initialize the E5 provider or download a model. Hybrid recall can be wired later through the same protocol boundary if a configured offline provider is required.

Official host references reviewed 2026-09-30:

- https://developers.openai.com/docs/hooks
- https://developers.openai.com/plugins/build/plugins

## Pinned E5 provider

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

The provider uses the measured qint8 ONNX graph on CPU while preserving 384-dimensional Float32 normalized embedding output. ANN/vector database, GPU requirements, and learned reranking remain outside this delivery.

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
