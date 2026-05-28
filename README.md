# Qollab

Du kennst das: Du und eine Kollegin arbeitet im selben Obsidian-Vault über OneDrive.
Ihr bearbeitet gleichzeitig dieselbe Note — und am nächsten Morgen findet ihr das:

```
Meetingprotokoll (Marias conflicted copy 2026-05-18).md
```

Jetzt müsst ihr manuell schauen was die andere geschrieben hat und die Änderungen zusammenführen.

**Qollab versucht das automatisch zusammenzuführen.** Beide Texte sollen erhalten bleiben — ohne dass ihr Konflikt-Kopien von Hand mergen müsst.

> [!WARNING]
> **Experimentell — noch nicht für wichtige Daten.** Im häufigen Fall (zwei Geräte mit demselben Ausgangsstand einer Note) kann der erste Merge den Note-Inhalt **verdoppeln** — der ganze Text erscheint dann zweimal in der Note. Lasst die Konflikt-Kopie-Sicherung eures Sync-Dienstes vorerst **aktiv** und verlasst euch nicht allein auf Qollab. Details unter [Grenzen](#grenzen).

## Installation

1. [Letzten Release herunterladen](https://github.com/TillQuandel/obsidian-qollab/releases/latest) — `main.js` + `manifest.json`
2. Ordner `.obsidian/plugins/qollab/` in deinem Vault anlegen
3. Beide Dateien hineinkopieren
4. Obsidian: Einstellungen → Community Plugins → **Qollab** aktivieren

Funktioniert mit OneDrive, Dropbox, Google Drive, iCloud, Syncthing — und jedem anderen Dienst der Dateien synchronisiert.

## Mit GitHub teilen

Wenn ihr euren Vault über ein privates GitHub-Repository teilt (z.B. mit dem [Obsidian-Git-Plugin](https://github.com/denolehov/obsidian-git)):

1. Fügt eine `.gitattributes`-Datei im Vault-Root hinzu:
   ```
   *.yjs binary
   ```
2. Stellt sicher dass `*.yjs` **nicht** in `.gitignore` steht.
3. Fertig — Qollab erkennt automatisch welche Änderungen von wem kommen.

**Warum funktioniert das?** Jedes Gerät schreibt eine eigene `.yjs`-Datei (z.B. `note.md.a1b2c3d4.yjs`). Git merged diese Dateien nie — jeder schreibt nur seine eigene. Wenn ihr zieht (`git pull`), erkennt Qollab die neue Datei und führt die Änderungen automatisch zusammen.

## Was passiert im Hintergrund?

Qollab legt neben jeder Note eine kleine Hilfsdatei an (`note.md.yjs`).
Diese Datei enthält die Änderungshistorie der Note auf eine Art, die automatisch zusammengeführt werden kann — egal in welcher Reihenfolge die Änderungen ankommen.

Wenn deine Sync-Lösung die `.yjs`-Datei deiner Kollegin synchronisiert, erkennt Qollab das sofort und aktualisiert die Note. Du siehst eine kurze Meldung oben rechts.

Die `.yjs`-Dateien siehst du im Vault-Explorer nicht — Obsidian blendet sie aus.

## Für IT-Abteilungen

- Keine externen Server, keine Cloud-Dienste
- Alle Daten bleiben auf eurer Sync-Infrastruktur (SharePoint, OneDrive, ...)
- Kein Netzwerk-Traffic außer dem normalen Dateisync
- Open Source, vollständig auditierbar

## Grenzen

**Inhalts-Verdopplung beim ersten Merge (bekannter Fehler).** Qollab baut seinen Merge-Zustand aktuell, indem es bei jeder Änderung den kompletten Note-Text neu setzt. Zwei Geräte, die unabhängig vom selben Ausgangsstand starten, erzeugen dadurch getrennte Änderungs-Historien — beim Zusammenführen wird der gemeinsame Text **aneinandergehängt statt erkannt**. Aus `Hallo Welt` wird dann `Hallo Welt\nHallo Welt`. Das betrifft den typischen Einstiegsfall (zwei Personen, geteilter Vault, dieselbe Note). Fix in Arbeit (Umstellung auf positionsgenaue Diffs).

Wenn zwei Personen **gleichzeitig dieselbe Zeile** ändern, entscheidet Qollab automatisch welche Version vorne steht — beide Texte bleiben erhalten, aber die Reihenfolge kann überraschend sein.

Echtzeit-Cursor-Sync (wie in Google Docs) ist angedacht, aber mit der server-losen File-Sync-Architektur nicht ohne Weiteres umsetzbar — kein fester Termin.

## Bekannte Architektur-Schwäche (v0.3)

Qollab legt aktuell pro Note eine eigene `.yjs`-Sidecar-Datei unter `.qollab/<vault-path>/<note>.md.<clientId>.yjs` an — das Vault-Tree wird unter `.qollab/` gespiegelt. Bei großen Vaults (1000+ Notes) entstehen entsprechend viele Dateien, was OneDrive/Dropbox unnötig belastet (jede Sidecar ist eine eigene Konflikt-Achse) und gegen die [Yjs-Empfehlung](https://docs.yjs.dev/api/faq) zu „hunderten gleichzeitig geladenen YDocs" verstößt.

Für kleine Vaults (<100 Notes) ist das vernachlässigbar. Für große Vaults aktuell besser deaktivieren bis [Issue #9](https://github.com/TillQuandel/obsidian-qollab/issues/9) (v0.4-Refactor auf Subdocuments + SQLite-Single-Store) umgesetzt ist.

## Für Entwickler

```powershell
npm install
node esbuild.config.mjs production   # → main.js
npx jest                              # Tests
```
