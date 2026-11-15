# Isolierter Evidence-Bound-Prüfstand auf Windows 11 x64

Dieser Schritt dient nur der **Vorbereitung**: eine konsistente SQLite-Kopie
der vorhandenen echten Memory-Evidence mit dem Evidence-Bound-Schema aus dem
aktuellen AgentHub-Code. Es gibt **keinen Modellaufruf**, keine erfundene
`E~`-Bewertung, keine automatische Freigabe und keine Claim-Änderung.

## Einmalig ausführen, normaler PowerShell-7-Benutzer

Voraussetzung: Aktueller sauberer AgentHub-Review-Worktree, Node 24+,
vorhandene kanonische Memory-DB. Beispiel für die bereits registrierte
Streamer-Content-Quelle:

```powershell
$review = "$env:LOCALAPPDATA\AgentHub-Hello-fffaac6db896"
$source = "$env:LOCALAPPDATA\agent-hub\memory.sqlite3"
$shadow = Join-Path $env:LOCALAPPDATA (
  "AgentHub-Evidence-Shadow-" + [guid]::NewGuid().ToString('N')
)

node "$review\scripts\prepare-memory-evidence-shadow.mjs" `
  --db-path $source `
  --output-dir $shadow `
  --project-id "github.com/Wibias/streamer-content" `
  --branch "fix5-plan44"
```

Das neue Verzeichnis ist **nicht** die produktive DB und darf vor
dem Start nicht existieren. Der Bericht enthält nur Zählwerte, Pfade und
Statusflags, keine Memory-Inhalte. Der Source-DB-Handle ist read-only,
und das Backup erfolgt mit der konsistenten SQLite-Backup-API, nicht mit
einem unsicheren Kopieren der Live-DB. Das Werkzeug verweigert ein Ziel
im Ordner der kanonischen DB und ein bestehendes Ziel.

Die Kopie ist **vollständig**, einschließlich privater Daten aus *allen*
Projekten, nicht nur Streamer Content. Sie ist im selben
Benutzerkontext beschreibbar, hat keine Administrator-DACL und ist
**keine** geschützte Importquelle. Nicht ins Repo, in Chat, Cloud,
CI oder andere Benutzerprofile übertragen. Nicht als privilegierte
Dienstquelle verwenden.

## Erwartetes Ergebnis

```json
{
  "status": "isolated_evidence_shadow_ready_unjudged",
  "sourceDatabaseModifiedByTool": false,
  "shadowSchemaInitialized": true,
  "modelInvocations": 0,
  "decisionsApplied": 0,
  "claimsCreated": 0,
  "protectedApproval": false
}
```

Wenn das Source-Schema noch keine `memory_evidence_proposals` enthielt,
wird es **nur in der Kopie** erzeugt. Das erzeugt keine `E~`-Vorschläge.
Die eingelesene echte Evidence ist nicht mit einer bewerteten
`knowledge`- oder `preference`-Proposition gleichzusetzen.

Die bestehende vollständige Evidence-Bound-Pipeline kann Claims erzeugen,
deshalb **nicht** einfach `runEvidenceBoundMemoryPipeline()` auf diesem
Shadow starten. Für einen echten `E~`-Vorschlag müssen ein legitimer
Extraction-Judge und die unabhängigen Importance-, Support- und
Relation-Entscheidungen geprüft werden. Fehlgeschlagene Codex-Aufrufe
wegen `usage_limit_reached_possible` nicht automatisch wiederholen.

## Prüfung der isolierten Daten ohne Inhalte

```powershell
node "$review\scripts\inspect-memory-unresolved-proposals.mjs" `
  --db-path "$shadow\memory-shadow.sqlite3" `
  --project-id "github.com/Wibias/streamer-content" `
  --branch "fix5-plan44"
```

## Extraktion separat vorbereiten

Die neue Extraction-CLI liest erst **nur** Metadaten aus dem vorhandenen
Shadow. Das ist ohne Modellkonto, Tokenverbrauch oder SQLite-Änderung möglich:

```powershell
node "$review\scripts\extract-memory-shadow-evidence.mjs" `
  --shadow-db "$shadow\memory-shadow.sqlite3" `
  --project-id "github.com/Wibias/streamer-content" `
  --branch "fix5-plan44"
```

