# CodeRabbit review #205: final three consistency corrections

The manual CodeRabbit review of combined Draft #205 originally returned **13 actionable threads**. The ten proof/runtime issues addressed in Drafts #212 and #213 were separately 14/14 CI-green and are already overlaid into #205. This Draft follows up on the three remaining cases.

1. **Taste severity/priority integrity:** Fuse rejects `upstreamSeverity=FAIL` unless normalized `priority=P1`, and rejects `upstreamSeverity=WARN` unless `priority=P2`. Neither the original severity nor priority is silently rewritten. Tests cover inconsistent FAIL/P2, WARN/P1 and FAIL/P0, and a preserved valid FAIL/P1.
2. **Canonical temporary path:** the performance diagnostic fixture compares the runner `cwd` to `realpathSync(project)`, handling temporary directory aliases such as macOS `/var` to `/private/var`.
3. **Deterministic HTML parser absence:** the test no longer depends on whether optional parser dependencies happen to be installed in the CI environment. A test-local Node ESM loader throws for `htmlparser2`, `css-select`, `css-tree` and `domutils` in the real Impeccable CLI child process. The real provider must return `ERROR` due to explicit degraded HTML fallback evidence. Neither the production CLI nor the process runner's environment allowlist was modified to enable this injection.

These tests are not product validation. A complete provider report is still a bounded static audit and not proof of correct rendered gameplay. The HTML parser absence test intentionally validates the fail-closed behavior only; separately, the real Chrome joint smoke checks installed Taste 2.5.0.

**Policy:** Agent Hub only, Draft/unmerged, no changes to `Wibias/streamer-content`, require CI and independent re-review before resolving review threads and discussing release.
