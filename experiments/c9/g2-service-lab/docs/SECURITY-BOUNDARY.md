# G2 two-service positive verification boundary

Purpose: replace the previous negative-only G2 identity proof with real, independently registered Windows service SIDs on a disposable cloud runner. The canonical acceptance requirement is two distinct enabled group SIDs, with LocalService user on both and no cross-role SID contamination. We verify the broker primary token and the client's impersonated token *after* a native ReadFile on the same thread. RevertToSelf must succeed. No caller-provided flags are trusted.

The disposable native test host has no commit operation, G345 evaluation, broker routing, or protected target. `CanExecuteCommit` is false for both receipts. External attackers with LocalService/SYSTEM rights, kernel manipulation and administrative substitution are outside the scope of this single proof. The signed root trust / nonce persistence / handle-bound mutation gates must not be inferred from these token observations.

Control measures: exact GitHub-hosted `windows-2022` runner, source-only opt-in workflow, preexistence check for both frozen service names, LocalService service account, `type= own`, SIDTYPE unrestricted, exact SID checks using `sc showsid` and OS process tokens, GUID-scoped ProgramData root, minimal test-only pipe, bounded connection, no changes to real C9 broker, and cleanup verification even on failure. Two distinct services must not share a process. No production target is mounted.

A passing test establishes **G2-positive kernel-token mechanics on this disposable host only**. G2 release gate remains HOLD and production remains NO-GO.
