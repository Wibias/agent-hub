# Reference Graph P3 Live Shadow Deployment Design

Date: 2026-10-23

Status: design approved in chat; implementation is not authorized until this written spec is reviewed and an implementation plan is approved.

## Goal

Operate the Reference Graph end to end on a dedicated Supabase project and collect durable live lexical, semantic, and hybrid shadow evidence without changing production retrieval.

P3 turns the P1/P2 deploy-ready stack into an explicitly bound, inspectable live shadow environment. It does **not** make Reference Graph the production selector, change `design-with-ai`, introduce browser capture, or treat retrieval feedback as memory authority.

## Why P3 exists

P0 established the data and authority contracts. P1 added deterministic PostgreSQL/Supabase persistence, service-role-only RPCs, catalog import, and shadow evaluation. P2 added real 384-dimensional embedding generation and semantic/hybrid measurement.

P2 produced two important findings:

1. the current legacy selector is not a healthy live quality benchmark because only 2 of 600 reviewed catalog records remain fresh under the existing TTL policy;
2. against the healthy 2026-07-21 snapshot, none of the measured semantic/hybrid challengers met the independent cutover thresholds or beat the lexical baseline on both quality measures.

P3 therefore has an operational objective, not a ranking-tuning objective: prove that the same contracts work against a real, dedicated Supabase target and record comparable live evidence while production remains unchanged.

## Explicit non-goals

P3 does not:

- switch production selection away from the legacy design-reference selector;
- modify `skills/design-with-ai/**`;
- add a browser extension, share sheet, automatic web capture, or ingestion crawler;
- create automatic Reference Graph -> Memory Claims;
- lower P2 cutover thresholds;
- tune ranking weights merely to improve agreement with the legacy selector;
- add ANN/HNSW/IVFFlat indexes;
- reuse an ambiguously identified Supabase project by assumption;
- expose `service_role` credentials to client code or repository files.

Capture UX, feedback-driven curation, and selective `design-with-ai` consumption belong to P4+ after the live backend has been exercised safely.

## Target strategy

### Dedicated project required

The currently connected Supabase account contains one active project with a generic account-derived name. That project is not considered an authorized Agent Hub target.

P3 uses a **dedicated Supabase project** whose purpose is unambiguous from its project metadata. The intended project name is `agent-hub-reference-graph` unless the user chooses another explicit name during project creation.

The preferred region is `eu-central-1`, matching the user's existing Supabase geography and keeping the dedicated service in the same broad region. Project creation remains a separately authorized infrastructure action because Supabase project creation may incur recurring cost and requires an explicit organization selection.

No migration, import, embedding persistence, or destructive database action may run until the dedicated project exists and its identity is bound explicitly.

### Target binding

P3 introduces a non-secret target binding containing only stable public identity metadata:

```json
{
  "purpose": "agent-hub-reference-graph",
  "project_ref": "<explicit project ref>",
  "project_name": "agent-hub-reference-graph",
  "region": "eu-central-1"
}
```

The binding may live in a repository configuration file after the project exists because project ref/name/region are not service credentials. Secret/service-role keys remain outside the repository.

Every live CLI path must receive or resolve the expected project ref and verify that the Supabase URL host matches it before performing a write. A URL/key pair alone is not sufficient authorization.

## Security model

P3 preserves the P1 service boundary:

- canonical tables remain under the non-exposed `reference_graph` schema;
- RLS remains enabled on all Reference Graph tables;
- public RPCs remain callable only by `service_role`;
- `public`, `anon`, and `authenticated` keep no execute access to privileged Reference Graph RPCs;
- the service-role key is server-side/trusted-runner only;
- external reference content remains untrusted data and never becomes executable instructions;
- relevance, similarity, repeated use, or live deployment never confer Memory authority.

Before and after live schema changes, P3 runs Supabase security and performance advisors. Any security finding attributable to the Reference Graph deployment is a blocker. Performance findings may be documented if they are expected at the 600-record scale and do not indicate correctness or access-control risk.

P3 does not add new `SECURITY DEFINER` functions unless unavoidable. If a new privileged function is required, it must revoke default `PUBLIC` execute privileges explicitly, grant only the intended trusted role, use a fixed safe `search_path`, and receive a dedicated permission test.

