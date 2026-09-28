# Migration patterns

Adapted from `addyosmani/agent-skills` `deprecation-and-migration` (MIT).

## Replacement-first

Before compulsory removal, prove the successor covers critical use cases and has a migration path. If there is intentionally no successor, record what user/consumer capability is being removed and why.

## Strangler / incremental routing

Run old and new paths in parallel and shift bounded cohorts or traffic gradually. Each stage needs a rollback/cutback trigger based on real behavior, not elapsed time alone.

Useful when:
- a subsystem is large or externally consumed;
- production behavior cannot be exhaustively reproduced before rollout;
- the replacement can be routed by tenant, request, feature flag or endpoint.

## Adapter

Keep the old contract at the consumer seam while delegating into the new implementation. This can decouple consumer migration from backend replacement.

Use only when the adapter actually buys migration safety. Remove it after the last old-contract consumer leaves; a permanent compatibility wrapper becomes another system to maintain.

## Dual-run / shadow

For read/compute paths, send representative work to both implementations and compare outputs without making both authoritative. For write/effectful paths, do not blindly execute the side effect twice. Use shadow calculation, mirrored non-authoritative storage, or an explicitly idempotent design.

## Feature-flag/canary cutover

A flag may separate deployment from release. Define:
- owner;
- population/routing key;
- success/rollback measures;
- cleanup condition/date.

Test both states while both exist. Remove the flag and dead path after full rollout proves stable.

## Consumer migration packet

For each consumer record:

```text
Consumer:
Old touchpoints:
New touchpoints:
Compatibility assumptions:
Migration step:
Verification:
Rollback/cutback:
Remaining old references:
```

Do not declare the programme complete until every active consumer has a disposition: migrated, intentionally retained with owner, or proven inactive.
