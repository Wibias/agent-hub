# Windows 11 x64: echte Windows-Hello-Abnahme des Memory-Preview (M2)

**Ziel:** Auf dem eigenen PC einen realen, von Windows Hello/FIDO2 bestätigten
`E~`-Vorschlag nachweisen. **Nicht:** einen Claim genehmigen oder produktive
Memory Writes einschalten. Stand nach #352: In der CI wurden Installation,
geschützter Service und signierter Originalfakt geprüft, **kein** physischer
Windows-Hello-Dialog. Keine VM und kein zweiter Windows-Benutzer erforderlich.

## 0. Grenzen und Stop-Regeln

- Nur in einer interaktiven Windows-11-x64-Sitzung; Node 24+, .NET SDK 10,
  Git und PowerShell 7 erforderlich. Originale Codex-Hooks und Datenbank
  **nicht ändern**.
- **Niemals** den Installer oder die native EXE aus dem Git-Checkout,
  `Downloads` oder einem anderen benutzer-/agentbeschreibbaren Pfad
  als Administrator starten. Keine Befehle aus einem Chat mit erhöhten
  Rechten blind ausführen.
- Der Git-SHA und der Hash der privilegierten Installationsdatei müssen
  separat von der echten Person über eine vertrauenswürdige Quelle geprüft
  werden. Der vom selben ungeschützten Checkout ausgegebene SHA-256 ist
  **keine** unabhängige Freigabe. Ein lokal erzeugtes .NET-Paket ist noch
  kein signiertes/verifiziertes Release.
- Die Browser-Passkey-Datei enthält nur einen öffentlichen Schlüssel,
  ist aber **keine** authentifizierte Einschreibung. Auch ein späterer
  Erfolg der native UV-Probe ist **keine** Claim-Freigabe.
- Der `E~`-Export enthält eine **vollständige** persönliche Memory-DB.
  Nie in ein Repo, GitHub Issue, Chat oder CI hochladen. Export und
  erhaltenes ProgramData-Archiv nach lokalem Datenschutzplan behandeln.
- Wenn Git, Hash, geschützter Eigentümer/DACL, echter Fakt oder Ursprung
  nicht passen: **abbrechen**, keine manuelle Umgehung.

## 1. Physischer Browser-Hello-Test ohne Administratorrechte

PowerShell 7 **normal**, nicht erhöht. Platzhalter absichtlich manuell setzen:

```powershell
$agentHubRepo = 'C:\PFAD\agent-hub'
$projectRepo  = 'C:\PFAD\streamer-content'
$projectId    = 'github.com/Wibias/streamer-content'
$branch       = 'main'
$proposalRef  = 'E~0123456789'  # durch echte offene E~-Referenz aus der Memory Console ersetzen
$port         = 4317

Set-Location -LiteralPath $agentHubRepo
git rev-parse HEAD
git status --porcelain --untracked-files=all
node --version
dotnet --version
```

Vorher den **tatsächlich ausgewählten** `$projectRepo`-Branch und seine
Revision prüfen: `git -C $projectRepo branch --show-current` und
`git -C $projectRepo rev-parse HEAD`. Eine leere/fehlende
`E~`-Referenz nicht synthetisch ersetzen. Die Memory Console muss sie
als reviewbar aus der bestehenden DB auflösen können.

In derselben normalen PowerShell die vorhandene Browser-Prüfung starten
und das Fenster geöffnet lassen:

```powershell
node .\scripts\memory-ui.mjs --webauthn-probe `
  --repo-root "$projectRepo" `
  --db-path "$env:LOCALAPPDATA\agent-hub\memory.sqlite3" `
  --port $port
```

In einem **selbst geöffneten** Browserfenster die exakte URL verwenden
(nicht `127.0.0.1`, da WebAuthn den Ursprung `localhost` bindet):

```powershell
$u = 'http://localhost:' + $port + '/webauthn-probe.html?projectId=' +
  [uri]::EscapeDataString($projectId) + '&branch=' +
  [uri]::EscapeDataString($branch) + '&proposalRef=' +
  [uri]::EscapeDataString($proposalRef)