## Deployment state machine

P3 deployment is an explicit, fail-closed sequence. No single command silently performs every phase.

### Phase 0: preflight

Read-only checks:

- resolve target binding;
- verify expected project ref against Supabase URL;
- read project status/region when the connected Supabase control plane is available;
- verify required credentials exist without printing them;
- query live Reference Graph stats if the RPC surface already exists;
- inspect migration/deployment receipt state;
- refuse execution if the target cannot be proven to be the bound project.

### Phase 1: schema

Apply migrations `001`, `002`, and `003` in order to an empty dedicated target.

Schema application must be idempotent only where the committed SQL already guarantees it; P3 does not paper over migration errors. A partial migration is a failure requiring inspection before retry.

After schema application:

- verify expected tables/functions exist;
- verify `service_role` access;
- verify `anon` denial;
- run Supabase security/performance advisors;
- record migration verification in the deployment receipt.

### Phase 2: catalog import

Run the existing deterministic 600-record import against the bound target.

Expected post-import invariants:

- 600 catalog records planned;
- 600 assets persisted;
- 576 unique sources under the current reviewed catalog;
- no dropped records;
- server-side stats match the import plan.

The import remains repeatable through deterministic IDs/upserts. A rerun must not create duplicate canonical assets.

### Phase 3: embeddings

Embedding persistence is optional for lexical-only live validation and remains explicitly experimental.

If enabled:

- use the P2 profile identity exactly as committed;
- verify local Ollama model identity/revision before generation;
- generate one vector for every current searchable catalog chunk;
- require `--allow-experimental` for persistence;
- verify persisted embedding count, model ID, model revision, text hash, and 384 dimensions;
- never interpret successful persistence as cutover approval.

If embeddings are skipped, live semantic/hybrid evaluation is marked unavailable rather than failed.

### Phase 4: live shadow evaluation

Run the fixed 24-case suite against the deployed store.

P3 records three evidence classes independently:

- `supabase-lexical`;
- `supabase-semantic` when compatible persisted embeddings exist;
- `supabase-hybrid` when compatible persisted embeddings exist.

Every live run uses:

- the same case set as P2;
- the healthy benchmark control time `2026-07-21T12:00:00.000Z` for quality comparison;
- separately reported current legacy-control health;
- the same cutover thresholds as P2.

Production output is never sourced from the deployed challenger in P3.

## Deployment receipt and evidence

P3 adds a durable, non-secret deployment/evidence receipt. The receipt records enough identity to reproduce and audit the run without storing credentials.

Minimum receipt fields:

- schema version;
- target purpose;
- project ref;
- project name;
- region;
- P3 Git commit SHA;
- migration identifiers/checksums;
- import counts and resulting live stats;
- embedding profile/model/revision when used;
- persisted embedding count when used;
- benchmark control time;
- current control health;
- lexical/semantic/hybrid metrics;
- cutover blockers;
- `cutover_ready` result;
- verification timestamp;
- relevant GitHub Actions/evidence run IDs when applicable.

The durable repo artifact contains no service-role key, database password, access token, or full Authorization header.

A deployment receipt is evidence, not authority. It cannot change production routing by its presence alone.

## CLI / operator surface

P3 should prefer extending the existing Reference Graph CLIs or adding one focused deployment CLI rather than creating an orchestration framework.

The operator surface must preserve these modes:

- `--plan` / preflight: read-only where practical;
- explicit schema/apply operation;
- explicit import apply operation;
- explicit embedding apply operation with `--allow-experimental`;
- explicit live shadow operation;
- no implicit production cutover command.

Every mutating phase requires the bound target identity and explicit write intent. Commands must fail closed on missing/mismatched target identity.

## Observability

P3 requires enough visibility to distinguish transport/deployment failures from retrieval-quality failures.

For every live shadow run, record:

- RPC failures/timeouts by operation;
- case count and comparable-case count;
- graph empty rate;
- latency summary per retrieval class where available;
- source/platform constraint rates;
- overlap/top-1 quality metrics;
- model identity for semantic/hybrid runs.

Logs must redact service-role credentials and avoid dumping full captured external content unless explicitly needed for debugging.

