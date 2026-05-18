# Qollab

Obsidian-Plugin: automatische Merge-Konfliktlösung via Yjs CRDTs für OneDrive/SharePoint-Sync.

Wenn mehrere Personen denselben Vault über OneDrive synchronisieren, entstehen normalerweise
manuelle Konflikt-Kopien (`Note (Max's conflicted copy 2026-05-18).md`). Dieses Plugin löst
Konflikte automatisch auf — beide Änderungen bleiben erhalten.

## Wie es funktioniert

Neben jeder Note `note.md` wird eine `note.md.yjs`-Datei gespeichert (CRDT-State).
Wenn OneDrive eine `.yjs`-Datei synchronisiert, merged das Plugin automatisch via Yjs und
schreibt den Ergebnis-Text in die `.md`-Note.

```
Vault/
  Meine-Note.md        ← sichtbar, bearbeitbar
  Meine-Note.md.yjs    ← CRDT-State (automatisch, nicht anfassen)
```

## Installation (manuell)

1. Letzten Build herunterladen: `main.js` + `manifest.json`
2. Ordner `.obsidian/plugins/crdt-sync/` anlegen
3. Beide Dateien hineinkopieren
4. Obsidian: Einstellungen → Community Plugins → „CRDT Sync" aktivieren

## IT-Audit

- Keine externen Netzwerk-Calls
- Keine Backend-Infrastruktur
- Alle Daten bleiben lokal / auf SharePoint
- Open Source, auditierbar (Apache 2.0)

## Bekannte Limitierungen (Phase 1)

- Bei gleichzeitigen Edits in **derselben Zeile** entscheidet Yjs-Tie-Breaking (nicht diff-basiert)
- Kein Echtzeit-Cursor-Sync — Phase 2 (erfordert WebSocket-Server + IT-Genehmigung)

## Entwicklung

```powershell
npm install
npm run build        # Production-Build → main.js
npx jest             # Tests ausführen
```
