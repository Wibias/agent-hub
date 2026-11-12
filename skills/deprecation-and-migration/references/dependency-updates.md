# Dependency update and compatibility workflow

Owned by `deprecation-and-migration`. Use for dependency upgrades,
vulnerability-driven upgrades, major-version migrations, peer-dependency
conflicts, and lockfile repairs. Source-specific framework/API facts
come from official release and migration notes; load
`source-driven-development` only when the task calls for source-grounded
implementation or the current API is materially uncertain.

## Before changing versions

1. Identify the manager, manifest(s), lockfile(s), active runtime and
   deployment target. Pin currently resolved versions and affected
   direct/transitive dependencies.
2. Name the reason: security advisory, required feature, EOL, compatibility,
   or routine maintenance. For security, verify the advisory and affected
   versions from an authoritative source; do not accept an unaudited scanner
   suggestion as an automatic code change.
3. Read official release notes and relevant migration guide. Inventory
   breaking API, runtime, peer dependency, packaging and configuration
   changes. Name downstream consumers and rollback path.
4. Capture the smallest useful baseline: build, affected tests, runtime or
   package-specific smoke, and warnings already present.

## Update in bounded units

- Upgrade a coherent dependency group, not every outdated package. For
  majors, start with one breaking boundary and its consumers; fix subsequent
  consumers explicitly.
- Use the project's chosen package manager, preserving its lockfile and
  dependency graph. Check that manifest and lockfile agree. Inspect install
  scripts and transitive risks when introducing a new supplier/version.
- Never apply `--force`, broad automatic fix flags, or disable safety checks
  solely to obtain an install success. Record the version actually resolved,
  not just a range in the manifest.
- If a new version needs additional permission, secrets, native binaries, or
  production migration, request the relevant authorization before executing
  it. Do not start services or mutate production as a side effect.

## Validate and close

Run the original baseline commands and the narrow compatibility tests on
the updated lockfile. Test the runtime/OS paths that changed. Compare before
and after results and classify pre-existing failures separately. Confirm the
targeted advisory is fixed, or state why resolution remains blocked.
Check rollback feasibility with the previous pinned manifest+lockfile pair.
Document supported versions, unresolved breaking consumers, required
follow-up deployment changes, and verification gaps. GitHub delivery owns
the PR and release steps.

Do not equate "dependency manager exited 0" with production compatibility.
