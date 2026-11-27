# AgentHub Memory: dienstgeschützter Review-Speicher, Laborversion

**Status: Build/Test only. Keine produktive Freigabe.** Zugehörig zu #338 und #326.

## Technische Trennung

Der neue eigenständige .NET-10-Windows-x64-Baustein
`MemoryReviewAuthority.Store` erzeugt die Datei
`review-authority.sqlite3` ausschließlich unter einem bereits vom
Windows-Dienst eingerichteten und geprüften Zustandsverzeichnis.
Er öffnet **nicht** die vorhandene benutzerbeschreibbare
`%LOCALAPPDATA%\agent-hub\memory.sqlite3`.

Die Datenbank verwendet SQLite-WAL und `synchronous=FULL`.
Die Tabelle `review_requests` speichert projekt-/branch-/Git-revisionsgebundene
Anfragen mit E~-Vorschlagsref, Snapshot-, Fakt- und Evidence-SHA256 und
dem Status `awaiting_independent_host_authorization`.
Die zusätzliche Tabelle `verified_review_intents` speichert ausschließlich
die nach einer gültigen Einmal-Challenge beobachtete Bestätigungs- oder
Ablehnungsabsicht, **nicht** die freigegebene Memory-Claim-Entscheidung.

Der zusätzliche, ausdrücklich opt-in bleibende Host-Pfad
`CompleteProtected` kann eine `protected_review_claims`-Zeile erzeugen,
aber **nur** mit erfolgreicher einmaliger UV-Prüfung und einer unabhängig
ermittelten vertrauenswürdigen Quelle. Er ist noch nicht mit dem laufenden
Dienst oder Codex verbunden. Keine produktive Passkey-Registrierung.
Gleiche Pending-Anfragen sind bis zur verifizierten Entscheidung idempotent.
Eine abweichende Aktion, Evidence oder Snapshot führt zu einem Konflikt.
Der bisherige Pending-/Intent-Pfad enthält weiterhin keine ursprünglichen
Fakttexte oder Nutzer-Evidence. Die neuen, geschützten Claim-Zeilen enthalten
den bestätigten Faktext und seine Herkunfts-Hashes, aber keine Passkey-Secrets
oder übertragbaren Autorisierungstokens.

## Native Tests

`MemoryReviewAuthority.Store.SelfTest` prüft unter Windows x64:
neue Pending-Anfrage, exakte Wiederholung, Konflikte, unterschiedliche
Vorschläge, Neustart/Persistenz, Eingabevalidierung, WAL-Modus und
fehlende Claims-Tabelle.

Die bestehende Windows-CI des SCM-Laborhosts startet einen
**temporären eingeschränkten LocalService-Dienst** mit exakter
dienstspezifischer SID. Der Dienst legt eine einzige synthetische
Review-Anfrage im dienstgeschützten ProgramData-Verzeichnis an und
vergleicht die wiederholte Eingabe. CI prüft echte SQLite-Datei,
Benachrichtigungsmarker, DACL aller erzeugten Dateien und vollständige
Entfernung des Dienstes und sämtlicher Testverzeichnisse.

Keine produktive Dienstinstallation oder Datenbankmigration.

## Sicherheitsgrenzen

Der SQLite-Typ authentifiziert seine Aufrufer **nicht selbst**.
Der derzeitige Laborhost hat keine Pipe, keinen HTTP-Endpunkt,
keine FIDO2-Registrierung und keinen angebundenen Claims-Schreibendpunkt.
Das Labor speist fest verdrahtete synthetische Daten ein.
Der Windows-GitHub-Runner ist privilegiert; ACL-Inspektion und
erfolgreiche Dienstschreibvorgänge ersetzen **keinen** realen
Negativtest mit einem eingeschränkten gewöhnlichen Benutzer-Token.

Eine produktive Autoritätsdatenbank erfordert zusätzlich:

1. Nur der geprüfte Dienst darf das Verzeichnis auswählen und die
   effective DACL inklusive Reparse-Point-/Hardlink-Risiken prüfen.
2. Benutzerregistrierung, Passkey-Allowlist, Challenge-Verbrauch,
   Signatur und finale Entscheidung müssen **innerhalb** der
   geschützten Vertrauensgrenze liegen.
3. Ein read-only Graph/Memory-Client darf eine lokale SQLite-Änderung
   nicht mit einem dienstautoriserten Claim verwechseln. Eine
   authentifizierte Projektion mit gesichertem Vertrauensanker ist nötig.
4. Host-seitige Git-Scope-/Evidence-/Relations-/Snapshot-Prüfungen,
   atomare Claim-CAS, native Windows-Hello-Interaktion,
   nichtprivilegierte Same-Account-Gegentests sowie Rollback.
