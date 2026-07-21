# Qollab

Du kennst das: Du und eine Kollegin arbeitet im selben Obsidian-Vault über OneDrive.
Ihr bearbeitet gleichzeitig dieselbe Note — und am nächsten Morgen findet ihr das:

```
Meetingprotokoll (Marias conflicted copy 2026-05-18).md
```

Jetzt müsst ihr manuell schauen was die andere geschrieben hat und die Änderungen zusammenführen.

**Qollab versucht das automatisch zusammenzuführen.** Beide Texte sollen erhalten bleiben — ohne dass ihr Konflikt-Kopien von Hand mergen müsst.

> [!WARNING]
> **Experimentell — noch nicht für wichtige Daten.** Der frühere Verdopplungs-Fehler beim ersten Merge ist behoben (positionsgenaue Diff-Updates + Basis-Adoption). Bis zum finalen Review vor dem ersten Release bleibt Qollab dennoch experimentell: Lasst die Konflikt-Kopie-Sicherung eures Sync-Dienstes vorerst **aktiv** und verlasst euch nicht allein auf Qollab. Details unter [Grenzen](#grenzen).

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

**Inhalts-Verdopplung beim ersten Merge — behoben.** Qollab setzt Änderungen jetzt über positionsgenaue Diffs (unveränderte Zeichen behalten ihre Identität) und baut den Merge-Zustand aus dem persistierten State auf statt aus dem Volltext. Zwei Geräte, die unabhängig vom selben Ausgangsstand starten, verdoppeln den Inhalt dadurch nicht mehr.

**Simultan-Erstkontakt — gelöst.** Wenn zwei Geräte dieselbe Note unabhängig anlegen, *bevor* sie die Hilfsdatei des anderen sehen, bekam früher jede Seite eine eigene Historie und der Sync spaltete sich dauerhaft. Jede Note-Inkarnation trägt jetzt eine Doc-GUID; beim Erstkontakt gewinnt deterministisch die (bytewise) kleinere GUID, das unterlegene Gerät wechselt auf dieselbe Basis. Beide Seiten konvergieren ohne Konflikt-Kopie. Wichtig: Bei *identischem* Text konvergieren beide Seiten verlustfrei; bei *divergentem* Text gibt es keinen zeilenweisen 3-Wege-Merge — es setzt sich deterministisch der Volltext einer Seite als kanonischer Inhalt durch (Divergenzen der anderen Seite können dabei verloren gehen).

**Zombie-Resurrection — behoben.** Eine gelöschte und gleichnamig neu angelegte Note wird nicht mehr durch eine verspätet ankommende alte Hilfsdatei „wiederbelebt": Beim Löschen wird die GUID der alten Inkarnation lokal getombstoned; stale Hilfsdateien dieser GUID werden erkannt, ignoriert und aufgeräumt.

Wenn zwei Personen **gleichzeitig dieselbe Zeile** ändern, entscheidet Qollab automatisch welche Version vorne steht — beide Texte bleiben erhalten, aber die Reihenfolge kann überraschend sein.

**Gerätelokale Tombstones (bewusste Grenze).** Die Lösch-Markierungen liegen nur auf dem Gerät, das die Löschung durchführt. Ein anderes Gerät, das während Löschung + Neuanlage geschlossen/offline war, kann mit seiner alten Historie weiterlaufen und nimmt am CRDT-Merge der neuen Inkarnation nicht mehr teil (sein Tie-Break bevorzugt womöglich die alte GUID). Sein `.md`-Inhalt bleibt über den normalen Datei-Sync trotzdem aktuell — es droht kein Datenverlust, aber der CRDT-Sync ist auf diesem Gerät bis zum Neuaufsetzen des Trackings degradiert. Gesyncte Tombstone-Dateien wären die Ausbaustufe (derzeit nicht umgesetzt).

Echtzeit-Cursor-Sync (wie in Google Docs) ist angedacht, aber mit der server-losen File-Sync-Architektur nicht ohne Weiteres umsetzbar — kein fester Termin.

## Bekannte Architektur-Schwäche

Qollab legt aktuell pro Note eine eigene `.yjs`-Sidecar-Datei unter `.qollab/<vault-path>/<note>.md.<clientId>.yjs` an — das Vault-Tree wird unter `.qollab/` gespiegelt. Bei großen Vaults (1000+ Notes) entstehen entsprechend viele Dateien, was OneDrive/Dropbox unnötig belastet (jede Sidecar ist eine eigene Konflikt-Achse) und gegen die [Yjs-Empfehlung](https://docs.yjs.dev/api/faq) zu „hunderten gleichzeitig geladenen YDocs" verstößt.

Für kleine Vaults (<100 Notes) ist das vernachlässigbar. Für große Vaults aktuell besser deaktivieren bis [Issue #9](https://github.com/TillQuandel/obsidian-qollab/issues/9) (geplanter späterer Refactor auf Subdocuments + SQLite-Single-Store) umgesetzt ist.

## Für Entwickler

```powershell
npm install
node esbuild.config.mjs production   # → main.js
npx jest                              # Tests
```
