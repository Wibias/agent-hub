# AgentHub Memory M2: lokal geschützter Windows-x64-Prüfstand

**Status: NO-APPROVAL, default OFF.** Kein Produktiv-Installer.
Benutzer-PC nur nach gesonderter, ausdrücklich lokaler Zustimmung.
Keine VM, kein zweiter Windows-Benutzer.

## Motivation und Vertrauensgrenzen

Der bisherige Windows-SCM-Test läuft **nur in GitHub Actions** und darf
nicht auf einem persönlichen PC aktiviert werden. Die native Windows-Hello-
Oberfläche aus PR #351 war bislang nur in der CI auf dem eingeschränkten
Windows-Dienst geprüft. Ein als Administrator direkt aus einem für den
Benutzer/Agenten beschreibbaren Git-Checkout gestartetes Programm könnte
jederzeit ersetzt werden und damit eine angebliche Zustimmung fälschen.

Das separate Preview-Paket führt deshalb vier Schritte zusammen, ohne
die ursprüngliche CI-Sperre zu lockern:

1. `scripts/prepare-memory-review-local-preview.ps1` führt **ohne
   erhöhte Rechte** `dotnet publish` für den bestehenden eingeschränkten
   `MemoryReviewAuthority.LabService` und die native
   `MemoryReviewAuthority.OperatorUi` aus. Erfordert **sauberen
   Git-Checkout**, ein neues Paketverzeichnis, Windows x64 und .NET 10.
   Jede veröffentlichte Datei wird mit SHA-256 und dem exakten Git-SHA
   in `operator-preview-package.json` aufgenommen; zusätzliche,
   umgeleitete, doppelte oder geänderte Dateien werden verweigert.
   Die Ausgabe enthält **kein genehmigtes Memory-Write**.