$u
```

1. Die oben ausgegebene URL manuell öffnen. Erst den **exakten**
   Faktenwortlaut und die Aktion prüfen.
2. Eigene Checkbox und zweiten Klick bestätigen. Browser verlangt
   eine echte `navigator.credentials.create`- und
   `navigator.credentials.get`-Zeremonie mit Windows Hello/FIDO2.
3. Nur wenn `browser_webauthn_uv_observed_not_approved` erreicht wird,
   den **öffentlichen** `operator-webauthn-credential.json`-Kandidaten
   herunterladen. Festhalten: Browser, Windows-Version, echte Hello-
   Interaktion Ja/Nein und vollständiger **Status ohne private Inhalte**.
   Ein bloßer Dialog oder eine synthetische Signatur zählt nicht als PASS.

Das ist der erste auf deinem Gerät physisch nachweisbare Test. Der
geschützte Windows-Dienst wurde dabei **nicht** gestartet.

## 2. Realen E~-Snapshot und Windows-Paket vorbereiten (normaler Benutzer)

Nur nach Schritt 1, bei gültigem vorhandenen `E~` und sauberem AgentHub
Git-Checkout. Exportordner und Paketverzeichnis müssen neu sein.

```powershell
$export = Join-Path $env:LOCALAPPDATA ('AgentHubEvidence-' + [guid]::NewGuid().ToString('N'))
$package = Join-Path $env:LOCALAPPDATA ('AgentHubPreview-' + [guid]::NewGuid().ToString('N'))
$credential = Join-Path $env:USERPROFILE 'Downloads\operator-webauthn-credential.json'
if (-not (Test-Path -LiteralPath $credential -PathType Leaf)) {
  throw 'Public browser credential export missing'
}
node .\scripts\export-protected-evidence-review.mjs `
  --db-path "$env:LOCALAPPDATA\agent-hub\memory.sqlite3" `
  --repo-path "$projectRepo" `
  --proposal-ref "$proposalRef" `
  --decision confirm `
  --output-dir "$export"
if ($LASTEXITCODE -ne 0) { throw 'E~ export failed, stop' }

& .\scripts\prepare-memory-review-local-preview.ps1 `
  -Action Prepare -PackageDirectory "$package" -RepositoryDirectory "$agentHubRepo"
& .\scripts\prepare-memory-review-local-preview.ps1 `
  -Action Verify -PackageDirectory "$package" -RepositoryDirectory "$agentHubRepo"
```

`--decision confirm` ist hier **nur ein unbestätigter Testwunsch**;
er legt keine Erinnerung an. Für eine tatsächliche Ablehnung in
Schritt 1/2 in beiden Schritten `reject` benutzen. Den originalen
Fakt, `E~`-Ref, Branch, Git-SHA, öffentlichen Credential-Ursprung
und SHA-256 der vorbereiteten Dateien **persönlich abgleichen**.

## 3. Geschützte native Installation: menschliche Vertrauensgrenze

**Nicht automatisch mit obigen Befehlen fortsetzen.** Für die native
Windows-Hello-API-Prüfung ist die bereits implementierte,
**explizit opt-in**-Installation nötig. Sie verlangt:

- eine unabhängig überprüfte, von der Person bewusst festgelegte
  Paket-Manifest-Prüfsumme und einen unabhängig geprüften Installer;
