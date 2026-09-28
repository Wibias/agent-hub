# knowledge/ -- Kuratierte Wissensbasis

**Zweck:** Dieses Verzeichnis enthaelt stabile, faktische Inhalte, die ueber alle Agent-Harnesses gueltig sind. Hier landen keine Session-Ereignisse, kein prozedurales How-to und keine Verhaltensregeln -- nur Fakten, die sich selten aendern und von jedem Tool genutzt werden koennen.

## Entscheidungsregel (aus ADR-001, Entscheidung 5)

| Inhalt | Ziel |
|---|---|
| Fact (Fakten, Kataloge, Tech-Referenz) | -> `knowledge/` (hier) |
| Event (Session-Lernpunkte, Beobachtungen) | -> `memory/` |
| Verhalten ("Wenn X, dann Y") | -> `rules/*.mdc` |
| Ablauf (Prozessschritte, Workflow) | -> `skills/` |

**Faustregel:** Wenn der Inhalt mit "React Router v7 empfiehlt..." beginnt -> `knowledge/`. Wenn er mit "In Session X habe ich..." beginnt -> `memory/`. Wenn er mit "Wenn [Bedingung], dann..." beginnt -> `rules/`.

## Inhalt

| Datei/Verzeichnis | Beschreibung |
|---|---|
| `index.json` | Maschinenlesbarer Gesamt-Index aller Eintraege (generiert via `build-index.mjs`) |
| `INDEX.md` | Menschenlesbarer Index -- Routing-Hilfe fuer Agents |
| `schema.json` | JSON-Schema fuer alle Index-Eintraege |
| `build-index.mjs` | Index-Builder: scannt Skills, Rules, SOUL, AGENTS.md, externe Kataloge |
| `external/cybersecurity-catalog.json` | Externer Skill-Katalog (mukul975/Anthropic-Cybersecurity-Skills), `catalog-only` |
| `design-references/` | Eigener Design-Referenzkatalog mit 600 kuratierten Records und selektiver Query |

## Update-Workflow (neuer Eintrag)

1. **Quelle pruefen:** Ist der Inhalt faktisch und stabil? Wenn ja -> hier. Sonst -> `memory/`, `rules/`, oder `skills/`.
2. **Datei anlegen oder bearbeiten:** Root-Level fuer eigene Eintraege; `external/` fuer fremde Kataloge.
3. **Status setzen:** Neue Eintraege starten mit `status: "catalog-only"` (kein Review) oder `"active"` (nach menschlichem OK).
4. **Nie loeschen:** Veraltete Eintraege auf `status: "archived"` setzen, Grund in `description` vermerken.
5. **Index neu bauen:**
   ```powershell
   node knowledge/build-index.mjs
   ```
   Das Script schreibt `index.json` und `INDEX.md` neu, prueft SHA-256-Duplikate automatisch, und gibt `Entries: N | Duplicate clusters: 0` aus.

   Der Standard-Rebuild ist absichtlich portabel und deterministisch: Er indexiert den Hub selbst plus deklarierte externe Kataloge. Projekt- und Host-lokale Quellen sind opt-in:

   ```powershell
   node knowledge/build-index.mjs --project-root "<project-root>"
   node knowledge/build-index.mjs --include-host-local
   ```

   Diese erweiterten Modi sind fuer lokale Abfragen gedacht. Ihre maschinenspezifisch erweiterte Ausgabe nicht als kanonischen Public-Index committen.
6. **Validieren:**
   ```powershell
   node -e "JSON.parse(require('fs').readFileSync('knowledge/index.json','utf8')); console.log('OK')"
   ```

## Abgrenzung zu memory/

`memory/` (angelegt durch P2D) enthaelt episodische, session-bezogene Ereignisse. Fuer das Format und die Schreib-Konvention -> siehe `memory/README.md`.

`~/.codex/memories/` ist exklusiv fuer das Codex-eigene Memory-System und wird von diesem Prozess nicht beruehrt.

## Groessenrahmen (aus R7)

- Pro Eintrag: Beschreibung < 300 Zeichen
- `index.json` gesamt: <= 500 KB (nach Rebuild 2026-07-08: ~241 KB)
- Aktive Eintraege nicht alle gleichzeitig in Context laden -- Index ermoeglicht selektives Fetching

