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

Es existieren **keine** APIs zum Erstellen, Promoten oder Ändern
autorisierter Claims und keine produktive Passkey-Registrierung.
Gleiche Pending-Anfragen sind bis zur verifizierten Entscheidung idempotent.
Eine abweichende Aktion, Evidence oder Snapshot führt zu einem Konflikt.
Der Speicher hält keine ursprünglichen Fakttexte oder Nutzer-Evidence
und gibt keine Autorisierungstokens aus.

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
keine FIDO2-Registrierung und keine Claims-Schreibbefugnis.
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

`uv_confirm_intent_no_claim` bedeutet deshalb ausdrücklich **weder
`ClaimWritten` noch produktive Approval Authority**. Es gibt keine
`claims`-Tabelle und keinen Pfad, um ein `E~`-Proposal in einem Codex
Memory-Claim zu promoten. Die eigentliche M2-Fertigstellung erfordert einen
vertrauenswürdigen Proposal-Reader, echte Enrollment-/Review-UI,
Claim-Transaktion und eine Dienstprojektion, die lokale Cache-Manipulation
nicht übernimmt. Bis dahin bleibt die Funktion standardmäßig OFF und
Produktivfreigabe NO-GO.