5. Keine Aktivierung von #192 oder Änderungen an den vorhandenen
   Memory-Hooks, C9, G5 oder den Daten des Benutzers ohne gesonderte
   Freigabe.

Das hier ist ein konkreter zusätzlicher Speicher- und ACL-Baustein,
**noch nicht die fertige Memory-Write-Funktion**.


## M2-Teilintegration: UV-Challenge direkt mit geschützter Entscheidung verbinden

`VerifiedReviewCoordinator` verbindet den bestehenden
`ReviewChallengeCore` mit dem vorhandenen dienstgeschützten SQLite-Speicher.
Er akzeptiert den exakten Pending-Snapshot, startet nur für eine dazu passende
`ReviewMeaning` eine kurzlebige Challenge, verbraucht das Ticket bei jeder
Prüfung und schreibt **nur nach erfolgreicher kryptografischer UV-Prüfung**
eine unveränderliche Zeile in `verified_review_intents`. Bestätigung und
Ablehnung bleiben unterscheidbar. Die Prüfung auf bereits erfolgte Entscheidung
und das Einfügen sind in **einer SQLite-Transaktion**. Nach Neustart bleibt die
Entscheidung bestehen und kann nicht wiederverwendet werden. Offene Anfragen
werden von der Summe bereits verifizierter Intents getrennt.

Die Projektion `ReadVerifiedIntent` ist für einen späteren vertrauenswürdigen
Dienst-Read-Endpunkt vorgesehen. Sie enthält weder Passkey-Geheimnisse noch
Claim-Daten und macht **keine** vom Benutzer beschreibbare Cache-Datenbank zur
Autorität.

**Wichtige Grenze:** Die Windows-Selftests signieren mit temporär erzeugten
Testschlüsseln. Der heutige Dienst hat weiterhin keinen Endpunkt, keine
echte Passkey-Registrierung, keine Benutzeroberfläche und keine Anbindung an
reale Codex-Kandidaten. Die Methode `RecordPending` authentifiziert
vorgelegte Vorschlagsdaten nicht selbst. Eine signierte Challenge beweist
ohne eine unabhängige Anzeige und Herkunftsprüfung noch keine bewusste
Freigabe des konkreten Fakts.

`uv_confirm_intent_no_claim` bedeutet weiterhin ausdrücklich **weder
`ClaimWritten` noch produktive Approval Authority**. Der neue separate
`CompleteProtected`-Pfad implementiert zwar die atomare Transaktion in
`protected_review_claims`, ist aber ohne vertrauenswürdigen Proposal-Reader,
echte Enrollment-/Review-UI und dienstseitige Codex-Read-Projektion noch
nicht produktiv nutzbar. Die klassische Canonical-Memory-`claims`-Tabelle
wird von ihm nicht geändert. Bis dahin bleibt der Pfad standardmäßig OFF und
Produktivfreigabe NO-GO. Siehe `memory-mvp-protected-claim-lab.md`.


## Review audit immutability follow-up (#338 / #326)

The existing protected laboratory review store now enforces append-only
pending review requests, verified review intents and synthetic protected review
Claims with SQLite UPDATE/DELETE guards. The protected source snapshot already
had UPDATE/DELETE guards. All four tables now reject replacement of an
existing primary or unique identity at INSERT time, even if recursive delete
triggers are disabled. This closes an internal consistency gap in the
existing reviewed-decision transaction; it adds no new approval mechanism,
transport, production source origin or credential trust.

The native selftest reproduces the original mutation bug before the repair,
records one synthetic confirmation and one rejection, attempts twelve SQL
mutations/replacements, reopens the store and checks exact unchanged receipts,
Claim and completed-request replay denial. It also simulates a pre-upgrade
ledger with existing rows but without the new triggers, and checks that
opening the upgraded library restores the guards without rewriting those rows.

These are DML integrity protections inside a service-owned database, not a
defense against privileged arbitrary SQL/DDL, database replacement or a
compromised service. The Windows ACL/service identity and real physical
operator acceptance remain separate. The operator's canonical SQLite and
installed service configuration have not been modified. No production
protected review or Claim publication is authorized by this increment.


## Native active-Claim comparison (read-only prerequisite)

The Store now has a local-only `InspectOperatorPinnedEvidence` method backed
by the same pinned-evidence resolver as the importer. It opens only the
existing fixed operator snapshot and manifest, uses one read transaction,
resolves exact project/branch active Claims in binary ID order, and rejects
incomplete, malformed or oversized comparisons (200 rows, 256 characters per
ID, 65,536 UTF-16 code units per value, 1 MiB combined UTF-8 content).
The default result contains opaque refs, value digests, duplicate indicators
and a comparison digest; local text requires an explicit opt-in. The result
does not stage any decision or Claim, and no IPC endpoint exposes it.

