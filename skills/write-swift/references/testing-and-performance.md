# Swift testing and performance

Use for tests, benchmarks, allocation/ARC concerns, algorithmic/runtime
optimization, and unsafe/specialized constructs. Project conventions and measured
evidence outrank generic optimization advice.

## Testing posture

Test observable behavior and invariants at the narrowest useful boundary. Prefer
the project's existing test framework and conventions; do not migrate XCTest,
Swift Testing, snapshot tools, or package structure merely because another style
is newer.

For new tests in a project already using current Swift Testing, use its established
patterns. If choosing or migrating test frameworks depends on current toolchain
support, macros, package manifest syntax, IDE integration, parameterized testing,
or newly introduced APIs, verify the project's constraints and current official
Swift documentation through `source-driven-development`.

Concurrency tests should prove semantic ordering/cancellation/ownership behavior
without depending on arbitrary sleeps. Use controllable dependencies, explicit
signals, or the framework's supported async test primitives. A test that merely
waits longer is usually a race disguised as verification.

When a bug fix changes a durable invariant, add a regression that would fail on
the old behavior before claiming the fix complete.

## Performance order

Optimize in this order:

1. prove the workload and baseline are representative;
2. find the actual limiter with Instruments/metrics/profiling appropriate to the
   project;
3. remove unnecessary work or improve the algorithm/data flow;
4. reduce allocations/copies/ARC traffic where measurement shows they matter;
5. choose more specialized standard-library/language facilities;
6. only then consider unsafe memory or implementation-specific tricks.

Do not add concurrency to slow code until profiling shows concurrency addresses
the limiter. Faster serial work is simpler than parallel overhead when it meets
the budget.

## Value/reference and ARC costs

Value types are not automatically cheaper and classes are not automatically
slower. Copy-on-write, bridging, heap storage, captures, and generic
specialization all matter. Profile the actual candidate.

Look for ownership/lifetime patterns that retain large object graphs, accidental
strong capture cycles, repeated conversion/bridging, temporary allocations in hot
loops, and unnecessary copying. Fix the proven lifetime/work problem rather than
turning every reference into `weak` or every collection into unsafe storage.

## Unsafe and specialized APIs

Unsafe pointers, manual buffers, atomics/locks, noncopyable/inline-storage
features, macros, and newly introduced performance facilities require a concrete
interop/hot-path/ownership reason. The exact APIs, availability, semantics, and
compiler support are version-sensitive: verify current official documentation for
the project's toolchain before implementation.

Keep the unsafe surface small and wrap it behind an interface whose invariants can
be tested from safe code.

## Verification

Before calling Swift engineering work complete:

- run the affected package/target tests;
- run the actual build configuration relevant to the change when compiler or SDK
  behavior matters;
- for concurrency changes, exercise cancellation/failure and repeated runs where
  races would surface;
- for performance claims, record before/after measurement with the same workload;
- for memory/lifetime claims, use appropriate Instruments/runtime evidence rather
  than inferring leaks from code shape alone;
- surface non-zero build/test/profiler commands and do not call the change
  verified when required evidence failed.

A read-only/write-denied target is not a successful implementation. Confirm no
mutation when the host can inspect it and report the denial plainly.

Source lineage: durable testing/performance guidance selectively adapted from
`emilkowalski/skills` `write-swift` (MIT), with toolchain-specific facts delegated
to current official sources.
