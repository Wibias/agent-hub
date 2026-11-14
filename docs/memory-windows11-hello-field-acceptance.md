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