Die Standardausgabe zeigt ausschließlich Anzahl/Eignung der gespeicherten
Evidence. Mehr als 25 Evidence-Einträge im Scope führen zum Stopp, nicht zu
stiller Auslassung. Die CLI akzeptiert nur eine echte Datei
`%LOCALAPPDATA%\AgentHub-Evidence-Shadow-<32 hex>\memory-shadow.sqlite3`.
Diese Pfadkontrolle schützt vor Verwechslungen mit der Live-Datenbank,
**nicht** vor demselben Windows-Benutzerkonto oder manipulierten Shadow-Daten.

Erst nach erneut verifiziertem Modellzugang und einer **bewussten**
Nutzerentscheidung kann die optionale Flag `--run-model` einen einzelnen
isolierten Codex-Extraction-Judge starten. Er liest `content_redacted`
der geeigneten Evidence-Einträge und überträgt sie als Prompt an den
konfigurierten Codex-Modellanbieter. Niemals automatisch wiederholen,
wenn das Kontingent erschöpft ist.

```powershell
# NICHT ausführen, solange das Nutzungslimit erreicht ist:
node "$review\scripts\extract-memory-shadow-evidence.mjs" `
  --shadow-db "$shadow\memory-shadow.sqlite3" `
  --project-id "github.com/Wibias/streamer-content" `
  --branch "fix5-plan44" `
  --run-model
```

Wenn der Aufruf fehlschlägt, gibt die CLI jetzt einen JSON-Status
`shadow_extraction_failed` mit einem festen `failure_code`,
`model_call_attempted` und gegebenenfalls `process_exit_code` zurück.
Weder Source-Evidence noch rohe stderr-/Modellantworten werden ausgegeben.
`usage_limit_reached_possible` ist ein Hinweis, kein sicher bestätigter
Kontostand. Bei dieser Kategorie keinen automatischen Retry auslösen.
`shadow_proposals_may_have_changed` ist vorsorglich `true`, sobald der
Modellaufruf begonnen hat. Tatsächliche Vorschläge anschließend **nur**
durch das lesende Inventar prüfen.

Die Extraktion kann höchstens fünf neue Vorschläge erzeugen, **ausschließlich**
mit `status=pending` und echter Modell-Evaluator-ID. Sie führt keine
Importance-, Support-, Relation- oder Promotion-Stufe aus und schreibt
keine Claims, `needs_confirmation` oder Bestätigung. Das erzeugt also
**noch keinen** reviewbaren `E~`-Vorschlag für die native Abnahme.
Klassische `memory_candidates` werden nicht in Evidence-Bound-Claims
umgedeutet.

## Extraction v2: Geltungsbereiche nicht ausweiten

Zwei echte Streamer-Content-Vorschläge aus dem alten `evidence-extraction-v1`
wurden vom Evidence-Support als `unsupported` verworfen: einmal wurde
eine konkrete autorisierte Assertion-Änderung zu einer allgemeinen
Testmigrationsregel ausgeweitet, einmal wurden Regeln für Plan 44 auf
alle Builds ausgedehnt. Die Support-Prüfung hat dabei korrekt gestoppt.

Die neue `evidence-extraction-v2` präzisiert den Prompt:
Geltungsbereiche wie Plan/Build, Phase, Ziel, Test, Pfad, Version,
Autorisierungsgrenze und Ausnahme **müssen erhalten bleiben**. Eine
einmalige Erlaubnis ist keine Dauerregel. Wenn ein präziser Fakt nur
kurzzeitig gilt, wird er lieber ausgelassen, statt künstlich zu
einer langlebigen allgemeinen Policy zu werden.

Die Änderung ist **Prompt-Härtung, keine formale semantische Garantie**.
Eine Modellantwort kann dennoch fehlerhaft sein. Der unabhängige
Evidence-Support bleibt zwingend. Bereits als `ignored` bewertete
v1-Vorschläge werden nicht heimlich repariert oder reaktiviert. Die
noch offenen v1-`pending`-Einträge werden nicht ungeprüft als v2
etikettiert. Eine spätere explizite v2-Extraktion auf dem Shadow
braucht gesonderte Entscheidung und kann zusätzliche `pending`-
Vorschläge anlegen; keine automatische Wiederholung.

