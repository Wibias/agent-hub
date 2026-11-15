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

Die Extraktion kann höchstens fünf neue Vorschläge erzeugen, **ausschließlich**
mit `status=pending` und echter Modell-Evaluator-ID. Sie führt keine
Importance-, Support-, Relation- oder Promotion-Stufe aus und schreibt
keine Claims, `needs_confirmation` oder Bestätigung. Das erzeugt also
**noch keinen** reviewbaren `E~`-Vorschlag für die native Abnahme.
Klassische `memory_candidates` werden nicht in Evidence-Bound-Claims
umgedeutet.

Anschließend mit der eigentlichen Browser-Console und einem
**tatsächlich vorhandenen, unabhängig geprüften E~-Vorschlag** fortfahren.
Der bestehende künstliche Browser-Hello-Test ist nur ein Interaktionstest.
Für die native Abnahme gelten weiterhin
`docs/memory-windows11-hello-field-acceptance.md` und deren
Hash-, ACL-, Provenienz- und Zustimmungssperren.

**Produktive Memory-Writes bleiben OFF / NO-GO.**
