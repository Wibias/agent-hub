# Retrospective enforcement ladder

Use this reference only after evidence shows a repeated mistake class or when the
user explicitly asks to make a known mistake structurally harder to repeat.

## Evidence gate

A repeated class requires at least two independent occurrences with the same
underlying failure shape. Record the concrete evidence for each occurrence.

Do not count:

- two log lines from one incident;
- one failed fix and its immediate retry;
- two different mistakes that share only a broad label such as "tests";
- a hypothetical risk with no observed occurrence.

## Enforcement order

Choose the highest level that reliably prevents the mistake without creating a
larger design problem.

1. **Architecture or ownership.** One owner for each state or responsibility.
   Keep one supported way to perform a task. Hide internals that callers should
   not import. Derive duplicated lists from one source of truth.
2. **Types or schemas.** Make invalid states or boundary data fail before runtime
   when the language and data boundary support it.
3. **Lint, validation, pre-commit, or CI.** Reject a mechanical pattern with an
   error that names the supported replacement or remediation.
4. **Behavioral test.** Exercise the real public seam and fail on the historical
   behavior, not an implementation detail.
5. **Judgment rule or navigation pointer.** Use prose only when the decision
   cannot be made mechanically or when the problem was information access.

Do not add a lower-level guard merely because it is easier if a higher-level
owner can eliminate the failure class cleanly.

## Existing debt

If the bad pattern is widespread, prefer a measured ratchet: block new instances
first, then migrate old ones deliberately. Route standing quality policy to
`quality-constraints`.

## Proof

For each deterministic prevention:

1. identify a real past failure or faithful minimal reproduction;
2. show the new guard fails on that bad state;
3. show the corrected state passes the same guard;
4. run the guard through the repository's normal local/CI path when available.

A green run on only the corrected code proves current correctness, not prevention.

## Exceptions

An exception must be explicit, local, justified, and removable. Follow the
repository's existing exception format. Do not invent a global waiver mechanism
inside this skill.
