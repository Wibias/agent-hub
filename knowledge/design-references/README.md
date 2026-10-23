# Design Reference Intelligence Library

Curated, reusable design evidence for design-with-ai. The committed library
contains structured observations and source links, not mirrored third-party
screenshots.

## Commands

Run these commands from this directory:

    node .\\scripts\\validate.mjs
    node .\\scripts\\validate.mjs --cache-root "$env:USERPROFILE\\.agents\\.cache\\design-references"
    node .\\scripts\\validate.mjs --production
    node .\\scripts\\build-index.mjs
    node .\\scripts\\query.mjs --profile deep --surface operator-control --job "launch or resume a stream tool" --platform web-responsive --dimensions ia,visual-world,responsive
    node .\\scripts\\freshness-report.mjs --offline
    node .\\scripts\\cache-cleanup.mjs --days 180
    node .\\scripts\\new-record.mjs --surface public-home --stratum direct-domain
    node .\\scripts\\review-batch.mjs --input .\\data\\wave-a.jsonl --review-log .\\reviews\\wave-a.jsonl --output .\\data\\wave-a.reviewed.jsonl
    node .\\scripts\\review-patterns.mjs --input .\\patterns\\candidates.jsonl --review-log .\\reviews\\patterns.jsonl --output .\\patterns\\reviewed.jsonl
    node .\\scripts\\revalidate-batch.mjs --plan --review-log .\\reviews\\p4-wave-01.jsonl
    node .\\scripts\\revalidate-batch.mjs --apply --review-log .\\reviews\\p4-wave-01.jsonl

All scripts use Node.js built-ins only.

## Storage contract

- Records are split into JSONL shards under data/.
- index.json and INDEX.md are generated and committed.
- Screenshots live below USERPROFILE/.agents/.cache/design-references/<record-id>/.
- Cache folders contain manifest.json, optional originals, and previews.
- Cache cleanup is dry-run by default. `approved-comparison` manifests are
  retained; only an explicit `--apply` removes expired cache directories.
- The cache is local, gitignored, never bulk-loaded into model context, and may
  only contain captures allowed by the record's rights decision.
- Directory pages, search results, pricing pages, and vendor corpus claims do
  not qualify as references.

## Review contract

Records enter as candidate. A different reviewer verifies the underlying
source, observations, evidence class, rights decision, and duplicate status.
Only reviewed, non-stale records are eligible for normal task selection.
Stale and archived records remain as provenance and are never silently deleted.
Queries append only selected record IDs and coarse request metadata to the local,
gitignored cache so quarterly maintenance can include frequently used records.

P4 separates revalidation from original review authority. A `confirm` decision
may advance `lastVerifiedAt` and update access state only after the verifier has
explicitly checked the source, the referenced analysis, and the rights decision.
It does **not** change `reviewedAt` or `reviewedBy`. A link-health HTTP success is
triage/maintenance evidence only and cannot make a record fresh by itself.

## P4 maintenance and revalidation

P4 freezes the full stale maintainable population independently of the shadow
benchmark. The queue must be benchmark-independent: case membership and expected
retrieval results never decide which records are refreshed.

From the repository root, inspect the deterministic full stale maintainable
queue before any review work:

    node reference-graph/cli/plan-revalidation.mjs --now 2026-10-23 --wave-size 50

A revalidation decision is explicit evidence. It must include a stable record ID,
`verifiedAt`, verifier identity, `sourceChecked: true`, `analysisChecked: true`,
`rightsChecked: true`, an access status, a substantive note, and one verdict:
`confirm`, `stale`, or `archive`.

Use `revalidate-batch.mjs --plan` before `--apply`. Confirmed records retain their
existing review authority while advancing verification freshness; stale/archive
outcomes remove records from normal selection without deleting provenance.
Incomplete waves stay incomplete. Do not extend TTLs, mass-rewrite timestamps, or
stop after only the references used by a benchmark happen to become fresh.

## Maintenance

- Monthly: run the health report with live links and use link health for triage
  and maintenance planning only; it is not a revalidation decision.
- P4/full refresh: process the entire stale maintainable population in the frozen,
  benchmark-independent deterministic waves until every target has a terminal
  decision or record the run as incomplete.
- Quarterly: generate a queue covering at least 15 percent of the oldest,
  most-used, or highest-risk records for ongoing post-P4 maintenance.
- Task time: revalidate stale or decision-critical records and return new
  discoveries as candidates.
