# Qollab — Code-Review & Entwicklungs-Roadmap (2026-05-28)

> Ergebnis eines Multi-Agent-Reviews (6 Dimensionen, adversariale Verifikation) + empirischer
> CRDT-Tests gegen die echte yjs-Lib. Stand: v0.3.0.

## Verdict

Handwerklich solide (klare Modultrennung, Race-bewusste Details, Tests grün), aber die **zentrale
CRDT-Annahme ist falsch** — empirisch belegt, nicht vermutet. Bis der Merge-Kern repariert ist (P1),
ist das Plugin nicht für echte Daten geeignet.

| Bereich | Status |
|---|---|
| Datenintegrität (Merge-Kern) | 🔴 dupliziert Inhalte |
| Ehrlichkeit der Doku | 🟡 in P0 entschärft (README aktualisiert) |
| Concurrency | 🟡 geteilter Y.Doc unsynchronisiert |
| Test-Aussagekraft | 🟡 grün, prüfen aber das Falsche |
| Build/Release/Hygiene | 🟡 tsconfig kaputt, Release-Modell unklar |
| Code-Stil/Struktur | 🟢 solide |

## Kern-Befund (empirisch belegt)

`CrdtManager.setContent` macht `text.delete(0, len); text.insert(0, content)` — also delete-all +
insert-all bei **jeder** Änderung. Zwei Y.Docs ohne geteilte Yjs-Historie, die denselben Ausgangstext
laden, erzeugen getrennte Insert-Historien. Yjs dedupliziert nur über Item-IDs, nicht über Volltext →
**Konkatenation statt Merge**:

```
A: setContent("Hallo Welt\n")   B: setContent("Hallo Welt\n")
merge(A,B)  ->  "Hallo Welt\nHallo Welt\n"   # kompletter Inhalt verdoppelt
```

