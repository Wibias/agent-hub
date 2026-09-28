# Test-quality campaign

Campaign mode reviews one complete subsystem or similarly bounded test surface.
The `SKILL.md` value bar and `references/audit.md` rules apply to every step.

Do not use campaign mode for a handful of obvious tests.

## 1. Pin the baseline

Record the current Git revision, the declared subsystem scope, relevant test and
support files, and baseline pass/fail state.

Keep baseline failures separate. A failing baseline test can expose a product bug
rather than stale coverage.

Done when every in-scope test file or scenario has a known baseline state.

## 2. Partition by owner boundary

Split the subsystem into lanes based on production ownership, not filename
prefixes. Include shared-core cases, integration harnesses, QA scenarios, and
project-local runtime tests that the subsystem actually owns.

Each in-scope test belongs to exactly one lane.

Done when the inventory is complete and non-overlapping.

## 3. Build a read-only ledger

Review every test declaration in each lane. Read parameter tables, fixtures, the
production owner, entry points, non-test callers, relevant history, and CI
routing.

Mark each declaration:

- `R` retain, with the contract it owns;
- `F` fix, with the assertion or setup defect;
- `C` consolidate, with the owner that will absorb the useful proof;
- `D` delete, with the proof that remains or evidence that no contract exists.

Judge assertions and executable behaviour, not test names.

Done when every in-scope declaration has one mark and one evidence line.

## 4. Plan layers, not isolated deletions

Use the ledger as evidence, then identify redundant test layers.

For every contract, name the keeper boundary. Prefer the narrowest stable
boundary that exercises the real production path with faithful substitutes at
actual external seams.

The plan must identify:

- keeper suite or test for each contract;
- files or declarations to retire;
- assertions that must move into a keeper first;
- test-only production seams the cutover can remove;
- CI or inventory changes required by moved tests.

Done when each lane has a coherent cutover plan.

## 5. Apply the cutover

Edit lane by lane. Serialise changes to shared harnesses or support files through
one owner.

Move useful assertions before deleting their old owner. Remove obsolete
test-only hooks and dead support paths in the same coherent change when safe.

Run each lane's focused tests as it lands.

Done when every lane plan is applied and the keepers pass.

## 6. Preservation review

Use an independent review pass for high-risk deletions or broad consolidation.

Compare deleted coverage against the keepers. Look for:

- contracts that lost their only proof;
- negative tests that now pass for the wrong reason;
- unreachable assertions;
- fixtures that bypass the production path;
- platform, persistence, security, migration, packaging, or ordering contracts
  accidentally removed with a duplicate layer.

When a restored contract still has uncertain failure sensitivity, deliberately
mutate the production owner, confirm the keeper fails, then restore the source
exactly.

Done when reported preservation gaps are restored or rejected with evidence.

## 7. Product defects

A baseline failure that remains in a legitimate keeper is not test-cleanup
success. Treat it as a product defect.

Fix it only when that repair is inside the authorised scope. Otherwise record a
follow-up with the reproducer and owning boundary.

Do not delete or weaken the test to make the campaign green.

## 8. Reconcile and hand off

If the campaign spans upstream changes, refresh against the current target
branch and ensure new regressions or tests still have a clear owner.

Rerun the complete subsystem suite and any project-required checks.

Report:

- baseline and final test/support size when useful, with production code separate;
- lanes and keeper boundaries;
- `R/F/C/D` totals with material decisions;
- production seams removed;
- preservation gaps found and how they were proved;
- product defects discovered;
- focused and broad validation actually run;
- unresolved follow-ups.

The success metric is clearer ownership and preserved confidence, not maximum
deletion.