Supabase project logs may be queried during deployment verification when a database/PostgREST failure requires diagnosis, but log inspection is not a substitute for deterministic tests and receipts.

## Failure and rollback behavior

P3 avoids destructive rollback automation.

On failure:

- stop at the failing phase;
- preserve the dedicated project for inspection;
- do not continue to later phases;
- do not switch production retrieval;
- record the failed phase and safe diagnostic metadata;
- retry only after the cause is understood.

Because the target is dedicated and production does not depend on it, the safest rollback for P3 is usually to leave the failed shadow environment isolated, fix the migration/import path, and recreate the dedicated project only when necessary and explicitly authorized.

No automated action pauses, deletes, or recreates a Supabase project.

## Testing strategy

### Repository contracts

TDD adds tests for:

- target binding validation;
- Supabase URL/project-ref mismatch rejection;
- credential redaction;
- phase state transitions;
- idempotent import expectations;
- receipt schema and secret scanning;
- semantic-unavailable vs semantic-failed distinction;
- production source remaining `legacy-control`;
- no `design-with-ai` file changes in the P3 stack.

### Disposable PostgreSQL

Permanent CI continues to execute all migrations against fresh PostgreSQL + pgvector and verify privileged/anonymous RPC behavior.

### Live target verification

After explicit target creation/authorization, P3 verifies against the dedicated project:

1. target preflight passes;
2. migrations apply;
3. advisors show no new blocking security issue;
4. 600-record import invariants hold;
5. optional experimental embeddings persist and match the pinned profile;
6. 24-case live shadow suite completes;
7. durable receipt is generated without secrets.

Live verification is evidence for P3 operation only; it does not authorize production cutover.

## Cutover policy

P3 cannot perform cutover.

The same P2 eligibility thresholds remain informational gates:

- at least 20 total cases;
- at least 20 comparable cases;
- average overlap-at-k >= 0.65;
- legacy top-1 retention >= 0.75;
- graph empty rate <= 0.05;
- exact surface rate >= 0.70;
- exact platform rate >= 0.80.

Even if a live challenger meets every threshold, the result is only `eligible_for_cutover_review: true`. A later, separately approved delivery must decide whether and how `design-with-ai` or another consumer reads Reference Graph in production.

## Delivery structure

P3 is stacked directly on the final P2 head and should remain independently reviewable from later capture/consumer work.

Expected P3 file classes:

- target-binding/deployment utilities under `reference-graph/`;
- focused CLI changes under `reference-graph/cli/`;
- P3 tests under `tests/reference-graph/`;
- P3 evidence/receipt under `reference-graph/evidence/` after live verification;
- P3 design/plan documentation;
- only the minimum permanent CI changes needed to keep non-secret deployment contracts testable.

No `skills/design-with-ai/**` change belongs in P3.

## Acceptance criteria

P3 is complete when:

- a dedicated Supabase project is explicitly selected/created and bound to the Reference Graph purpose;
- no ambiguous existing project is mutated;
- target identity is verified before every live write;
- migrations `001`/`002`/`003` are applied successfully to the dedicated project;
- security advisors show no new blocking Reference Graph finding;
- the deterministic 600-record import completes and live stats match expected counts;
- experimental embeddings, if deployed, are pinned, explicitly acknowledged, and verified by count/model/revision;
- all 24 live shadow cases complete for every available evidence class;
- the benchmark snapshot and current legacy-control health remain separately reported;
- a durable secret-free P3 deployment/evidence receipt is committed;
- permanent Reference Graph and broad Agent Hub governance introduce no new failures;
- production selection is still `legacy-control`;
- no `skills/design-with-ai/**` file is changed;
- no live cutover occurs.

## Deferred to P4+

After P3 proves the live backend path, later deliveries may independently add:

- frictionless browser/share capture;
- Supabase Storage for screenshots/media;
- automated enrichment and multimodal extraction;
- human curation and preference labels;
- usage-feedback learning;
- selective Reference Graph retrieval inside `design-with-ai`;
- cutover experiments or consumer-specific rollout.

Those features must reuse P3's target binding, provenance, authority, and evidence boundaries rather than bypassing them.
