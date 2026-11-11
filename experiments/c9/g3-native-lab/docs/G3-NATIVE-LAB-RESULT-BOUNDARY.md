# G3: native Windows lab evidence boundary

## Testable facts

- `RegGetKeySecurity` and Registry64 read operations against a new, protected, temporary HKLM key on a GitHub-hosted Windows runner.
- Widened leaf DACL and unknown values fail closed, with restoration before cleanup.
- Rolling back both local revision and manifest digest is rejected **when a newer checkpoint is supplied separately to the reader**.
- A clearly marked disposable registry branch is removed after testing. No service, signer, private key storage or production data is touched.

## Not established

- Independence, integrity, monotonicity, authenticity or freshness of a **production** checkpoint. In this lab the witness is generated in the same process. Both old manifest and old witness together can be replayed if no genuinely independent authority advances the witness.
- Host-privileged adversary resistance, key replacement under concurrent races, parent-key ACL integrity, crash durability, atomic multi-value updates, interrupted update recovery or hardware-backed key custody.
- A real independent security review, production signer, HSM, installer, rollback or release approval.

## Remaining decision

Define a genuinely separately controlled, durable witness and its atomic advancement protocol. Before production consider an isolated deployment and recovery test with actual authority separation and independent logs. Do not add repeated synthetic test cycles.

G3 = HOLD; PRODUCTION = NO_GO.
