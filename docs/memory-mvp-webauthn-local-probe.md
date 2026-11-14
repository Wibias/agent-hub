# AgentHub Memory: echte WebAuthn-Interaktion mit einem E~-Vorschlag

**Status: optionaler, lokaler, read-only Nutzer-Prüflauf. Keine Freigabe.**

Das ist ein konkreter Schritt Richtung M2/M3: Die vorhandene Memory Console
zeigt den **tatsächlichen** `E~`-Vorschlag, dessen Git-Revision und
Snapshot-Hash in einem lokalen Browserformular. Vor einer Signatur entscheidet
der Benutzer sichtbar zwischen "Bestätigen" und "Ablehnen".

Es gibt echte `navigator.credentials.create()`- und
`navigator.credentials.get()`-Aufrufe mit
`userVerification: "required"`. Die Antwort wird mit einem frisch
erzeugten ES256/P-256-Public-Key und der bestehenden nativen
`ReviewChallengeCore`-Challenge-Formel geprüft: Protokollkennung,
Projekt, Branch, Git-Commit, `E~`-Ref, Snapshot-Hash, Fakt-Hash
und **gewählte Aktion** sind in einer Einmal-Challenge gebunden.

## Bewusst aktivieren (Windows 11, Node 24, Browser mit WebAuthn)

```powershell
# Im bereits vorhandenen AgentHub-Checkout, keine Serviceinstallation:
node scripts/memory-ui.mjs --repo-root "C:\\path\\to\\approved\\git-repo" --webauthn-probe
```

1. Die Memory Console unter `http://127.0.0.1:4317/` öffnen.
2. Projekt und Branch mit einem echten `E~`-Vorschlag auswählen.
3. Unter **Review** den Vorschlag öffnen und
   **Windows Hello mit diesem E~ testen (nur Prüflauf)** anklicken.
4. Die neue Seite öffnet sich auf **`http://localhost:4317`**, da
   WebAuthn eine geeignete RP-Domain verwendet. Browser blockieren
   WebAuthn möglicherweise, wenn nur `127.0.0.1` als RP verwendet wird.
5. Die vollständige Faktenformulierung, Git-Revision, Entscheidung und
   Blocker kontrollieren. Erst danach den WebAuthn-Dialog starten.
6. Ein neues, nur im Node-Prozess vorhandenes Testcredential registrieren
   und die exakte Entscheidung per WebAuthn signieren. Die Anzeige meldet
   entweder `browser_webauthn_uv_observed_not_approved` oder den Fehler.

Der **erste** Klick lädt die tatsächlichen Prüfdaten; erst der **zweite**
Klick ruft WebAuthn auf. Ein Wechsel der gewählten Aktion setzt die
Vorbereitung zurück. Fehlende/wechselnde Git-Roots, Branches, Vorschläge,
Snapshots, Credential-IDs, Signaturen, Browser-Origin, RP-ID und UV-Flags
werden verweigert. Versuchte Wiederverwendung ist nicht möglich.

### Sicherheitsgrenzen

Die temporäre Registrierung wird nur im RAM des Node-Prozesses gehalten
und spätestens nach 5 Minuten verworfen; die Signatur-Challenge ist
90 Sekunden gültig und wird **vor der Prüfung** verbraucht. Das
Benutzercredential wird weder in der Memory-Datenbank noch im
LocalService-Ledger registriert.

Die Browser-API kann eine echte Windows-Hello-Bestätigung auslösen,
aber die Anwendung kann auch einen anderen WebAuthn-Authenticator oder
Sicherheitsschlüssel verwenden. Ohne einen realen Benutzerlauf können
GitHub-CI-Tests **nicht belegen**, dass Windows Hello auf dem Windows-PC
bereits tatsächlich benutzt wurde.

**Wichtig:** Die temporäre Registrierung hat keine geschützte
Admin-Vertrauenswurzel und kann von einem gleichberechtigten Prozess
simuliert werden. Deshalb bedeutet selbst eine kryptografisch gültige
Signatur hier **weder geschützte menschliche Autorisierung noch einen
Claim-Commit**. Das Ergebnis enthält ausdrücklich
`protectedApproval=false`, `humanApprovalVerified=false`,
`claimWritten=false` und `claimsCreated=0`. Kein Approve-Endpunkt
wird freigeschaltet. Es gibt keinen Rückfall auf ein Klartext-Passwort
oder einen selbstbehaupteten `user_direct`-Status.

Für echte M2-Fertigstellung brauchen wir weiterhin ein
**administrativ geschütztes, wirklich eingeschriebenes
WebAuthn-Credential**, eine vom geschützten Host ausgelieferte verlässliche
Review-Darstellung, unabhängig geprüfte E~-Quell-/Relationsdaten und
eine anschließende Ausführung von `CompleteProtected` im echten Dienst.
Das signierte `memory_recall` ist bislang nur im synthetischen
SCM-Labor nachgewiesen. Echte Codex CLI/Desktop und M4-Installation
sind weiterhin offen.

**Default OFF / keine produktiven Memory Writes / keine PC-Änderung durch PR.**

## CI

Die bestehenden Windows-/Linux-Node-24-Workflows testen:
- `ReviewChallengeCore`-kompatiblen Challenge-Hash,
- gültige Browser-Assertionen mit UP/UV und ES256,
- falsche Signature, Origin, RP, Flags, veränderte Snapshots und Replay,
- den echten HTTP-Endpunkt mit einem temporären Git-Repository und
  `E~`-SQLite-Vorschlag,
- ausdrücklich deaktivierten Standardmodus, verweigerte POST-Origin,
  Branchwechsel und unveränderte kanonische Daten.
