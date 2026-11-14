# AgentHub Memory M2: tatsächliche E~ Evidence-Quelle im geschützten Review

**Status: echter E~-Quellimport in den bestehenden geschützten Windows-Store,
ausdrücklich nur PENDING. Keine Windows-Hello-Freigabe, kein Real-Claim.**

Vorher kannte der eingeschränkte Windows-LocalService nur seinen synthetischen
CI-Claim. Der neue Importer
`ProtectedPendingReviewLedger.ImportOperatorPinnedEvidence()` löst nun einen
tatsächlichen `needs_confirmation`-Eintrag aus den bestehenden kanonischen
`memory_evidence_proposals`-Tabellen anhand seines echten `E~`-Refs auf,
liest alle verknüpften Evidence-Einträge aus der SQLite-Kopie und speichert
den ursprünglichen Fakteninhalt, seinen Hash, die Evidenzhashes, Projekt,
Branch, angegebene Revision und gewünschte Entscheidung als
**unveränderliche, serviceeigene PENDING-Quelle**.

## Geschützte Eingangsschnittstelle

**Kein neuer IPC-Write-Befehl.** Der Windows-Dienst liest nur diese
festen Dateien aus seinem bereits durch Service-SID/Admin-DACL geschützten
ProgramData-Zustandsverzeichnis:

- `operator-evidence-snapshot.sqlite3`: **konsistentes SQLite-Backup**
  des kanonischen Nutzer-Memory-Datenbestands. Kein direktes Lesen der live
  veränderbaren Nutzer-Datenbank durch den privilegierten Dienst.
- `operator-evidence-manifest.json`: exakt `projectId`, `branch`,
  `revisionSha`, `proposalRef` und `decision`
  (`confirm` oder `reject`).

Der Operator bzw. künftige privilegierte Importer muss diese Dateien
absichtlich und mit geschützter Eigentümerschaft platzieren. Sie werden
**nicht** durch die Memory Console, Hooks, Codex-CLI oder einen gewöhnlichen
gleichberechtigten Agenten angelegt. Die Pfade können nicht über eine
MCP-Anweisung, die named pipe oder den Manifest-Inhalt ausgetauscht werden.
Nur das explizite SCM-Labor probiert den Import bei seinem Start.

Beim Import gelten: echte SHA256-basierte E~-ID, maximal 10.000
zu durchsuchende Vorschläge, keine Kollision, Status
`needs_confirmation`, `knowledge` oder `preference`, maximal zehn
Evidence-Zeilen, korrekte Scope-Referenzen, keine secret-redacted oder
fehlgeschlagenen Tool-Belege, bei `preference` nur
`user_direct`-klassifizierte Evidence. Bei aktiven Claims im
Projekt/Branch wird der Import verweigert, damit ein noch ungeklärtes
Update/Conflict nicht irrtümlich als unabhängige Tatsache gilt.

### Explizite Vertrauensgrenze

**Die Quelle ist NICHT unabhängig authentifiziert.** Auch ein
Administrator-geschütztes Backup kann ursprünglich von einem Agenten
manipulierte Nutzerdaten enthalten. Ebenso ist der Git-SHA im Manifest
erst eine **Operator-Angabe**, keine vom Windows-Dienst verifizierte
Repository-Herkunft. `user_direct` ist in der ungeschützten Quelldatenbank
nur eine Behauptung und kein verlässlicher Identitätsnachweis.

Darum speichert der Dienst den Ursprung ausschließlich als
`operator_pinned_unverified_evidence_v1` und gibt
`HumanApprovalVerified=false`, `ClaimWritten=false` zurück. Das
Einfrieren der SQLite-Kopie beseitigt das Risiko nachträglicher Änderungen
innerhalb des geschützten Review-Snapshots, **nicht** die Herkunftsfrage.

Solange weder ein administrativ geschütztes echtes Windows-Hello-/FIDO2-
Credential noch eine verifizierte, vertrauenswürdige und benutzerkontrollierte
Anzeige im Dienst existieren, verweigert die atomare Finalisierung jede
Promotion solcher realen Imports mit
`real_review_credential_enrollment_required`. Ein synthetischer Schlüssel
kann das **nicht** umgehen. Der vorhandene signierte
`memory_recall`-Endpunkt gibt nur seine unverändert synthetischen
CI-Daten aus, **niemals einen realen PENDING-Import**.

## Abnahme auf GitHub Windows CI

Der bereits bestehende Windows SCM-Integrationstest erzeugt eine
disposable SQLite-Datei mit dem **realen kanonischen Vorschlags- und
Evidence-Tabellenschema**, platziert sie nach DACL-Einrichtung im
serviceeigenen Verzeichnis, startet den eingeschränkten LocalService und
prüft die vom Dienst selbst geschriebene
`REAL_EVIDENCE_PENDING_NO_CLAIM`-Markierung sowie die
bereits vorhandenen ACL-/signierten-MCP-/Cleanup-Negativtests.

Die nativen Store-Tests prüfen außerdem Import/Restart/Idempotenz,
unzulässige Evidence-Herkunft, aktive Konflikt-Claims, nicht unterstützte
Prozeduren und eine nach dem Import veränderte Evidence-Quelle.
Ein gültig signierter **synthetischer** UV-Nachweis wird gegen den realen
PENDING-Datensatz getestet und muss scheitern.

## Unverändert offen

1. **Ein bedienbarer, sicherer Operator-Import** aus dem aktuellen
   Git-Checkout und ein unabhängig geprüfter, vor Manipulation geschützter
   Herkunfts-/Frische-Nachweis. Die neue Importfunktion versteht das echte
   SQLite-Schema, aber das bloße Einfrieren der Quelle ersetzt kein Provenienz-
   oder User-Consent-Urteil.
2. **Echte servicegeschützte Windows-Hello-Registrierung und
   vertrauenswürdige exakte Review-Anzeige** (nicht das ungeschützte
   Browser-WebAuthn-Probecredential).
3. Der bereits implementierte atomare UV-Commit muss eine wirklich
   genehmigte echte Quelle autorisieren; **danach** erst den echten Claim
   in den signierten, projektbezogenen Codex-Recall übernehmen.
4. Original Codex CLI/Desktop E2E auf Windows x64, Backup, Rollback,
   ausdrückliche Aktivierung.

**Keine Änderung am Operator-PC oder der bestehenden Memory-Datenbank;
Memory Write in Produktion = NO-GO.** Der Code wird nur in einem CI-Labor
mit synthetischem, aber real-schema-kompatiblem SQLite-Inhalt ausgeführt.
