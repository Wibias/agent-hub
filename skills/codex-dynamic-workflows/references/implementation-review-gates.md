# Implementation packet acceptance gates

This reference belongs to `codex-dynamic-workflows`. Use it only for
independent implementation packets with a meaningful spec or contract. It
does not replace `github-delivery` PR review, security policy, or the
repository's own required CI.

## Decide whether a packet gate helps

Use a task gate when the work changes substantive behavior, has distinct
acceptance criteria, and independent review could catch a spec mismatch
before integration. A one-line edit, read-only exploration, or cheap
deterministic check does not automatically earn a fresh agent. If the
runner cannot provide a truly separate reviewer, use the main worker to
inspect the work and label that check **self-review**, not independent review.

## Packet contract before dispatch

Record the packet ID, exact user-approved requirements, exclusions, owned
files, base/current HEAD, dependencies, observable acceptance criteria,
expected test commands, and evidence pointers. Give workers only the
context needed for that packet. Do not allow overlapping write ownership
without isolated worktrees and an explicit integration owner.

When a behavior-level test is suitable, the implementer uses `tdd` for
a valid RED -> GREEN cycle; the reviewer evaluates actual test evidence,
not a claim that TDD happened.

## Acceptance after the implementation

One independent reviewer can return two **separate** verdicts on the same
current task diff. Two separate review agents are not mandatory.

1. **Spec compliance**: check the changed behavior against every packet
   acceptance criterion, including missing paths, omissions, changed
   scope, and observable negative cases. Identify the exact evidence for
   each verdict. A plausible implementation is not proof.
2. **Code quality and risk**: inspect correctness, security boundaries,
   maintainability, non-test consumers, test usefulness, regressions and
   integration risks. Reject self-confirming mocks, stale test results,
   and unverified platform behavior.

Reviewer input is the authoritative packet spec, the actual diff, the
minimal relevant baseline/contract, and commands/receipts. Do not pass
the implementer's confidence statement or private narrative as evidence.

Both verdicts must be `pass` before this packet is accepted for integration.
Use `fail` for a demonstrated defect, `blocked` when review evidence is
missing, and `pass` only when evidence supports the claimed coverage.
Keep `blocked` visible instead of converting it into a weak pass.

## Bounded fix loop

Return actionable findings to the implementation owner, fix the smallest
responsible cause, rerun affected tests, and review the new diff. Record
each round and what changed. After two unsuccessful rounds for the same
finding, stop automatic repetition and escalate the unresolved decision
or evidence gap; do not launch endless fresh agents or reviewers.
A moved base/HEAD invalidates old review evidence for affected files.

## Final integration

The manager reconciles all accepted packet output against the **whole**
requirements set. Run integration checks at the current HEAD and only
then hand off GitHub publication/review/merge to `github-delivery`.
Packet approval is not permission to push or merge and cannot waive
required CI, security review, or user authorization.
