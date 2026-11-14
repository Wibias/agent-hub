# AgentHub Memory: vom echten E~ zum serviceeigenen WebAuthn-Challenge

**Status: geschützte Windows-Service-Probe von E~ über signierten
WebAuthn-Request und verifizierte Antwort. Keine echte Genehmigung.**

Bis PR #349 gab es einen beständigen, geschützten öffentlichen
Credential-Schlüssel und einen realen `E~`-PENDING-Import. Der Browser
benutzte seine eigenen, ausschließlich im Node-Prozess erzeugten
Challenges; der Windows-Dienst stellte niemals selbst eine Challenge aus.

Dieser Zustand ist mit dem neuen
`AgentHubMemoryReviewLab-OperatorV1`-Pipe als **benutzbare Backend-
Integration** aufgehoben:

1. Ein **Administrator-geprüfter** Client fordert anhand Projekt, Branch
   und `E~`-Ref die dienstseitige Review-Aufgabe an. In der
   **service-SID-eigenen SQLite** werden das ursprüngliche Fact,
   Evidence-Digest, gespeicherte Entscheidung und aktuelle Snapshot-/Git-
   Revision aus dem importierten Quellbeleg gelesen. Der Client kann keine
   neue Aussage, Entscheidung oder öffentlichen Schlüssel einschleusen.
2. Der vorhandene `VerifiedReviewCoordinator` erzeugt die Challenge auf
   dem **tatsächlichen Service-Prozess**, und lädt die öffentliche
   Credential-Identität aus der geschützten Datenbank. Die Antwort enthält
   Original-Fakt, `confirm/reject`, Challenge, Credential-ID und
   Origin. Sie wird mit dem bestehenden serviceeigenen privaten P-256
   Schlüssel signiert.
3. Der Client verifiziert die **rohen signierten Bytes** gegen den
   unabhängig vom Administrator gepinnten öffentlichen Schlüssel, plus
   Nonce, exakten Projekt-/Branch-/Ref-Scope und Fact-Digest.
4. Der WebAuthn-Client sendet eine
   `navigator.credentials.get()`-kompatible Antwort für genau diese
   Challenge zurück. Der **Dienst** prüft Credential-ID, P-256/ES256,
   Origin, RP-ID, UP/UV, einmaliges Ticket und persistenten Zähler.
5. Eine signierte Antwort bestätigt nur
   `operator_webauthn_uv_verified_not_approved`. Das Vorhandensein
   einer P-256-Signatur mit gesetzten Flags ist **kein vertrauenswürdiger
   Windows-Hello-Hardwarenachweis**, solange keine echte Enrollment-
   Zeremonie attestiert und die Anzeige vom geschützten Host kontrolliert
   ist. Es wird **kein** Approval-Intent oder Claim geschrieben.

## Wichtige Isolation

Der neue Pipe ist **ausschließlich** für Administratoren, SYSTEM
und die ganz konkrete SCM-Service-SID freigegeben. Der breite
LocalService-Konto-SID ist ausdrücklich **nicht** freigeschaltet. Er gibt
den vollständigen, potenziell sensiblen Fakt ausschließlich über diesen
administrativen Kanal aus. Der unveränderte, für normale Codex-Clients
sichtbare `AgentHubMemoryReviewLab-ReadV1`-Pipe bleibt dagegen streng
auf seine synthetische Test-Fact/Claim-Scope begrenzt. Er gibt nicht etwa
die echte PENDING-Quelle oder Operator-Credential-Daten aus.

Ein tatsächlich eingeschränktes Token **desselben Windows-Benutzers**
wird in CI sowohl gegen die geschützte SQLite als auch den neuen
Operator-Pipe geprüft. Ein Agent im gewöhnlichen Benutzertoken darf
diese Daten nicht lesen oder eine Challenge anfordern.

## Echte Integrationsprüfung

Die Windows-GitHub-Actions-Installation ist **ausschließlich disposable**
und nur mit `GITHUB_ACTIONS=true` auf `windows-2022` möglich. Sie
erstellt einen echten Git-Checkout und eine kanonische E~-SQLite,
exportiert konsistent, übernimmt die beiden Dateien in geschützte
Service-Dateien, startet den eingeschränkten SCM-Prozess und registriert
einen **synthetischen Software-ES256-Testschlüssel** aus seinem
geschützten Public-Pin.

Der Test führt anschließend **über den echten Windows-Admin-Pipe** eine
Service-Challenge, Verifikation der signierten Fakt-Antwort, eine zum
Ticket passende ES256/UP/UV-Testsignatur und den signierten
Prüfabschluss durch. Ein zweites gültig signiertes Ticket mit dem
**wiederverwendeten nonzero Signaturzähler** muss scheitern. Der
CI-Testschlüssel wird außerhalb des geschützten Windows-Zustands nur
temporär auf dem ephemeren Runner vorgehalten und danach entfernt.
Bisherige signed `memory_recall`- und ACL-Negativtests bleiben
unangetastet.

## Noch offen zum eigentlichen Nutzerziel

**Die physische Browser-/Windows-Hello-Bestätigung ist noch nicht
durchgeführt.** Es fehlt ein **administrativ geschützt installierter,
menschlich kontrollierter interaktiver Operator-Client**, der
die signierte Dienst-Faktenanzeige verlässlich anzeigt, wirklich
`navigator.credentials.get()` auslöst, die Antwort zum Dienst
zurückgibt und die unabhängig authentifizierte Credential-Einschreibung
nachweist. Erst danach kann eine echte Bestätigungs-/Ablehnungsaktion
in `CompleteProtected` atomar genehmigt werden und der geschützte
real-humane Claim über den existierenden signierten
`memory_recall`-Pipe nach Codex gelangen.

Diese PR exponiert **keinen** realen Claim-Write und darf nicht
automatisch auf einem Nutzer-PC installiert werden. Original Codex
CLI/Desktop E2E mit einem echten Claim, Backup/Restore/Rollback und
Opt-in Produktionsaktivierung bleiben ausstehend.

**Production Memory Write NO-GO. Kein neuer Nutzeraccount, keine VM.**