- eine separat Administrator-owned und ohne fremde Schreibrechte
  geschützte Kopie von `install-memory-review-local-preview.ps1` unter
  `%PROGRAMDATA%\AgentHubMemoryReviewLab-Bootstrap\`;
- `-Action Install`, `-ExpectedManifestSha256`, `-PackageDirectory`,
  `-EvidenceExportDirectory`, `-OperatorCredentialManifestPath` und
  den expliziten Consent
  `I_APPROVE_TEMPORARY_NO_WRITE_AGENTHUB_PREVIEW`.

Die ausführbare und in der Windows-CI getestete DACL-Staging-Sequenz
steht in `tests/memory-engine/test-local-review-preview.ps1`, Zeilen
65-98. **Dieses CI-Testskript ist absichtlich GitHub-runner-only und darf
nicht auf dem PC entsperrt werden.** Privilegierte Befehle erst nach
einem unabhängig kontrollierten Installer-/Paketabgleich selbst ausführen.
Der Installer darf den Dienst nur als `demand`-start restricted
LocalService mit exakt benannter Service-SID und ohne Claim-Write
registrieren.

Anschließend die installierte EXE
`%PROGRAMDATA%\AgentHubMemoryReviewLab-PreviewApp\Operator\MemoryReviewAuthority.OperatorUi.exe`
bewusst erhöht starten. Dort exakt `projectId`, `branch` und
`E~` auswählen, den **dienstsignierten** Fakt sowie Revision,
Aktion und Hashes lesen, Checkbox und nativen Windows-Hello-Klick
selbst betätigen. Der **einzige** positive Endstatus lautet
`operator_webauthn_uv_verified_not_approved`.
Ein angezeigter Fakt ohne realen Hello-Dialog ist kein PASS.

**Nach dem Test**: Das bereits geschützte Installer-Skript mit
`-Action Remove -Consent REMOVE_AGENTHUB_MEMORY_REVIEW_ONLY_PREVIEW`
aus der erhöhten Sitzung ausführen. Auf den exakten Service-Namen
achten. Der Dienst, das EXE-Verzeichnis und der öffentliche
Signatur-Pin müssen verschwinden. Die importierte private SQLite/
Evidence bleibt in einem Administrator-geschützten
`AgentHubMemoryReviewLab-Preserved-<GUID>`-Archiv; **nicht** blind
löschen. Das ursprüngliche `%LOCALAPPDATA%\agent-hub\memory.sqlite3`
bleibt unangetastet.

## 4. PASS/FAIL-Beleg und nächster Entwicklungsschritt

Mindestens folgende **nicht sensiblen** Fakten festhalten:

| Prüffrage | PASS |
| --- | --- |
| Browser erstellt und verwendet echten Windows-Hello-/FIDO2-Passkey | Echt am PC beobachtet |
| Geschützte native EXE startet nur aus Administrator-owned Pfad | Native Pfadprüfung PASS |
| Originaler E~-Fakt kommt aus signiertem LocalService, nicht aus UI-Freitext | Dienstsignatur verifiziert |
| Native Win32-WebAuthn-API zeigt echte lokale Benutzerprüfung | Realer Dialog und physische Aktion beobachtet |
| Dienst akzeptiert Originalassertion | `operator_webauthn_uv_verified_not_approved` |
| Kein produktiver Claim oder Memory Write | Weiterhin deaktiviert |
| Rückbau entfernt nur eigenen Dienst und schützt private Sicherung | Exakte Entfernung bestätigt |

**Solange der reale native PASS fehlt, keine Claim-Finalisierung freigeben.**
Auch ein erfolgreiches NO-APPROVAL-Pilotgerät ist **keine** sichere
Credential-Einschreibung für produktive Authority: die Herkunft des
öffentlichen Browser-Key-Manifests ist weiterhin
`operator_pinned_unverified`. Erst danach ist ein eng begrenzter
Implementierungsschritt sinnvoll: echte kontrollierte Einschreibung,
einmaliger serviceeigener Human-Consent-Commit, signierter realer
Read-Projection-Claim und Original-Codex-CLI/Desktop-Abnahme.

**Produktive Memory Writes bleiben NO-GO.**


## Attested no-write preview package

Use the manual `Memory preview attested package` workflow on reviewed
`main`, not a local agent-produced binary, for the next physical
acceptance. The workflow only builds and verifies the existing preview
package, includes the corresponding installer alongside (not inside)
the package directory, and attests the ZIP on a separate hosted runner.
It does not install a service or access an operator database.

From an ordinary, operator-controlled PowerShell session, independently
select the successful run and its full reviewed source commit using
GitHub. Download the `agenthub-memory-preview` artifact to a NEW empty
directory. Before extracting the inner ZIP, verify it using:

```powershell
gh attestation verify .\agenthub-memory-preview.zip `
  --repo Wibias/agent-hub `
  --signer-workflow Wibias/agent-hub/.github/workflows/build-memory-preview-attested.yml `
  --source-ref refs/heads/main --source-digest $reviewedCommit `
  --deny-self-hosted-runners
