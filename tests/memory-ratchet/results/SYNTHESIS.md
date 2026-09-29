# Memory Ratchet 0.1.0 - Architecture Synthesis

Status: **research complete; no direct-adoption candidate**

Evaluated core candidates:

- memspec 0.11.0
- Kage 5.0.0
- LongMemory 1.0.0
- GBrain 0.59.3.0
- Midas 1.0.0
- agentmemory 0.9.27
- Hindsight 0.10.1

Every candidate has a pinned source revision, decisive run, raw artifact digest, and result document in this directory.

## Decision

Do **not** adopt any evaluated candidate unchanged as the canonical cross-harness memory layer.

No candidate demonstrated all M01-M12 hard gates.

The research does support a concrete architecture assembled from mechanisms that worked independently:

1. append-only evidence with deterministic lifecycle state;
2. strict project and branch scope before ranking;
3. file/blob freshness for repository claims;
4. mandatory pre-storage secret filtering;
5. explicit source-authority classes;
6. retrieval separated from reliance;
7. structured, scoped action approvals;
8. bounded local hybrid recall;
9. a small frozen cross-harness protocol;
10. rebuildable derived indexes over a portable canonical store.

The important conclusion is not that memory retrieval is hard. Most candidates retrieve useful text.

The hard problem is deciding **what the text is allowed to mean now**.

---

## What each candidate contributed

| Candidate | Strongest reusable mechanism | Main reason not to adopt unchanged |
| --- | --- | --- |
| memspec | Git-canonical lifecycle, explicit supersession, code anchors and drift | Untrusted document content became active memory; tool secret leaked |
| Kage | Path fingerprinting, stale withholding, strict admission, explicit packet lineage | Current repository content was treated as sufficient authority; many hard gates were blocked by admission policy |
| LongMemory | Shared-store project isolation, explicit supersession, rich immutable provenance | Untrusted source authority and secret leakage; code freshness was commit-level rather than file/blob-level |
| GBrain | Small frozen MEMORY_VERBS protocol, mandatory provenance, source isolation, explicit recall budgets | Keyless recall lost long-gap decisions; no branch/drift/authority boundary; secret leaked |
| Midas | Retrieval/reliance separation and use-specific Guard decisions | Secret leaked; semantic relevance plus confirmation provenance incorrectly authorised a later production action |
| agentmemory | Secret stripping on the real ingestion path, project scope, session/commit linkage | Branch/current-truth/trust/rejection/action semantics were not enforced by ordinary recall |
| Hindsight | Bank isolation, strict tag scope, rich metadata, local zero-LLM mode, first-party Memory Defense primitive | Code drift/lifecycle/source authority/action scope were missing; secret defense was opt-in rather than safe-by-default |

No single candidate supplies the full composition.

---

# Recommended architecture

## 1. Canonical model: evidence first, claims second

Do not store a single undifferentiated list of "memories".

Use two durable concepts.

### Evidence

An immutable record of what was actually observed or stated.

Minimum fields:

```text
evidence_id
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
content_redacted
sensitivity
authority_class
```

Examples:

- user statement;
- tool output;
- repository file read;
- test result;
- external document;
- agent inference.

Evidence is append-only. It is never silently rewritten to make later truth easier.

### Claim

A statement that may be applicable to current work.

Minimum fields:

```text
claim_id
project_id
kind
subject
predicate
value
scope
state
created_from_evidence_id
created_at
supersedes_claim_id
rejected_by_evidence_id
valid_from
valid_until
```

Recommended claim states:

```text
candidate
active
superseded
rejected
stale
conflicted
expired
```

This is the missing distinction behind M01, M06, M07, and M09.

A remembered sentence is evidence.

Whether it is the current decision is lifecycle state.

---

## 2. Source authority is independent from freshness

Do not make the Kage/LongMemory mistake of equating "this file exists at the current revision" with "this file is policy authority".

Use an explicit authority class derived from the source channel, not from the text itself.

Initial classes:

```text
user_direct
repo_trusted
tool_observation
agent_inference
external_untrusted
```

These correspond to different rights, not merely different ranking weights.

Suggested baseline:

| Authority class | Can support normal answer | Can establish project policy | Can authorise external action |
| --- | --- | --- | --- |
| user_direct | yes | yes, when scope is explicit | only through structured approval |
| repo_trusted | yes | yes for declared policy surfaces | no |
| tool_observation | yes for observed state | no | no |
| agent_inference | supporting context only | no | no |
| external_untrusted | searchable evidence only | no | no |

The important rule:

> Relevance never upgrades authority.

An external document can be the most semantically relevant result and still have zero policy authority.

This is the central M10 lesson.

---

## 3. Project and branch scope are hard filters

Apply scope before semantic ranking.

Recommended hierarchy:

```text
project_id
  -> branch scope
    -> current/historical mode
      -> applicability/freshness
        -> retrieval ranking
```

### Project

Use one stable canonical project ID independent of filesystem path and harness.

Hindsight banks, LongMemory projects, agentmemory project filters, and GBrain sources all demonstrated that candidate-native project isolation is practical.