Kontrolle mit geteilter Historie (B übernimmt A's State vor Edits) → keine Duplizierung. Bestätigt die
Ursache. Tracking: **Issue #10**. Das #9-Refactor (Subdocuments + SQLite) löst nur Skalierung, **nicht**
diese Korrektheit.

## Findings (30, nach adversarialer Verifikation; 1 verworfen)

| Sev | Verdict | ID | Kurz |
|---|---|---|---|
| CRIT | confirmed | readme-kernversprechen-widerlegt | README-Versprechen „keine Konflikt-Kopien" ist im Normalfall falsch |
| HIGH | partial | cold-start-self-duplication | loadAndMerge dupliziert beim Cold-Start mit der eigenen .yjs (selten erreichbar) |
| HIGH | partial | no-convergence-across-devices | Replikate konvergieren nicht zu gleichem Inhalt |
| HIGH | partial | zombie-resurrection-stale-yjs | Gelöschte+neu erstellte Note: stale .yjs lässt alten Inhalt auferstehen |
| HIGH | confirmed | weak-toContain-tests | Tests prüfen nur Substring (toContain), nicht Gleichheit/Konvergenz |
| HIGH | confirmed | shared-ydoc-unsynchronized | Geteilter Y.Doc von 3 Handlern ohne gemeinsame Serialisierung mutiert |
| HIGH | confirmed | shallow-obsidian-mock | jest.setup.js = 3 leere jest.fn() → main.ts/file-watcher.ts ungetestet |
| HIGH | confirmed | grenzen-sektion-verschweigt-dup | README-Grenzen nannten nur Same-Line, nicht die Voll-Duplizierung |
| MED | partial | snapshot-sweep-divergent-doc | Sweep überschreibt eigene .yjs mit historielosem Fresh-Doc |
| MED | unverified | startup-snapshot-vs-modify-race | Sweep läuft beim Start parallel zu modify-Events |
| MED | unverified | unloaded-flag-toctou | unloaded-Check in onRemoteYjsUpdate ist TOCTOU |
| MED | confirmed | isdesktoponly-unjustified | isDesktopOnly:true ohne Desktop-only-API |
| MED | unverified | createel-h2-statt-setheading | Settings-UI nutzt createEl('h2') statt setHeading() |
| MED | unverified | heading-name-inkonsistenz | Settings-Heading „CRDT Sync" ≠ Plugin-Name „Qollab" |
| MED | unverified | vault-modify-statt-process | vault.modify() statt empfohlenem Vault.process() |
| MED | unverified | layoutready-getmarkdownfiles-sweep | onLayoutReady startet vollen Markdown-Sweep |
| MED | partial | startup-sweep-blocks-all-files | Sweep sequenziell über ALLE .md mit read+encode+write |
| MED | partial | modify-no-debounce | modify-Handler schreibt bei jedem Event die ganze .yjs neu |
| MED | unverified | listyjsfiles-getfiles-on-merge | listYjsFiles ruft getFiles() bei jedem Merge (O(n)) |
| MED | confirmed | synchandler-test-bypasses-proxy | Tests prüfen nie die echte Proxy-listYjsFiles aus main.ts |
| MED | partial | filewatcher-regex-untested | QOLLAB_RE ungetestet, divergiert von listYjsFiles-Filter |
| MED | unverified | package-name-vs-plugin-id-drift | package.json „obsidian-crdt-sync" ≠ Plugin-id „qollab" |
| MED | unverified | three-way-version-drift | package 0.1.0 vs manifest 0.3.0 vs CHANGELOG 0.3.0 |
| MED | unverified | missing-obsidian-release-files | versions.json, LICENSE fehlen |
| MED | unverified | no-ci-no-release | Kein CI/Release-Workflow; package.json private:true |
| MED | partial | issue9-loest-anker1-nicht | #9 adressiert nur Datei-Explosion, nicht Duplizierung |
| MED | unverified | cursor-sync-v10-unrealistisch | Echtzeit-Cursor-Sync mit serverloser Architektur unvereinbar |
| LOW | partial | filewatcher-self-trigger | saveState schreibt .yjs, die der eigene Watcher matcht |
| LOW | unverified | orphan-nested-node-modules | stale 1MB obsidian-crdt-sync/main.js + Orphan-node_modules |
| LOW | unverified | plan-doc-statefilepath-veraltet | Alter Plan-Doc beschreibt Pfade ohne .qollab/-Prefix |

> „partial" = adversarialer Verifier hat abgeschwächt (real, aber seltener/enger als zuerst gemeldet).
> „unverified" = nur von einem Agenten gemeldet, nicht gegengeprüft (meist triviale, leicht prüfbare Fakten).

## Roadmap

### P0 — Schaden begrenzen (erledigt am 2026-05-28)
- [x] README-Top: unbedingte Zusage entfernt, `[!WARNING]`-Block ergänzt.
- [x] README-Grenzen: Voll-Duplizierung konkret beschrieben; Cursor-Sync entschärft.
- [x] Korrektheits-Bug von #9 getrennt → **Issue #10** angelegt.
- *Akzeptanz:* README ohne unbedingte Zusage; zwei getrennte Issues. ✅

### P0.5 — Rotes Regressions-Netz (vor dem Umbau)
- [ ] obsidian-Mock durch echte Stub-Klassen ersetzen (App/Plugin/Setting), damit main.ts importierbar wird.
- [ ] `listYjsFiles` aus dem Proxy in main.ts in eine testbare, exportierte Funktion ziehen.
- [ ] Drei `toBe`-Tests (nicht `toContain`): Zwei-Geräte-Erstmerge, A==B-Konvergenz, Idempotenz.
- [ ] `file-watcher.test.ts` für QOLLAB_RE.
- *Akzeptanz:* drei **rote** Tests, die die Duplizierung reproduzieren (= Akzeptanzkriterium für P1).

### P1 — Merge-Kern reparieren (der eigentliche Fix; nicht trivial)
- [ ] `setContent` (delete+insert) ersetzen durch positionsgenauen Diff in den geteilten `YText`
      (z.B. `diff-match-patch` → Y.Text-Delta). Keine Änderung, die nicht real passiert ist.
- [ ] Y.Doc-State (nicht der `.md`-Text) als Source-of-Truth persistieren; `.md` daraus rendern.
- [ ] Recreate-Tombstone gegen Zombie-Resurrection bei gelöscht+neu-erstellt (Doc-GUID).
- *Akzeptanz:* P0.5-Tests werden grün — kein verdoppelter Inhalt, A==B, Cold-Start == Original.

### P2 — Nebenläufigkeit
- [ ] Alle Y.Doc-Mutationen (modify-Handler, Sweep, onRemoteYjsUpdate) durch **eine** Queue.
- [ ] `vault.modify` → `vault.process` (atomares Read-Modify-Write).
- [ ] `unloaded` nach jedem `await` prüfen (TOCTOU).
- *Akzeptanz:* paralleles modify während Merge verliert kein Update.

### P3 — Hygiene / Release
- [ ] `tsconfig.json` `include` auf `obsidian-crdt-sync/**` fixen → funktionierender `tsc --noEmit`.
- [ ] Versions-Drift angleichen (package 0.1.0 vs manifest/CHANGELOG 0.3.0); package-Name + private-Flag.
- [ ] `versions.json` + `LICENSE` ergänzen; CI/Release-Workflow (GitHub Action) für main.js-Asset.
- [ ] Stale `obsidian-crdt-sync/main.js` + Orphan-node_modules löschen; `setHeading()` statt `h2`;
      `isDesktopOnly` entfernen; Settings-Heading auf „Qollab".

## Realismus

Single-Entwickler parallel zur Bachelorarbeit (bis 2026-07-27). Jetzt machbar: P0 (erledigt) + P0.5.
P1 ist ein fokussierter Rewrite-Block — eigene Sitzung, nicht nebenbei. P2/P3 danach.
