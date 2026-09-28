# Verification maintenance contract

Maintain an existing project verifier without turning the maintenance pass into product development.

## Outcomes

Return exactly one lifecycle outcome:

- `clean`: source and live coverage found no verifier or feature-map drift worth changing;
- `changed`: verifier-owned files were corrected and the corrected path was re-driven;
- `blocked`: required source or runtime coverage could not finish safely.

A product regression is not verifier drift. Report it separately and leave product code unchanged unless the user separately authorizes product work.

## Scope

Edit only the selected project verifier directory during maintenance:

```text
<project>/.agents/skills/verify-<app>/
```

Product source, application tests owned by the product, and unrelated skills are read-only inputs to this pass.

## Source wave

1. Read `features/README.md` and enumerate every mapped feature.
2. Inspect the declared `Control surface` and confirm its canonical command and any verifier-owned helper still exist.
3. Use read-only subagents in parallel when the host supports them and the feature set is large enough to benefit.
4. Give each source reader one feature, source pointers, and a request for:
   - current user-facing behavior;
   - source entry points;
   - likely map or control-surface drift;
   - one concise live-drive recipe using the persistent control surface.
5. Readers do not edit files and do not drive the live application.
6. Reconcile overlapping recipes before runtime work. If multiple recipes recreate the same ad-hoc interaction, consolidate it into the verifier-owned control surface rather than retaining throwaway scripts.
7. Sweep recent user-facing source churn for concrete features missing from the map. Require a source path before adding a missing-feature claim.

## Live pass

The coordinator owns runtime driving.

Use one serial runtime driver unless the project verifier explicitly documents and proves independent runtime resources for concurrent instances. Source analysis may remain parallel even when live driving is serial.

For every mapped feature that is reachable in the current environment:

1. run Doctor before the first drive and after surprising behavior;
2. exercise the real user path through the declared persistent control surface;
3. capture observable outcome evidence;
4. verify material side effects;
5. clean residue created by the drive without deleting retained evidence.

A feature may be `verified-unreachable` only when the attempted route and concrete prerequisite are recorded. If the prerequisite is stable and missing from the feature map, that omission is verifier drift.

## Triage

- Wrong user-POV behavior description: update the feature map.
- Working behavior that the verifier cannot drive: extend or repair the declared reusable control surface; do not make a per-task script the maintained solution.
- Existing-mode command no longer covers repeated required interactions: extend the existing maintained interface when it owns that behavior, otherwise move the verifier to a small verifier-owned helper.
- Helper-mode command has drifted: repair only the verifier-owned helper and re-run its affected commands.
- Broken Doctor contract: repair the verifier, restart only what the correction invalidated, and retry.
- Product behavior is actually broken: report a product regression; do not rewrite the map to describe the bug as intended behavior.

Every changed drive, control-surface, or Doctor path must be exercised again before `changed` can be reported.

## Delivery boundary

Local verifier maintenance does not grant GitHub publication authority. Creating a branch, pushing, opening a PR, or posting a report to an external service follows the hub external-actions boundary and requires the user's authority.
