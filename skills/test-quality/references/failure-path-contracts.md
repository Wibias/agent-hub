# Failure-path test evidence (conditional)

Load only when reviewing, designing or changing **tests of error propagation, recovery, fallbacks or partial failure**. This is a test-value lens owned by `test-quality`, not a second code-review process and not a requirement to test every catch block. The standard `github-delivery/references/bug-review.md` already covers silent failures in PR source changes; do not duplicate it here.

## Choose the independently observable contract

For the changed behavior, identify one real caller or user-facing boundary and answer:

1. **Failure stimulus**: Which realistic, controlled failure can occur at this boundary (timeout, malformed input, denied write, rejected promise, partial batch, interrupted flow)? Do not induce destructive production side effects.
2. **Required outcome**: Does the caller receive an error, retryable status, explicit partial success, rollback, or visible recovery? What must **not** happen, such as pretending success or losing an operation?
3. **Actual propagation**: Follow the code from fault to callback/result/UI/log/queue. Identify swallowed exceptions, fail-open defaults, ignored promises, detached tasks, misleading success states and cleanup holes with concrete source evidence. A `catch` is not automatically a defect; evaluate whether its fallback is the documented behavior.
4. **Test ownership**: Find the narrowest stable boundary that observes the result. Prefer a regression that would **fail if the original silent-failure bug returned**. Avoid mocking the very handler whose propagation is under test. Use an existing integration/runtime suite only if it owns a distinct transport, lifecycle or recovery risk.
5. **Verify the negative contract**: Where relevant, assert absence of success/commit, preservation of prior valid state, retry eligibility and cleanup. An assertion that merely checks a logged string, a spy call or no thrown exception often cannot establish caller-visible correctness.
6. **Report gaps**: Mark missing runtime access `NOT_VERIFIED`, not a passed recovery test. If code under review is actually broken, hand the concrete code finding to the owning PR/implementation reviewer; `test-quality` owns only test selection and integrity.

Compact output when applicable:

| Fault + boundary | Required visible outcome | Existing test owner | Distinct gap / credible regression | Proposed test or explicit reason not to add |
| --- | --- | --- | --- | --- |
| Server rejects save | user sees retry, prior data retained | settings integration test | caught exception is silently ignored | verify notification, unchanged state and retry eligibility |

No new global mandatory test suite, test-only production API, or duplicated cross-layer tests is justified by this reference alone.