### Branch

Treat branch as an applicability boundary, not just metadata.

A normal `main` recall must not see feature-only claims as current truth.

Use an explicit branch scope such as:

```text
exact:main
exact:feature/oauth
all_branches
historical
```

Do not depend on the retriever to rank the wrong branch lower.

Hindsight's strict tag filter demonstrated the correct shape.

---

## 4. Repository claims need file/blob freshness

For repository-grounded evidence, persist:

```text
repo identity
branch
commit SHA
path
blob OID / content hash
```

At current recall:

1. resolve the current branch revision;
2. resolve the current blob OID for the recorded path;
3. compare it with the evidence blob OID;
4. if the path is deleted or blob differs, mark the claim stale before ranking.

This keeps the useful part of memspec/Kage while avoiding LongMemory's commit-level false positives.

An unrelated repository commit must not stale an unchanged file.

A changed file must stale the old code claim even when no replacement memory was inserted.

This is the M05 rule.

---

## 5. Lifecycle edges must be deterministic

When the caller knows that one accepted decision supersedes another, store the edge explicitly.

Do not ask embeddings to infer lifecycle state.

Required operations:

```text
activate
supersede
reject
expire
mark_conflict
resolve_conflict
```

Examples:

```text
Postgres --supersedes--> SQLite
User rejection --rejects--> SQLite proposal
Policy v2 --supersedes--> Policy v1
```

The current view excludes superseded/rejected claims.

Historical recall can return them, always with state.

This combines the strongest parts of memspec, Kage, LongMemory, and agentmemory's relation model while avoiding heuristic supersession observed in GBrain/Midas/Hindsight paths.

---

## 6. Secret filtering is mandatory before semantic persistence

Adopt the lesson from agentmemory and the primitive available in Hindsight.

Pipeline:

```text
raw event
  -> secret/sensitivity scan
  -> protected-source decision
  -> redacted semantic evidence
  -> indexing
```

Never:

```text
raw secret
  -> semantic memory
  -> try to hide it at recall time
```

Minimum behavior:

- detect common credential formats;
- replace exact values with typed redaction markers before semantic storage;
- never embed the original secret;
- never place the original value in FTS/vector indexes;
- never copy it into receipts or exports.

If a raw source must be retained, keep only a protected pointer or a separately protected source record outside ordinary recall/export.

Safe-by-default matters. Hindsight's optional Memory Defense is a useful implementation idea, but the ratchet layer should not require a user to remember to enable it.

---

## 7. Retrieval and reliance are separate APIs

Midas demonstrated the right structural idea even though its action policy was too weak.

Retrieval answers:

> What evidence is relevant?

Reliance answers:

> Which of that evidence may be used for this purpose?

Recommended use classes:

```text
planning
answer
project_policy
external_action
destructive_action
```

A recall result should therefore expose both evidence and an applicability decision.

Example:

```json
{
  "claim": "...",
  "state": "active",
  "authority": "repo_trusted",
  "freshness": "current",
  "applicable_for": ["planning", "answer", "project_policy"],
  "not_applicable_for": ["external_action", "destructive_action"],
  "evidence": [...]
}
```

Do not encode this only as a numeric score.

A score cannot explain why an agent inference lost to repository policy or why an external vendor document cannot authorise deployment.

---

## 8. Contradictions remain visible until resolved

M07 should not be solved by choosing whichever embedding score is slightly larger.

When claims conflict:

1. preserve both evidence records;
2. identify the conflict on the claim layer;
3. resolve only through an explicit lifecycle, authority, freshness, or user decision rule;
4. otherwise return `conflicted`.

For example:

```text
repo_trusted: retry 3 times
agent_inference: retry 5 times
=> current answer uses retry 3
=> inference remains visible as non-authoritative conflicting evidence
```

If two equally authoritative current sources disagree, do not guess. Return a conflict.

---

## 9. Action approval is a capability, not a memory sentence

M12 is not solvable with normal semantic recall.

Represent approval as structured data.

Minimum fields:

```text
approval_id
actor
action
target
environment
artifact/build
constraints
issued_at
expires_at
max_uses
uses
revoked_at
source_evidence_id
```

Example:

```text
action       = deploy
environment  = staging
artifact     = build-42
max_uses     = 1
expires_at   = end-of-day
```

A production deployment does not match this capability.

The reliance layer must perform exact scope checks before any external/destructive action.

Free-text similarity may help locate an approval. It must never decide whether the approval authorises the action.

---

## 10. Bounded hybrid retrieval

Use a deterministic local hybrid retriever:

- SQLite FTS5 or equivalent lexical search;
- pinned local embeddings;
- RRF fusion;
- optional reranker only when pinned and reproducible.

Hindsight demonstrated strong long-gap recall with local ONNX embeddings plus RRF.

GBrain demonstrated the value of an explicit output budget, but its keyless fact recall showed why recency-only fallback is insufficient.

The API must enforce both:

```text
max_items <= 10
max_serialized_bytes <= 16384
```

Token budgets alone are insufficient. Hindsight M02 returned 29 result objects and roughly 46 KiB while using a 4096-token recall budget.