## Importance separat, höchstens EIN Proposal pro Ausführung

Nach erfolgreicher Extraktion können die vorhandenen `pending`-Vorschläge
durch die Importance-Stufe einzeln bewertet werden. **Nicht** die komplette
`runEvidenceBoundMemoryPipeline()` auf diesem Shadow starten, weil deren
Promotion-Stufe sonst auch Claims erzeugen könnte.

Zunächst ohne Modellkosten die Anzahl offener Importance-Fälle lesen:

```powershell
node "$review\scripts\judge-memory-shadow-importance.mjs" `
  --shadow-db "$shadow\memory-shadow.sqlite3" `
  --project-id "github.com/Wibias/streamer-content" `
  --branch "fix5-plan44"
```

Der explizite Aufruf `--run-model` bewertet **genau den ältesten**
noch nicht bewerteten `pending`-Vorschlag; er führt keine automatische
Schleife aus. Der Prompt enthält dessen `canonical_fact`, die
Evidence-IDs und Authorities, jedoch nicht die Originalbelege. Für
`promote` wird der Status zunächst `pending` bleiben: Er wartet auf
die gesonderte Support-/Relationsprüfung. `needs_confirmation`
wechselt in den Review-Status, **ohne** menschliche Zustimmung oder
Claim-Write. `ignore` wird als `ignored` vermerkt.

```powershell
# Nur nach bewusster Entscheidung, GENAU EIN Modellurteil:
node "$review\scripts\judge-memory-shadow-importance.mjs" `
  --shadow-db "$shadow\memory-shadow.sqlite3" `
  --project-id "github.com/Wibias/streamer-content" `
  --branch "fix5-plan44" `
  --run-model
```

Der Bericht enthält keine Faktentexte und keine rohen CLI-Fehler.
Nach jedem Modellurteil die lesende Inventar-CLI ausführen.
Quotafehler und unerwartete Statusänderungen nicht blind wiederholen.

## Evidence-Support als eigener Schritt

Nur ein bereits von Importance mit `promote` bewerteter, weiterhin
`pending`-Vorschlag ist dafür berechtigt. Die Support-Stufe prüft
gegen dessen tatsächlich zitierte Evidence-Texte, ob die vollständige
Faktenformulierung ohne zusätzliche Schlussfolgerungen gestützt ist.

```powershell
# Ohne Modell: Anzahl der aktuell supportfähigen Vorschläge
node "$review\scripts\judge-memory-shadow-support.mjs" `
  --shadow-db "$shadow\memory-shadow.sqlite3" `
  --project-id "github.com/Wibias/streamer-content" `
  --branch "fix5-plan44"

# Optional genau EIN echter Evidence-Support-Judge:
node "$review\scripts\judge-memory-shadow-support.mjs" `
  --shadow-db "$shadow\memory-shadow.sqlite3" `
  --project-id "github.com/Wibias/streamer-content" `
  --branch "fix5-plan44" `
  --run-model
```

Dieser Aufruf übermittelt die exakt zitierten, lokal gespeicherten
`content_redacted`-Texte an den konfigurierten Codex-Modellanbieter.
Er startet höchstens einen Modellaufruf und keine Schleife.
Bei `supported` bleibt der Vorschlag `pending` für eine spätere
Relationsprüfung. `needs_confirmation` kennzeichnet nur eine
**ungeprüfte, nicht autorisierte** Review-Pflicht. `unsupported`
führt zu `ignored`, ohne Claims zu erstellen.

Die Support-Stufe führt keine Relation, Promotion, nativen
Windows-Hello-Schritt oder Claim-Änderung aus. Bei Fehlern oder
quotabedingter Sperre nicht automatisch wiederholen. Nach dem Aufruf
die bestehende lesende Inventar-CLI prüfen.

Anschließend mit der eigentlichen Browser-Console und einem
**tatsächlich vorhandenen, unabhängig geprüften E~-Vorschlag** fortfahren.
Der bestehende künstliche Browser-Hello-Test ist nur ein Interaktionstest.
Für die native Abnahme gelten weiterhin
`docs/memory-windows11-hello-field-acceptance.md` und deren
Hash-, ACL-, Provenienz- und Zustimmungssperren.

**Produktive Memory-Writes bleiben OFF / NO-GO.**
