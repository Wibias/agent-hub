# Swift core language defaults

Use for data modeling, API design, ownership, protocols/generics, errors, and
ordinary refactoring. These are durable defaults, not a substitute for project
conventions or current official documentation when a behavior is toolchain- or
release-specific.

## Narrow defaults first

Move to a more dynamic or expensive construct only when the requirement names the
reason.

| Need | Default | Widen only when |
|---|---|---|
| data | `struct` / `enum` | identity, shared lifetime, inheritance, or framework contract requires reference semantics |
| mutation | `let` | the value genuinely changes |
| abstraction | concrete type | repeated behavior across types justifies abstraction |
| polymorphism | generics / `some P` | heterogeneous runtime storage or dynamic replacement requires `any P` |
| failure | typed domain state / `throws` | programmer invariant violation should stop loudly instead |
| memory/unsafe APIs | safe standard-library values | profiling or C/system interop demonstrates the need |

## Value semantics

Prefer values for models. A class is not "more powerful struct"; use reference
semantics when identity or shared mutable lifetime is part of the model.

Watch for structs that contain mutable reference-type storage: copying the struct
may still share the referenced object. Preserve value semantics through immutable
references, explicit ownership, or copy-on-write when that complexity is earned.

Enums with associated values are often the best representation for mutually
exclusive states. Prefer a model where invalid combinations cannot be
constructed over a bag of booleans/optionals whose legal combinations live only
in comments.

When ownership-sensitive/noncopyable features are considered, first confirm the
project's Swift language mode and current compiler support from official sources.
The stable principle is unique ownership where duplicate use is semantically
invalid; exact syntax/support is version-sensitive.

## Errors and invariants

Separate recoverable operational failures from programmer mistakes:

- recoverable user/network/data/environment failures should travel through an
  explicit result/throwing path with enough context to act;
- violated internal invariants should fail loudly at the invariant boundary;
- use `guard` for early failure paths when it makes the successful path clearer;
- force unwrap only when the invariant is locally provable and a clearer guarded
  form would not improve the code.

Public error surface is an API design choice. Do not freeze typed/untyped throws
or another release-sensitive feature into a public contract merely because the
current compiler supports it; evaluate compatibility and verify current official
docs when needed.

## Protocols, generics, and existential cost

Prefer static relationships when the set of concrete types does not need runtime
heterogeneity. Reach for existential storage only when the product/API actually
needs values of different conforming types in one runtime container or boundary.

Do not introduce protocols merely to make one implementation "mockable" or to
mirror class-oriented architecture from another language. Extract a protocol when
it expresses a real substitutable capability or boundary.

## API design

- make illegal states hard to express;
- prefer names that read clearly at the call site;
- keep visibility as narrow as practical;
- expose values/operations rather than internal storage representation;
- preserve project/API compatibility unless the task authorizes migration;
- when a framework protocol or generated interface constrains the signature,
  verify the exact current contract rather than fighting it from memory.

## Verification

For ordinary language refactors, compile/test the affected targets and exercise
semantic behavior. When the answer depends on the project's Swift tools version,
language mode, compiler diagnostics, package manifest features, macros, or SDK
surface, hand the factual lookup to `source-driven-development` and current
official Swift/Apple/package documentation before coding.

Source lineage: durable modeling/API ideas selectively adapted from
`emilkowalski/skills` `write-swift` (MIT), deliberately separated from its
release snapshot.