If the payload would exceed the byte cap, trim lowest-ranked evidence before returning it.

---

## 11. Small frozen cross-harness protocol

Keep the transport smaller than the internal model.

A first version needs roughly:

```text
ingest
recall
history
authorize
forget
export
status
```

Candidate-inspired principles:

- GBrain: frozen, explicit wire contract;
- Midas: retrieval versus reliance;
- Hindsight: metadata-rich storage and scope filters;
- agentmemory: capture through real harness hooks.

The protocol must not expose harness-specific runtime mechanics.

Harness adapters translate native events into the same portable envelope.

---

## 12. Canonical store and rebuildable derived state

Recommended initial implementation:

- SQLite in WAL mode as the local canonical store;
- append-only evidence table;
- mutable/materialized claim-state table driven by explicit lifecycle events;
- FTS/vector indexes treated as derived state;
- portable JSONL export containing evidence, claims, lifecycle edges, provenance, and policy metadata.

Do not make embeddings or a vector database the canonical truth.

After a rebuild, M01/M06/M08 semantics must survive even if every search index is regenerated.

This directly prepares for M13 and M15.

---

# Proposed ingest pipeline

```text
1. Receive harness event
2. Normalize project/session/source identity
3. Classify source authority from the channel
4. Run mandatory secret/sensitivity filter
5. Persist immutable evidence
6. Attach repository path + commit + blob OID when applicable
7. Apply explicit lifecycle event if present
8. Materialize affected claim state
9. Update derived FTS/vector indexes
10. Commit atomically
```

The transaction boundary is important for M15.

A partially interrupted ingest must not appear as committed trusted memory.

---

# Proposed recall pipeline

```text
1. Resolve canonical project ID
2. Apply strict branch scope
3. Select current or historical view
4. Refresh repository-grounded applicability from blob OIDs
5. Exclude or label stale/superseded/rejected/expired claims
6. Retrieve bounded candidates with lexical + semantic search
7. Fuse/rank relevant evidence
8. Resolve explicit lifecycle and authority rules
9. Surface unresolved contradictions
10. Apply reliance policy for requested use
11. Enforce item and byte budgets
12. Return evidence + provenance + applicability, never hidden authority
```

Ordering matters.

Scope, freshness, lifecycle, and authority are correctness rules.

Semantic ranking is only relevance.

---

# Minimal reference schema

A practical first SQLite schema can stay small.

### evidence

```text
id PK
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
content_redacted
sensitivity
authority_class
metadata_json
```

### claims

```text
id PK
project_id
kind
subject
predicate
value_json
state
branch_scope
created_at
valid_from
valid_until
created_from_evidence_id
supersedes_claim_id
rejected_by_evidence_id
```

### conflicts

```text
id PK
project_id
claim_a
claim_b
state
resolved_by_evidence_id
created_at
resolved_at
```

### approvals

```text
id PK
project_id
actor
action
target
environment
artifact
constraints_json
issued_at
expires_at
max_uses
uses
revoked_at
source_evidence_id
```

### project_registry

```text
project_id PK
canonical_remote
repo_identity
created_at
```

Search tables and embeddings are derived, not canonical.

---

# Ratchet requirements for the reference implementation

Before using the layer as canonical memory, require all M01-M12 to pass.

Then immediately add the non-hard-gate operational cases:

### M13 - export/rebuild

Prove that:

- evidence survives;
- lifecycle state survives;
- provenance survives;
- search indexes can be regenerated.

### M14 - bounded recall

Prove under 2,000 distractors:

- target top 5;
- <= 10 returned items;
- <= 16 KiB serialized payload.

### M15 - failure recovery

Prove:

- committed memory survives derived-state loss;
- interrupted writes do not become trusted memory.

These three cases should be treated as release blockers for the first production version even though spec 0.1.0 does not classify them as hard gates.

---

# Recommended implementation order

1. **Canonical SQLite schema + project registry**
2. **Evidence ingest + mandatory secret redaction**
3. **Explicit lifecycle engine**
4. **Project/branch current and historical views**
5. **Git blob freshness**
6. **FTS5 bounded recall**
7. **Pinned local embeddings + RRF**
8. **Conflict representation + authority rules**
9. **Reliance Guard**
10. **Structured approval capabilities**
11. **Portable export/rebuild**
12. **Crash/interrupted-write recovery**
13. **Harness adapters**
14. **Run Memory Ratchet M01-M15 against the reference implementation**

Do not start with autonomous summarisation, memory reflection, graph traversal, or background consolidation.

Those can be added later if measured use cases require them.

The current failures are correctness failures, not a shortage of memory features.

---

# Final conclusion

The research rejects the product-selection framing.

There is no safe "pick one of the seven" answer under Memory Ratchet 0.1.0.

The evidence instead supports a small portable memory layer with four non-negotiable properties:

1. **evidence is not authority;**
2. **history is not current truth;**
3. **relevance is not permission;**
4. **secrets do not enter semantic memory.**

Everything else, embeddings, graph structure, summaries, mental models, can remain replaceable derived machinery behind that core.
