# AgentHub Memory M2: dauerhaft gespeicherter operator-WebAuthn-Key für echte E~

**Status: integrierter, aber weiterhin nicht autorisierender WebAuthn-Operator-Prüfpfad.
Echte Genehmigung und produktiver Memory Write bleiben gesperrt.**

Nach der Verbindung der echten `E~`-Quelle mit dem bestehenden geschützten
Windows-Service (PR #348) war die nächste offene Grenze klar: Der ursprüngliche
Browser-WebAuthn-Probelauf hielt das Schlüsselmaterial nur im flüchtigen
Node-Prozess. Der geschützte Windows-Dienst kannte diese Credential-Identität
überhaupt nicht.

Diese Lücke wird durch
`ProtectedPendingReviewLedger.StageUnverifiedOperatorCredential()` und
`VerifiedReviewCoordinator.ForOperatorCredentialProbe()` konkret adressiert.

## Nachprüfbarer Ablauf

1. Die bestehende Memory Console bietet `--webauthn-probe` an. Ein echter
   `E~`-Vorschlag wird zusammen mit dem originalen Fakt, Revision,
   Snapshot und der gewählten Entscheidung gezeigt.
2. `navigator.credentials.create()` und `navigator.credentials.get()`
   fordern WebAuthn-Registrierung und UV-Nachweis an. Browser oder Windows
   können das **neue Passkey-Credential auf dem Gerät behalten**.
3. **Erst nach erfolgreicher Browser-Signatur** bietet die Oberfläche den
   expliziten Export `operator-webauthn-credential.json` an. Enthalten sind
   ausschließlich Credential-ID, öffentlicher P-256-Schlüssel im
   `BEGIN PUBLIC KEY`-PEM-Format und `http://localhost:<Port>`-Origin.
   Keine private Schlüsseldatei, keine biometrischen Daten, keine Windows-PIN.
   Trotzdem ist das Dokument **noch nicht vertrauenswürdig**.
4. Der eingeschränkte Windows-Dienst importiert optional einen solchen
   festnamigen Operator-Pin **nur aus seinem eigenen Service-SID-/Admin-
   geschützten Zustandsverzeichnis**. Das entsprechende Verzeichnis und
   dessen Besitzrechte müssen vorher ausdrücklich durch einen
   Administrator kontrolliert werden; diese PR installiert keine
   Produktionsdienste. Der Pin wird in der **bestehenden geschützten SQLite**
   abgelegt, bei Wiederholung nur exakt idempotent angenommen und bei
   Änderung des öffentlichen Schlüssels/der Credential-ID verweigert.
5. `ForOperatorCredentialProbe` lädt den Pin **aus der geschützten
   Datenbank**, nicht aus einem angeforderten IPC-Key, prüft den originalen
   Dienst-`E~`-Snapshot und kann eine neue einmalige WebAuthn-Challenge
   ausgeben. `CompleteOperatorProof` prüft mit dem gespeicherten Schlüssel
   Origin, RP-ID, Challenge, ES256-Signatur sowie UP/UV und schreibt den
   **nichtnegativen, monotonicen Signaturzähler** in die geschützte DB.
   Der Zähler übersteht Neustarts; Wiederverwendung mit zu altem
   von-null-verschiedenem Zähler scheitert.
6. Der Testausgang ist immer
   `operator_webauthn_uv_verified_not_approved`, **niemals**
   `ApprovedClaim`, `ClaimWritten`, produktiver Consent oder Trust für
   `memory_recall`. Auch die reguläre Coordinator-Claim-Finalisierung
   bleibt auf dem Operator-Probe-Objekt gesperrt.

## Warum das noch KEINE echte Windows-Hello-Freigabe ist

Eine Software-ES256-Signatur kann im Test genauso aussehen wie ein
WebAuthn-Authenticator mit gesetztem UV-Bit. Auch ein public-key-Manifest
kann ein gleichberechtigter Agent fälschen, bevor ein Administrator es
gezielt übernimmt. **Eine von einem Modell erstellte JSON-Datei, eine
korrekte Signatur oder ein behauptetes `user_direct` sind keine
authentifizierte Zustimmung.**

Für eine produktive Einschreibung müssen wir nach wie vor:
- ein eigenständig vertrauenswürdiges, durch Administrator-/Service-SID
  geschütztes Setup und eine **gesicherte, tatsächliche Enrollment-Zeremonie**
  mit dem echten Windows-Hello-/FIDO2-Gerät umsetzen,
- eine vom **geschützten Host** kontrollierte UI bereitstellen, die genau den
  ursprünglichen Fakt, Handlung und SHA-Revision zeigt, bevor eine
  **vom Service ausgestellte** Challenge an den Browser geht,
- eine real verifizierte signierte Entscheidung innerhalb der vorhandenen
  atomaren Service-Transaktion ablegen und nur diesen bestätigten realen
  Claim über den bestehenden signierten `memory_recall`-Pfad freigeben,
- Original Codex CLI/Desktop E2E unter Windows x64, Backup, Rollback und
  expliziten opt-in Install durchführen.

Der Browser-Probelauf wird hier **nicht** bereits mit einem echten
dienstseitig ausgestellten Challenge-Ticket verbunden. Die neue native
Credentialprüfung wird in Windows-CI über synthetische P-256-Proofs getestet;
ein echter Browser-/Windows-Hello-Dialog auf dem Operator-PC wurde damit
weder ausgelöst noch nachgewiesen. Das getrennte Service-/Browser-
Handshake bleibt das abschließende Integrations-Gate.

## Sicherheit und CI

Die Windows Store-Selftests verifizieren eine tatsächlich importierte
`E~`-Quelle, zuvor admin-gepinnten öffentlichen Schlüssel, eine erfolgreiche
UV-Probe **ohne** Entscheidungs-/Claim-Write, Fortbestand nach SQLite-Reopen,
Replay mit altem Zähler, Identitätswechsel und physische Mutations-
Verweigerung über die bestehenden SQL-Triggers.

Der reale eingeschränkte Windows-LocalService startet in GitHub Actions
aus der einmalig geschützten DACL und importiert den unbestätigten
öffentlichen CI-Testschlüssel. Das End-to-End-SCM-Skript verifiziert
dessen `OPERATOR_CREDENTIAL_UNVERIFIED_NO_APPROVAL`-Markierung, die
weiterhin unveränderte echte `E~`-PENDING-Quelle und das synthetische
signierte Codex-MCP-Readback. Dienst/SQLite/DACL/Dateien werden anschließend
entfernt.

**Keine Änderungen an der Windows-Installation, den Codex-Hooks oder der
Memory-DB des Anwenders. Kein produktiver Memory-Write.**