if ($LASTEXITCODE -ne 0) { throw 'Attestation verification failed' }
```

Here `$reviewedCommit` must be set independently to the full reviewed
commit SHA. Do not obtain it from an unverified package manifest.
Extract only after successful verification, into a fresh directory.
Inspect the manifest and verify the package with the matching reviewed
checkout. The independently verified ZIP includes the exact bootstrap
script; review it, and have the administrator update the protected
bootstrap while preserving its owner and ACL. Do not execute anything
elevated from the download directory. The existing explicit installation
and removal consent, evidence selection, and physical user interaction
remain necessary.

Attestation proves build provenance, not code safety, Authenticode
signing, source evidence authenticity, canonical freshness or user consent.
The workflow is manual and main-only. No private Evidence, keys, or
production data are included. A successful build alone is not a native
SCM/Hello acceptance result.

## 2026-11-28: attested native comparison-preview field acceptance

**Result: PASS for the bounded native no-write intent flow, based on operator
reported interaction and supplied UI screenshots. NOT a production write
or trusted canonical evidence acceptance.** The earlier public browser-key
pin route above is a separate historical test route; its acceptance cannot
be inferred from this native-enrollment run.

- Reviewed main build: `23141859f504f2c000b049d4ffc91d24c4213ff3` (#461).
- GitHub Actions run [46090629320](https://github.com/Wibias/agent-hub/actions/runs/46090629320):
  build and attestation succeeded; ZIP attestation verified against this
  exact main commit, repository and hosted signer workflow.
- Verified manifest SHA-256:
  `17f20d0d5cb43483c94c1683d2665447d0bbcb13f0bd0b3c502fddc7d1314c02`.
  Seven package files verified; claimsEnabled=false. The installer digest
  was unchanged from the preceding independently attested package.
- Explicit `comparison_preview_v1` nonempty-scope export and
  `-NativeEnrollOnly` installation. One real E~ proposal, five existing
  comparison Claims. No private fact, proposal reference, scope, credential,
  assertion, full snapshot, or screenshots are included in this report.

| Step | Field evidence | Result |
| --- | --- | --- |
| Read signed comparison before enrollment | Installed UI screenshot; conflict action unavailable | PASS (observed UI) |
| Native enrollment plus second UV possession check | Operator reported the UI message confirming protected credential enrollment and explicitly no Claim or approval | PASS (operator reported) |
| Reload comparison and personally confirm conflict intent with Hello | Operator reported: "Konflikt-Intent gespeichert. Kein Claim, kanonische Aktualitaet NICHT verifiziert." | PASS (operator reported) |
| Repeat exact comparison | Operator reported: "Intent fuer exakt diesen Snapshot bereits gespeichert. Kein Claim." | PASS (operator reported) |
| Close UI, restart SCM service, reopen same comparison | Operator reported the same exact-snapshot status after instructed restart | PASS (operator reported; no independent SCM restart trace collected) |
| Remove temporary service with protected archival | Still running at follow-up inspection; operator-controlled removal requested | OPEN |

The positive interaction validates the purpose-tagged native enrollment,
comparison, signed intent and immutable duplicate behavior in the field.
It does not independently inspect the protected database, verify a raw
assertion transcript, authenticate historical Evidence, verify live canonical
freshness, prove hostile-client coverage, prove safe production read
projection, or grant a production Claim. Do not promote this receipt or
the conversation to authorization. Private exported and archived data
remain local. Use the protected installer removal path above; do not
force-delete state or alter its DACL.

The decision was initially difficult for the operator to find because the
action label was buried among technical scope and hash metadata. Track
MRUI-07 separately; the successful interaction does not waive this UX defect.

### Remaining delivery sequence (#326 / #338)

1. Establish the trust boundary for authoritative current source and
   exact canonical scope/revision/lifecycle/related-target state. The
   historical pinned export and the user-writable SQLite database alone
   cannot provide authenticated provenance or freshness. Do not elevate
   an ordinary hook JSON, a local trust flag, an attestation of build
   provenance, or a previous native intent to that authority.
2. Specify and prove a single service-owned transaction for validation,
   one-use authenticated decision, audit and final Claim/denial, including
   stale/duplicate/conflict/tamper and crash/restart rejection. Keep the
   current no-write comparison receipt distinct; do not add an intent
   conversion or production write endpoint before the source boundary
   and atomic semantics are proven.
3. Bind the read-only projection to exact verified service/source authority
   and demonstrate the real Codex CLI and Desktop consumers, including
   fail-closed protected behavior and the existing ordinary-memory fallback.
4. Require exact-head review, hostile-client and rollback evidence, and
   separate explicit operator deployment approval. Keep production default
   OFF / NO-GO. #275 is independently gated and unaffected.

The native field milestone is complete within its stated scope; removal,
remaining UI work and the broader issue acceptance criteria are not.
