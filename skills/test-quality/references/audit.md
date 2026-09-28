# Test-quality audit

Use this reference after `SKILL.md` selects audit mode.

## Value bar

A test earns its maintenance cost by independently protecting meaningful
behaviour, an invariant, a credible regression, or another durable contract.

Do not delete a test merely because it is slow, static, low-level, old, or
implementation-looking. First prove that the contract is absent, duplicated by
stronger proof, or coupled only to an incidental implementation detail.

A retained test that already fails on the baseline can indicate a product bug.
Reproduce and classify the failure before deleting the test.

## High-signal smells

Treat these as candidates for investigation, not automatic deletion:

- assertion-free coverage probes;
- self-comparisons or identity copies;
- expected values produced by the code under test;
- copied inventories, manifests, export lists, or source strings with no
  independent external contract;
- tests of private predicates or call shape when a stable owner boundary already
  proves the same behaviour;
- repeated tests of the same contract at several layers without distinct risks;
- provider-local or adapter-local replays of a shared helper's contract;
- tests whose only purpose is preserving test-only exports, globals, wrappers,
  reset hooks, injection parameters, or feature flags;
- dead production paths whose only callers are tests;
- mocks that implement the behaviour being asserted;
- fixtures that supply the receipt, ordering, admission, persistence, or state
  transition that the production owner should produce;
- capability tests that only restate a declared flag instead of exercising the
  promised capability;
- negative controls that pass for an unrelated reason;
- test names that promise behaviour the inputs or assertions never exercise.

A test that breaks under a behaviour-preserving refactor is suspect. Determine
whether it guards a real lower-level contract before rewriting or removing it.

## Retention bar

Keep a test when it independently enforces a meaningful contract such as:

- public or package APIs;
- protocols and wire formats;
- configuration semantics and defaults;
- migrations and storage compatibility;
- security and authorisation invariants;
- platform behaviour;
- release or package artefacts;
- generated cross-language contracts;
- observable ordering, retries, cleanup, or lifecycle behaviour;
- a demonstrated regression with a credible failure mode.

Source inspection can be valid when source bytes, keys, paths, generated output,
or package contents are themselves the contract. Prefer the cheapest independent
guard that fails when the contract changes and survives irrelevant refactors.

## Candidate ledger

Record this evidence before deleting or consolidating a candidate:

- exact test name and location;
- protected contract, or evidence that no independent contract exists;
- credible failure it can detect;
- current production owner and non-test callers of any related seam;
- stronger remaining proof and why it owns the contract;
- overlap with sibling tests;
- relevant history when it explains why the test or seam exists;
- production or test-support code the change can remove;
- risk of the edit;
- smallest focused validation command.

If a material field is unknown, inspect further before deletion.

## Classification

Use one of four marks:

- `R` retain: the test owns a distinct valuable contract.
- `F` fix: retain the contract but repair a weak, vacuous, or misleading test.
- `C` consolidate: move the useful assertion into the primary owner and remove
  the duplicate layer.
- `D` delete: no independent contract remains, or stronger proof already owns it.

For `C` and `D`, name the proof that remains.

## Edit shape

Work in one coherent owner-boundary batch.

When a test-only production seam becomes unnecessary, remove the seam rather
than preserving an alias solely for compatibility with deleted tests.

Prefer extending an existing table-driven case, fixture, or owner suite over
adding a near-duplicate test. Consolidate repeated setup when that simplification
belongs to the same change.

Do not create replacement tests that preserve the same implementation coupling.
Do not turn uncertain candidates into cleanup just to increase deletion count.

Net-negative production code can be a useful result when dead test seams
disappear, but line count is not the objective.

## Validation and review

Run the smallest affected owner and sibling tests first. Then run repository
checks required by the changed surface.

For risky deletions, independently compare the removed proof against the keeper.
When uncertainty remains about whether the keeper can catch the contract, a
small deliberate mutation of the production owner can be useful: confirm the
keeper fails, then restore the source exactly.

Do not mutate production merely to create ceremony. Use mutation only when it
answers a real preservation question.

## Audit handoff

Report:

- categories of low-value tests found;
- `R/F/C/D` decisions for material candidates;
- keeper test or boundary for each consolidated/deleted contract;
- removed production seams;
- retained false positives and why they remain valuable;
- validation actually run;
- unresolved risks or follow-ups.
