# Swift concurrency defaults

Use for `async`/`await`, task structure, actors/isolation, `Sendable`, cancellation,
continuations, and data-race diagnostics. Detect the project's Swift tools version,
language mode, default actor-isolation settings, and deployment/framework context
before applying release-sensitive syntax or compiler rules.

When exact behavior depends on a Swift release, Xcode/toolchain, SDK, or evolving
concurrency feature, compose with `source-driven-development` and current official
Swift documentation. The principles below are the stable ownership model; exact
annotations and diagnostics may evolve.

## Buy concurrency only for a stated reason

Start with the simplest execution model that meets the requirement:

1. synchronous single-isolation code;
2. `async`/`await` for latency/suspension;
3. concurrent child work when independent operations materially benefit;
4. separate actor/isolation domains when shared mutable ownership requires them.

Do not create parallelism merely because a function is asynchronous. Do not move
CPU work off an actor from memory about what `async` means in a particular Swift
release; confirm project language mode and current official semantics when that
decision affects correctness/performance.

## Structured concurrency first

Prefer child tasks whose lifetime is bounded by the operation that owns them.
Use the language's structured constructs for fixed/dynamic sets of independent
work. Unstructured/root tasks are for lifetimes that genuinely do not fit a local
scope; detached execution needs an explicit reason.

Bound fan-out for large collections. One task per unbounded item can replace a
serial problem with scheduler/memory pressure.

Cancellation is cooperative. Long-running synchronous/iterative work must check
for cancellation at useful boundaries. A cancellation handler and the operation
it protects may interact concurrently; use the correct synchronization/ownership
model instead of assuming ordering.

## `await` is a transaction boundary

Suspension means assumptions can become stale before execution resumes. Re-check
state that can change across an `await`.

Actor isolation prevents simultaneous access to isolated state; it does not turn
an async method spanning multiple suspension points into one atomic transaction.
Keep invariant-preserving mutations in non-suspending isolated operations where
possible, and leave state consistent before every suspension.

Classic example: check cache → await fetch → write cache. Another task may fill
the cache while the first one is suspended. Re-check or deduplicate in-flight
work according to the product semantics.

Do not assume actor work is FIFO unless the documented mechanism guarantees the
ordering you require.

## Sharing and `Sendable`

Prefer not sharing mutable objects across isolation boundaries. In order:

1. keep ownership local;
2. pass immutable/value data;
3. isolate shared mutable state behind the correct actor/domain;
4. use explicit synchronization only when that model is truly required.

Treat unchecked/unsafe escape hatches as promises whose invariants the compiler
cannot prove. They require a concrete synchronization/interop reason and tests;
they are not warning suppressors.

A type being sendable, actor-isolated, or nonisolated is an API/ownership promise.
For public types or framework protocol conformances, verify current compiler and
library contracts before changing that promise.

## Bridging callbacks and streams

Continuation-based bridges have a strict lifecycle: every operation resumes its
continuation exactly once on every completion path, with cancellation/termination
handled deliberately. Prefer stream abstractions for multi-value callback/delegate
sources rather than repeatedly inventing single-shot continuation machinery.

Exact continuation/stream APIs and compile-time guarantees are version-sensitive;
verify current official docs before recommending newly introduced forms.

## UI concurrency

Semantic UI state remains on its intended UI isolation domain. Time-sensitive
visual/gesture feedback should update through the framework mechanism designed for
that frame rather than creating unnecessary async hops. Long-running work can
then proceed asynchronously and report semantic completion back.

Framework-specific SwiftUI/UIKit/AppKit actor annotations and callback isolation
are SDK/toolchain facts: inspect project constraints and current official docs
when they affect implementation.

## Debugging order for a concurrency error

1. Identify who owns the value and which isolation boundary is being crossed.
2. Ask whether the sharing/concurrency can be removed.
3. Prefer a value/immutable transfer if possible.
4. Isolate genuinely shared state.
5. Only then add lower-level synchronization or unsafe annotations.
6. Reproduce with the actual project's compiler/language settings and tests.

Do not "fix" a compiler data-race diagnostic by scattering annotations until it
compiles; preserve the intended ownership model.

Source lineage: stable concurrency/ownership principles selectively adapted from
`emilkowalski/skills` `write-swift` (MIT), with release-sensitive behavior routed
to current official sources.