The native digest commits to the complete scoped ordered Claim identities
and value hashes. For nonempty scopes it is incorporated in the native
review snapshot digest. Empty-scope digest construction is preserved.
Deterministic native selftests exercise changed values, removed rows, changed
review action, exact duplicate normalization, foreign/inactive row exclusion,
and the 200-row boundary. The existing protected approval and commit challenge
functions produce different challenges for different comparison snapshots.

This is not an authenticated conflict decision. The native Operator UI has
not yet displayed this comparison, no human assertion over it has been
obtained, and a read-only snapshot is not a proof that the canonical source
remains current at publication. The protected importer and Node export still
reject every nonempty active-Claim scope, even if no exact duplicate exists.
No new IPC capability, protected pending admission, or production write is
enabled. The next vertical slice needs a signed local review offer displaying
the complete comparison, explicit operator judgment and a trusted freshness
check at atomic finalization.


## Signed native comparison preview (comparison-only lab mode)

When the fixed operator-pinned manifest resolves a nonempty comparison,
the existing lab service starts in a mutually exclusive comparison-only
mode after its existing SCM identity and CI fence checks. It skips the
synthetic seed, pending import, credential initialization, read pipes and
all enrollment, proof, reaffirmation, publication and disclosure operations.
Only the existing administrator-ACL operator pipe can return a signed
`comparison_inspect` response for the exact pinned project, branch and E~
reference. Every request re-resolves the fixed snapshot and refuses a
changed review digest or scope. It never accepts caller-provided Claim
values or a decision. The ordinary empty-scope path is unchanged.

The native UI's read-only comparison action verifies the existing service
signature, request nonce, exact scope, full row count and row value hashes.
The display quotes values as escaped JSON strings to avoid interpreting
untrusted text as UI instructions. The comparison action invalidates all
previous UI challenge offers; it does not set any approval state or expose
a Hello gesture. The existing 12,000-byte signed payload cap is retained;
a comparison above 11,500 serialized bytes produces a signed size refusal,
not a truncated list. A larger transport requires separate design/testing.

Offline UI contract tests exercise the successful signed offer, wrong
signer, wrong nonce, incomplete count, changed value, false approval claim,
wrong scope and escaped multiline content. Service policy tests allow only
the exact comparison request and deny all existing mutation/disclosure
operation names in the comparison mode. Live SCM, actual WinForms rendering
and physical Hello remain unverified for this increment. The Node export
and protected pending import continue to reject nonempty scopes; no actual
operator-PC snapshot export, service installation or production activation
has been performed.


### SCM comparison boundary regression

Comparison-only startup previously depended on a signing identity created
by the disabled read pipe. The service signer creation/reopen logic is
now shared without starting that pipe. Existing matching pins are retained;
incomplete, invalid or changed identities fail closed. The local native
policy selftest reports 25/25, including first creation, exact reopen and
missing public-key refusal. The Operator UI builds with zero warnings and
errors and its existing signed-envelope contract selftest passes.

A third, isolated CI-only SCM lane uses the existing restricted-service
test harness with -ComparisonOnlyMode. It prepares a fresh synthetic copy
with two active same-scope rows, one exact duplicate, plus three excluded
rows. It does not loosen the ordinary export gate. The lane is designed
to check the real same-account restricted-token denial, admin-pinned signer,
compiled native UI client, signed scope and complete comparison, denial of
other operation requests and all four read pipes, changed pinned snapshot
refusal and an empty protected ledger, followed by the existing SCM cleanup.

The new lane has been parsed and its local execution guard checked. Its
actual SCM result is NOT YET VERIFIED: it requires an ephemeral GitHub
Windows runner. No local service was created, no CI environment guard was
overridden, and no physical operator approval was attempted.


## Conflict-review intent prerequisite (post #456)

A separate conflict-review challenge domain binds the exact native review
snapshot and pinned confirm/reject action. Its verifier yields only
`verified_conflict_review_intent_only`; ordinary proof, approval and
publication challenges cannot be substituted. The host-only coordinator
requires an existing native-enrolled credential, resolves the comparison
itself, checks the displayed snapshot and comparison digests, and consumes
one outstanding ticket on the first completion attempt. A confirmation is
not supported if an exact duplicate exists; rejection remains eligible.
No semantic independence is inferred from a nonduplicate.

