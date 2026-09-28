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

## Maintenance

- Monthly: run the health report with live links and review access changes.
- Quarterly: generate a queue covering at least 15 percent of the oldest,
  most-used, or highest-risk records.
- Task time: revalidate stale or decision-critical records and return new
  discoveries as candidates.
