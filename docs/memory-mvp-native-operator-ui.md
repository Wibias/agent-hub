# AgentHub Memory: native Windows-Hello-Prüffenster (Windows x64)

**Status: echte native Windows-UI und Windows-WebAuthn-Interop an vorhandenem
geschütztem LocalService. Das ist weiterhin ein NO-APPROVAL-Prototyp,
kein freigeschalteter Memory-Write.**

## Was nun miteinander verbunden ist

- Ein **explizit erhöht gestartetes** WinForms-Fenster (.NET 10,
  Windows x64). Kein eingebetteter Browser, kein Modell-HTML, kein
  zusätzlich über Benutzerzugriff erreichbarer localhost-Webserver.
- Die UI akzeptiert nur **Selektoren**: Projekt, Branch, `E~`-Ref.
  Ausschließlich der vorhandene **Administrator-/konkrete Service-SID-Pipe**
  darf den originalen Fakt, angegebene Revision, Evidence-/Snapshot-Hashes,
  Aktion `confirm/reject`, öffentliche Credential-ID und eine
  **vom echten Dienst erstellte** einmalige Challenge liefern.
- Die UI verifiziert die **Originalbytes der signierten Dienstantwort** mit
  dem festen öffentlichen Pin aus
  `%PROGRAMDATA%\AgentHubMemoryReviewLab-Public\review-service-signing-key.pub.pem`.
  **Sowohl Datei als auch Verzeichnis** müssen ausdrücklich
  Administrators-owned, frei von Vererbungsrechten und ohne fremde
  Schreibrechte sein. Ein vom Agenten ausgewählter Ersatz-Schlüssel
  wird nicht akzeptiert.
- Der exakte Fakt wird **als reiner Text in einer schreibgeschützten
  nativen Windows-Kontrolle** angezeigt, mit Commit-SHA, Ref, Aktion,
  Hashes und Quelle. Änderungen am Scope verwerfen ihn.
- Erst eine **eigene, bewusste Checkbox und ein Klick** auf
  `Mit Windows Hello prüfen` führen zur nativen Win32-Funktion
  `WebAuthNAuthenticatorGetAssertion` mit `localhost`-RP-ID,
  dem dienstseitig gepinnten Credential in der Allowlist,
  **`USER_VERIFICATION_REQUIRED`**, 60 Sekunden Timeout und
  exakt der vom Dienst ausgegebenen Challenge.
- Die Windows-API liefert originale Authenticator-Daten/DER-Signatur.
  Die native UI schickt diese unverändert mit ihrer eigenen
  `webauthn.get`-ClientDataJSON an den **bereits vorhandenen**
  Operator-Pipe zurück. Der Dienst prüft selbst ECDSA-Signatur,
  Credential, UP/UV, Origin, RP-ID und den monotonen Zähler.
- Die native Oberfläche akzeptiert nur
  `operator_webauthn_uv_verified_not_approved`.
  Ein Erfolg ist **ausdrücklich kein echter genehmigter Claim**.
  Dieser Operator-Pipe besitzt nach wie vor nur `begin` und
  `complete`, keinen Schreib-/Freigabebefehl.

## Reproduzierbare Windows-CI-Abnahme

`verify-memory-native-operator-ui.yml` kompiliert diese echte
Windows-x64-Anwendung mit `-warnaserror` und führt einen rein
kryptografischen Vertragstest aus. Das simuliert **nicht**
Windows Hello. Ein zweiter Test in der **existierenden**
Windows-LocalService-SCM-Pipeline baut dieselbe UI und führt
`--service-smoke` aus. Dabei fragt die reale native UI-Binärdatei
einen durch Service-SID und DACL geschützten, laufenden LocalService ab
und prüft den Original-E~-Fakt samt vollständiger Dienstsignatur und
geschütztem Pin. Der Test startet bewusst **keinen** Windows-Hello-Dialog
und schreibt keinen Claim.

Build, aber ohne Installation oder Dienstaktivierung:

```powershell
dotnet build .\memory-engine\authority-host\windows\MemoryReviewAuthority.OperatorUi\MemoryReviewAuthority.OperatorUi.csproj -c Release --runtime win-x64 -warnaserror
```

Die UI ist **nur mit einem bereits laufenden Labor-Dienst** und
dessen unabhängig Administrator-geschütztem Service-Pin sinnvoll
nutzbar. **Das Executable jetzt nicht aus dem schreibbaren Git-Checkout
erhöht starten!** Vor dem echten Human-E2E muss es in einem
kontrollierten, Admin-owned, gegen gleichberechtigte Agenten
nicht manipulierbaren Installationsverzeichnis liegen. Ein ungeschützt
eleviertes, agentänderbares Binary wäre selbst eine neue
Privilegieneskalations-/Consent-Fälschungsmöglichkeit. Außerdem muss die
Windows-Hello-Passkey-Registrierung unabhängig und tatsächlich
vertrauenswürdig abgeschlossen sein, statt lediglich einen möglichen
Software-Schlüssel aus dem Browser in JSON zu übernehmen.

## Verbleibende Produkt-Abnahme

1. **Geschützter Operator-Installations-/Enrollmentpfad**: von
   Administrator/SERVICE-SID geschützte Binärdatei und signiertes
   Service-Pinning, eindeutiger menschlicher Enrollment-Beschluss.
   Die bisherigen importierten `operator_pinned_unverified` Schlüssel
   dürfen nicht stillschweigend zu vertrauenswürdigen Credentials werden.
2. **Physischer E2E auf dem echten Windows-11-x64-Gerät**: Operator
   startet die wirklich geschützte UI und bestätigt einen signierten
   E~-Vorschlag über Windows Hello oder FIDO2. Bis dahin sind Interop
   und Geräteverfügbarkeit/kompatible localhost-Passkeys unbewiesen.
3. **Erst nach 1 und 2**: dieselbe Service-Transaktion für echtes
   `confirm/reject` autorisieren, den genehmigten Claim über den
   signierten vorhandenen `memory_recall` in originaler Codex
   CLI/Desktop lesen und dem Benutzer transparent anzeigen.
4. Backup, Rollback, sichere Opt-in-Installation und Rollout.

**Keine VM, kein zweiter Windows-Benutzer. Keine Änderungen am Benutzer-PC,
an Codex-Hooks, am ursprünglichen SQLite-Memory oder an Diensten.
Production Memory Write NO-GO.**
