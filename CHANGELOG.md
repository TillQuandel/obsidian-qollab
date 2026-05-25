# Changelog

Alle nennenswerten Aenderungen an Qollab. Format orientiert sich an [Keep a Changelog](https://keepachangelog.com/), Versionierung folgt [SemVer](https://semver.org/).

## [0.3.0] - 2026-05-25

### Fixed

- Plugin verpasste `.md`-Edits, die extern bei geschlossener Obsidian-App passierten (CLI-Tools, LLM-Agents, Git-Merge). Neuer `onload`-Sweep schreibt fuer jede `.md` mit mtime > zugehoeriger `.yjs` einen frischen CRDT-Snapshot. Kein `loadAndMerge` im Sweep — verhindert dass stale Snapshots aktuelle Inhalte zurueckrollen. (#8)

### Known Issues

- Mirror-Sidecar-Architektur (1 `.yjs` pro `.md` im gespiegelten `.qollab/`-Tree) skaliert nicht fuer grosse Vaults. Refactor auf Yjs-Subdocuments + SQLite-Single-Store geplant. Bis dahin: bei Vaults mit 500+ Notes besser deaktiviert lassen. Siehe #9.

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
