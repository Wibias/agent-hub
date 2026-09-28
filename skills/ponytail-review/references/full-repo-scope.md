# Full-repo ponytail scope

Use when scope is `full repo` (not a git diff).

## Path filter

- Default: repository root, excluding generated and third-party paths.
- If the user gives a path (`full repo src/auth`, `path: src/`, `--path src/`), restrict to that subtree.
- Always exclude: `node_modules/`, `.git/`, `dist/`, `build/`, `coverage/`, `.next/`, `vendor/`, `__pycache__/`, lockfiles (review deps in manifest only, not lock line-by-line), minified assets, snapshots unless user asked.

## Scan order (highest signal first)

1. Dependency manifests (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, etc.) — unused or replaceable deps
2. `utils/`, `helpers/`, `lib/`, `common/` — hand-rolled stdlib/native equivalents
3. Abstraction layers — interfaces with one impl, factory/builder with one caller
4. Config/feature flags never read
5. Dead files or exports with no importers (best-effort; mark `needs verification` if uncertain)

## Output limits

- Report top findings by deletion potential; do not enumerate every file.
- After 25 findings, stop and add: `… and N more candidates; narrow with path: <dir> for detail.`
- End with `net: -N lines possible (estimated)` — estimate is OK for full repo.

## When to warn

If the scoped tree is very large (>200 source files), tell the user once and suggest a narrower path before continuing unless they insist on full tree.