The protected SQLite transaction re-resolves the pinned comparison,
checks native credential identity and persistent sign count, inserts one
immutable intent per proposal and updates the credential counter together.
A stale pinned comparison, replay, competing receipt, wrong purpose or
failed insertion cannot advance the persisted counter. The receipt records
the specific pinned snapshot, comparison, decision and source digests.
It is not a portable authorization, a canonical proposal disposition, a
Claim or historical evidence authentication.

This is deliberately not wired to any named-pipe command, enrollment path
or UI action. Tests use synthetic ES256 credentials in disposable stores,
not physical Windows Hello. The existing comparison-only service and
nonempty-scope export/import denial remain unchanged. Rechecking a separate
pinned file during a ledger transaction is NOT an atomic freshness check
against the live canonical database. Before any real decision/publication
endpoint, establish the native reviewed gesture and a trusted canonical
freshness/commit boundary; do not treat this receipt as a production grant.
The one-receipt-per-proposal rule intentionally has no supersession path
yet; changed proposals remain blocked rather than overwriting history.

### Native intent-only comparison integration

The existing administrator-only comparison pipe can now offer conflict_begin
and conflict_complete ONLY when the protected ledger already contains a
native-enrolled operator credential. No credential is enrolled, imported or
upgraded in this mode. The signed comparison exposes availability explicitly;
confirm with an exact duplicate remains disabled. Begin requires an already
issued complete bounded preview and matching startup snapshot, scope and
comparison digest. Complete consumes the ticket and returns a signed,
exact-scope intent-only receipt. Other existing operations remain denied.

The native UI validates the returned challenge against the displayed review,
requires explicit operator judgment, then calls the existing native Hello
assertion API. It validates the signed receipt and never reports a canonical
change or Claim permission. A fresh comparison installation without an
existing native credential remains read-only. The supported provisioning
and transfer path for a nonempty scope is still missing; do not hand-copy
credentials or weaken the installer/export gates to reach this action.

Local service/UI builds and offline signed-envelope contract tests pass.
The CI comparison fixture now also asserts absence of the conflict actions
without a native credential. The new positive credential-bearing SCM/UI
path, actual rendered dialog and physical Hello have NOT been exercised.
No canonical freshness or publication guarantee is added by this increment.

### Durable intent status and provisioning blocker

The signed comparison response now includes conflict_intent_status:
not_recorded, recorded_exact_snapshot, or recorded_different_snapshot.
The exact status compares scope, revision, fact, evidence, action and both
snapshot digests against the immutable ledger receipt. The native UI refuses
an inconsistent available/recorded response. After an uncertain completion,
reload the signed comparison rather than resubmit an assertion. Existing
receipts and outstanding tickets disable new offers. Local Store tests
check reopening and changed snapshots, not actual SCM restart behavior.

The current preview installer refuses an existing service or state path and
requires either explicit NativeEnrollOnly or an unverified public manifest.
The ordinary export rejects nonempty scopes. Neither is a supported native
credential reuse/provisioning path for nonempty scopes. Do not copy existing
credential rows, relax installer isolation or interpret an unverified pin as
native enrollment. A new provisioning design and actual positive SCM test
remain necessary. No changes to export or installation permissions here.

### Explicit comparison-preview provisioning (local implementation)

The explicit export purpose comparison_preview_v1 selects a nonempty,
non-authorizing comparison transfer. The six-field manifest is validated
separately and its purpose is included in the native snapshot digest. Even
if the active scope becomes empty, the explicit manifest cannot enter the
ordinary pending-import route. Existing five-field manifests retain their
prior semantics. This export makes a full consistent local SQLite copy;
it may contain unrelated private scopes and must never be uploaded.

The preview installer requires its existing explicit NativeEnrollOnly
choice for this purpose. The service permits the existing two-step native
registration and possession protocol for this exact pinned comparison,
without creating a pending request or importing a key. Enrollment is
bound to the current purpose-tagged snapshot; after enrollment, only
comparison and conflict-intent operations are available. No publish or
read-disclosure coordinator is activated. An empty comparison or changed
snapshot cannot supply a new enrollment offer. An existing credential
cannot be overwritten. Legacy comparison fixtures remain enrollment-free.

Local regression: 19/19 JavaScript export/preflight tests, 61/61 Store
selftests, 25/25 service policy tests. The isolated Store test uses the
existing synthetic ES256 fixture and proves zero Pending/Claim rows,
changed-snapshot refusal, and refusal of repeated enrollment. This is
not physical Hello, trusted hardware attestation, SCM end-to-end, or
canonical finalization. Installer syntax and native service build pass.
No installation or live database export has been performed. The previously
blocked positive SCM test remains unverified.
