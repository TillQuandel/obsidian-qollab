# Changelog

Alle nennenswerten Aenderungen an Qollab. Format orientiert sich an [Keep a Changelog](https://keepachangelog.com/), Versionierung folgt [SemVer](https://semver.org/).

## [0.4.0] - 2026-07-21

### Added

- Diff-basierter Merge-Kern (`CrdtManager.setContent`): Volltext-Replace-Duplizierung behoben; granulare Yjs-Item-IDs bleiben erhalten. (#10)
- State-basierter Doc-Bootstrap: `applyLocalContent` lädt den persistierten eigenen State als Basis und diff-merged nur die lokale Änderung hinein — kein Volltext-Replace mehr. Bei fehlendem eigenen State werden fremde Sibling-.yjs-Files adoptiert (Sibling-Adoption).
- Neues `.yjs`-State-Format QLB1 mit eingebettetem Doc-GUID (legacy-kompatibel; alte v0-Dateien werden nahtlos eingelesen).
- GUID-Lifecycle und Tombstone-Store: Gelöschte Note-Inkarnationen werden tombstoned — verhindert Zombie-Resurrection durch stale fremde `.yjs`-Dateien.
- Deterministischer GUID-Tie-Break bei gleichzeitiger Erstanlage auf verschiedenen Geräten.
- `PathQueue`: Serialisierung aller Doc-Mutationen (Remote-Merge, lokale Änderung, Startup-Sweep) pro Note-Pfad — verhindert verschränkte Mutationen desselben `Y.Doc`.
- Atomarer Write-Back via `vault.process` (verhindert TOCTOU-Race beim Merge-Ergebnis).
- `rename`- und `delete`-Events werden ebenfalls über die `PathQueue` geleitet (verhindert Orphan-.yjs und GUID-Divergenz).
- `SidecarWatcher` (ersetzt den event-basierten `FileWatcher`): Obsidian liefert für `.qollab` keine Vault-Events, daher ein eigener Wächter — periodischer Poll-Scan des `.qollab`-Baums per Adapter + mtime-Vergleich (30 s), Sofort-Trigger beim Öffnen einer Note (`file-open`) und ein Initial-Scan beim Start (nach dem Sweep), der bei geschlossener App angekommene fremde Sidecar-Stände nachzieht (Erstkontakt-Konvergenz, auch für Stände die schon vor dem Start ankamen).
- Adopt-Pfad erfasst den lokalen `.md`-Text: fehlt eigener State, wird beim Adoptieren einer fremden Sibling-`.yjs` die lokale Note als Diff eingespielt — verhindert lokalen Datenverlust, wenn der Merge-Write-Back sonst die nie erfasste `.md` überschrieben hätte.

### Fixed

- **Sidecar-IO auf Adapter-API — CRDT-Sync funktionierte in echten Vaults nicht** (empirisch belegt im manuellen Zwei-Vault-Test): Obsidians Vault-Index ignoriert Dot-Ordner vollständig — `getAbstractFileByPath('.qollab/…')` liefert immer `null`, `getFiles()` enthält keine `.qollab`-Dateien, `vault.on('modify'/'create')` feuert für sie nie. Der gesamte index-basierte Sidecar-Pfad war damit funktionslos: `saveState` war nach der Erstanlage ein Silent-No-Op (`createBinary` warf „already exists", der Index-Fallback fand nichts), `listYjsFiles` war immer leer, der `FileWatcher` hörte nie etwas, und `rename`/`delete` räumten nie Sidecars. Sämtliche Sidecar-IO (`.qollab/`) läuft jetzt über `vault.adapter` (`exists`/`readBinary`/`writeBinary`/`remove`/`mkdir`/`stat`/`list`/`rename`); die indizierte `.md`-Note bleibt auf der Vault-API. `saveState` überschreibt/legt atomar via `writeBinary` an, `listYjsFiles` ist adapter-gestützt und async. Die Jest-Mocks bilden die Dot-Ordner-Blindheit jetzt ab (Index null für `.qollab`, Adapter sichtbar) — Regressionsnetz gegen ein erneutes stilles Scheitern.
- Write-Back-Guard gegen Verlust lokaler Edits (Cross-Model-Review, HIGH): Landet ein lokaler `.md`-Edit zwischen Merge-Berechnung und Write-Back, überschrieb `vault.process` ihn bisher blind mit dem gemergten Remote-Stand. Der Write-Back hält jetzt den Vor-Merge-Inhalt fest, erkennt den Edit und bringt ihn per 3-Wege-Merge auf den Remote-Stand — beide Änderungen überleben in Datei und CRDT.
- Exakter Sidecar-Match statt Prefix-Match (Cross-Model-Review): `filterYjsFiles` sowie die `rename`/`delete`-Handler matchten `.yjs`-Siblings per `startsWith('.qollab/<note>.')`. Eine eigenständige Note `note.md.archive.md` galt dadurch als Sibling von `note.md` → Cross-Note-Merge bzw. Mit-Löschen/-Umbenennen fremder Sidecars. Der Match ist jetzt exakt (Legacy-Form oder `<note>.<8-hex-clientId>.yjs`); die Handler nutzen `filterYjsFiles` wieder statt eigener Filter.
- `FileWatcher` erkennt zusätzlich die clientId-lose Legacy-Form `.qollab/<note>.yjs` (v0.1-Ära): eine live per Sync ankommende Legacy-Datei löst jetzt ebenfalls einen Merge aus (getrennte strikte/Legacy-Prüfung, damit die greedy Regex bei per-Client-Dateien nicht die clientId in den notePath schluckt).
- Legacy-Sidecar-Lifecycle (R1): v0.1-Dateien (kein QLB1-Header, `guid null`) umgingen den Tombstone-Check und wurden als „immer kompatibel" gemergt — ein zurückkehrender Straggler konnte nach Delete+Neuanlage alten Inhalt in die frische Inkarnation einschmuggeln. Legacy-Dateien werden jetzt ausschließlich beim Erst-Import (kein GUID-tragender State vorhanden) gemergt und danach automatisch gelöscht. Existiert bereits GUID-State, wird die Legacy-Datei sofort ignoriert und entfernt.
- Korrupte `.yjs`-Dateien (R2): Malformierte Updates (Garbage-Bytes, trunkiert) warfen in Yjs ohne Fehlerbehandlung und blockierten den Merge dauerhaft. Sidecar-Lese- und Update-Operationen sind jetzt pro Datei mit `try/catch` abgesichert; eine korrupte Datei wird übersprungen, der Rest-Merge läuft weiter. Korrupte eigene Sidecars werden beim nächsten `saveState` automatisch überschrieben. Einmalige `Notice` pro Pfad und Session informiert den Nutzer.
- `.md`-Overwrite durch Datei-Sync duplizierte Remote-Edits, wenn die Sidecar noch nicht gemergt war (empirisch im Zwei-Vault-Realtest belegt): Lieferte der Sync die bereits gemergte `.md` des Peers *zugleich* mit dessen ungemergter `.yjs`, diffte `applyLocalContent` den gemergten `.md`-Text gegen den eigenen Doc (der die Fremd-Ops noch nicht hatte) und erzeugte die Fremd-Einfügung als neue lokale Op unter eigener Client-ID. Spielte der `SidecarWatcher` später die Fremd-Sidecar ein, dedupliziert Yjs nach Item-ID (nicht Inhalt) → der Fremd-Edit stand **dauerhaft doppelt** im CRDT. Betroffen war sowohl der Laufzeit-Pfad (`modify`-Event bei geladenem Doc) als auch der Startup-Sweep (Sync bei geschlossener App, Bootstrap aus eigenem State) — der häufigste Realfall. `applyLocalContent` mergt jetzt vor dem lokalen Diff erst ausstehende kompatible Fremd-Sidecars ein (reine `mergeCompatible`-Semantik, kein Tie-Break) und wendet die lokale Änderung als 3-Wege-Merge (`threeWayMerge(preMerge, .md-Inhalt, fremd-gemergt)`, wie `onRemoteYjsUpdate`) auf den gemergten Stand an statt per 2-Wege-`setContent`. Damit überlebt ein Fremd-Edit, den die `.md` noch nicht enthält (kein Löschen → kein Cross-Device-Datenverlust), UND ein echter gleichzeitiger lokaler Edit; ist der Fremd-Stand bereits in der `.md` (Sync-Overwrite), bleibt es beim einfachen Übernehmen.

## [0.3.0] - 2026-05-25

### Fixed

- Plugin verpasste `.md`-Edits, die extern bei geschlossener Obsidian-App passierten (CLI-Tools, LLM-Agents, Git-Merge). Neuer `onload`-Sweep schreibt fuer jede `.md` mit mtime > zugehoeriger `.yjs` einen frischen CRDT-Snapshot. Kein `loadAndMerge` im Sweep — verhindert dass stale Snapshots aktuelle Inhalte zurueckrollen. (#8)

### Known Issues

- Mirror-Sidecar-Architektur (1 `.yjs` pro `.md` im gespiegelten `.qollab/`-Tree) skaliert nicht fuer grosse Vaults. Refactor auf Yjs-Subdocuments + SQLite-Single-Store geplant. Bis dahin: bei grossen Vaults (1000+ Notes) besser deaktiviert lassen. Siehe #9.

## [0.2.0] - 2026-05-19

### Changed

- CRDT-State-Files liegen ab jetzt in `.qollab/`-Subordner (`<note>.md.<clientId>.yjs`) statt direkt neben der `.md`. Haelt den Vault-Tree sauber.
- Vault-Wrapper auf `Proxy` umgestellt (statt `Object.assign`), `crypto.randomUUID` fuer `clientId`-Generierung.

### Fixed

- `ensureFolder` race-condition-safe (Parallel-Create durch zweiten Prozess wird abgefangen).
- esbuild-Entry-Point nach Source-Umbau auf `obsidian-crdt-sync/src/main.ts` korrigiert.

## [0.1.0] - 2026-05-18

### Added

- Initiale Version. Automatische CRDT-basierte Merge-Konfliktloesung via Yjs fuer File-Sync-Setups (OneDrive, Dropbox, iCloud).
- Per-Geraet `<clientId>`-getrennte `.yjs`-State-Files; `FileWatcher` merged remote-Updates beim Erscheinen.
- Multi-File-Handler fuer `rename`/`delete` (alle zugehoerigen `.yjs` werden mitgefuehrt).