2. Ein unabhängiger Operator muss **sowohl den Bootstrap-Skript-Hash
   als auch den Paket-Manifest-Hash von einer vertrauenswürdigen,
   unabhängig geprüften Quelle** bestätigen. Ein Hash, der von demselben
   ungeschützten Agenten-Checkout ausgegeben wird, authentifiziert sich
   nicht selbst. Die einmal geprüfte Installations-Skriptdatei wird
   mithilfe der Windows-eigenen ACL-Verwaltung in den Administrator-
   geschützten Pfad
   `%PROGRAMDATA%\AgentHubMemoryReviewLab-Bootstrap\` übernommen,
   inklusive Administrator-Besitzer und explizit geschützter DACL.
   **Der Install-Befehl wird ausschließlich von dieser sicheren Kopie
   akzeptiert.**
3. `scripts/install-memory-review-local-preview.ps1` verlangt
   `-Action Install`, den **unabhängig verifizierten**
   `-ExpectedManifestSha256` und den vollständigen ausdrücklichen
   Einwilligungstext
   `I_APPROVE_TEMPORARY_NO_WRITE_AGENTHUB_PREVIEW`.
   Er verweigert existierende Dienste/Dateipfade. Er kopiert und
   kontrolliert jede Binärdatei nochmals per SHA-256 und installiert
   sie in einem mit SYSTEM/Administrators gesicherten Verzeichnis.
   Für den vorhandenen fixen Namen `AgentHubMemoryReviewLab` wird
   **nur** ein `demand`-Start-LocalService mit `sidtype restricted`
   angelegt. Die serviceeigene `-State`-Directory erlaubt nur genau
   dieser SID, SYSTEM und Administrators das Schreiben.
4. Für die native Windows-Oberfläche wird die vom echten Dienst
   generierte öffentliche P-256-Serviceidentität getrennt veröffentlicht:
   `%PROGRAMDATA%\AgentHubMemoryReviewLab-Public\
   review-service-signing-key.pub.pem`. Sie ist für normale Benutzer
   **nur lesbar**, Besitzer **Builtin Administrators**. Der private
   Dienstschlüssel und die importierte SQLite-Kopie bleiben im
   dienstgeschützten Bereich. Der Benutzer kann einen echten `E~`-
   Fakten-Review über die native UI anfordern, aber **niemals über
   diesen Pfad einen Claim autorisieren**.

Die Quelle benötigt zwei zusätzliche **vorläufige, NICHT verifizierte**
Eingaben: einen realen kanonischen
`operator-evidence-snapshot.sqlite3` plus
`operator-evidence-manifest.json` aus dem bereits vorhandenen
`scripts/export-protected-evidence-review.mjs` sowie den
**öffentlichen** WebAuthn-Schlüsselkandidaten
`operator-webauthn-credential.json` aus dem vorhandenen Browser-
Probelauf. Der Importer stempelt diese Daten bewusst als
`operator_pinned_unverified_evidence_v1` und
`operator_pinned_unverified`. Der exportierte Snapshot enthält
**die gesamte lokale Memory-Datenbank** und muss gegen andere
Benutzer/Agenten und unbeabsichtigtes Hochladen geschützt bleiben.

### Warum das noch nicht der finale AgentHub ist

Das Paket ist **weder digital signiert noch durch ein fertiges
Software-Distributionssystem bereitgestellt**. Der notwendige
unabhängige Hash-/Provenienzabgleich und das geschützte Kopieren des
Bootstrap-Skripts erfordern noch eine explizit vom Menschen
kontrollierte lokale Vorbereitung. Die geprüfte Windows-Hello-API
kann erst in einer echten interaktiven Windows-Sitzung beweisen, ob
ein zuvor im Browser eingeschriebenes Passkey-/FIDO2-Credential
tatsächlich verwendbar ist. Das CI-System führt **keine
biometrische Freigabe** aus.

Insbesondere ist die Benutzereinschreibung noch nicht unabhängig
authentifiziert und der echte `CompleteProtected`-Claim-Commit
für diese Real-`E~`-Quelle bleibt absichtlich verweigert. Der
vorhandene signierte Codex-`memory_recall` bleibt auf synthetische
Laborfakten beschränkt. **Produktiver Memory Write bleibt NO-GO.**

## Kontrollierter Rückbau

Die separat bestätigte Aktion `-Action Remove` mit
`-Consent REMOVE_AGENTHUB_MEMORY_REVIEW_ONLY_PREVIEW` prüft zunächst
den exakten Dienstnamen, dessen Binary-Pfad und den originalen
Administrator-geschützten Installer-Marker. Nur der eigene Dienst
wird gestoppt/gelöscht, danach werden die eigenen Anwendungs- und
öffentlichen Pin-Dateien entfernt.

**Importierte Original-Evidence und dienstgeschützte SQLite werden
NICHT gelöscht.** Sie werden in ein neues
`%PROGRAMDATA%\AgentHubMemoryReviewLab-Preserved-<GUID>`-Verzeichnis
mit geschützten ACLs verschoben. Dieses Archiv enthält sensible Daten
und muss bewusst separat verwahrt beziehungsweise nach verifizierter
Sicherung manuell gelöscht werden. Ein erneuter Install akzeptiert
keinen vorhandenen Ausgangszustand, auch keinen zuvor gescheiterten
Teilinstallationszustand.

### Automatisierte Abnahme

`verify-memory-local-preview-install.yml` führt auf einem
**wegwerfbaren windows-2022 GitHub Runner** den selben Vorgang aus:

- Git-clean, vollständiges SHA256-Bundle, echter kanonischer
  Git+`E~`-Export
- **Verweigerte Installation** bei falsch gepinntem Hash oder
  Ausführung eines ungeschützten Git-Skripts als Administrator
- Exakt geschützter Bootstrap, echte LocalService-Registrierung,
  Service-SID ACL und nativer Operator-Client
- Signierter **real-schema-`E~`**-Fakt im **installierten nativen
  Programm** verifiziert, **ohne** Hello/Claim
- Exakte Entfernung des Test-Dienstes und Erhalt des geschützten
  SQLite-Backups

Das bestehende GitHub-only
`MemoryReviewAuthority.LabService/test-lab-service.ps1` bleibt
**GitHub-only**, damit lokale Preview und Produktionssperre getrennt
sind.

**Nicht aus einem veränderbaren Repository erhöht starten. Nicht ohne
echte menschliche Genehmigung zur Produktivfreigabe hochstufen.**
