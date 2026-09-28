# Project quality contract

## Detect first

Before writing a contract, inventory the repository's actual stack, commands and existing standards. Reuse an established equivalent quality file when one exists. `CONSTRAINTS.md` is the Hub default only when the repository has no stronger convention.

## Minimum shape

```markdown
# Constraints

Last reviewed: <date>

## Floor
- No new check-suppression comments without an explicit tracked exception.
- No skipped/deleted tests or removed assertions merely to obtain green.
- No unfinished production stubs or empty error swallowing.
- No secrets in source or logs.
- Do not weaken this file to make a candidate pass.

## Enforced
| Dimension | Rule | Command | Runs at |
|---|---|---|---|
| Types | zero repository-defined type errors | `<repo command>` | edit/task |

## Measured ratchets
| Metric | Verified baseline | Direction | Command |
|---|---:|---|---|
| <metric> | <value> | must not regress | `<command>` |

## Exceptions
| ID | Rule | Scope | Reason | Owner | Expires/removal condition |
|---|---|---|---|---|---|
```

## Rules

- **Project commands win.** Do not install a second linter/test runner when the repository already has one.
- **No fictional enforcement.** Every enforced row must name a command that can actually produce the verdict.
- **Measured beats invented.** If the team has no justified target, measure the current state and hold the line.
- **Tightening is easy; loosening is explicit.** A stricter threshold can be a normal change. A weaker threshold or broader exception must be called out in review.
- **Cost determines placement.** Keep the inner loop fast. Expensive mutation tests, browser audits, dependency scans or load tests belong later unless the project explicitly requires them earlier.
- **External checks reduce circularity.** When appropriate, prefer at least one independent source of truth such as a compiler, vulnerability database, accessibility engine or real runtime measurement rather than relying only on agent-authored tests.
- **Prototype exception.** Throwaway prototypes can use a reduced floor when their owner skill explicitly says so; do not silently apply production constraints to disposable exploration.
