# CLAUDE.md — Qollab

## Zuerst lesen

**`.superpowers/sdd/folgeprompt-aktuell.md`** — der Übergabe-Prompt der letzten Session: Stand
(Commit, Testzahl), der offene Auftrag, die **Sperrliste** (was gemessen gefallen ist, mit Zahl und
Grund) und die Harness-Fallstricke. **Als Erstes lesen** — er verhindert, dass eine neue Session
Kandidaten durchprobiert, die schon mehrfach gefallen sind. Die Datei ist lokal und nicht
versioniert; ältere Stände liegen datiert daneben (`folgeprompt-<datum>.md`) und sind Historie.
Wer eine Session abschließt, **überschreibt sie** (siehe deren Schlussabschnitt).

**[docs/produktziel.md](docs/produktziel.md)** — Zweck, K.o.-Kriterien, wiederkehrende
Missverständnisse, offene Widersprüche. **Vor jeder inhaltlichen Aussage über das Projekt lesen.**
Der Zweck ist mehrfach falsch wiedergegeben worden; die Tabelle dort verhindert die bekannten
Fehler.

Der Satz in Kurzform: *Zwei oder mehr Menschen teilen einen Obsidian-Vault, bearbeiten dieselbe
Notiz, und niemand muss etwas tun, damit daraus eine korrekt zusammengeführte Notiz wird — ohne
dass jemand einen Server betreibt.*

## Wo was steht

| Was | Wo |
| --- | --- |
| **Ziel**, K.o.-Kriterien, Missverständnisse | `docs/produktziel.md` (versioniert) |
| **Ist-Zustand** mit Messzahlen, nutzerorientiert | `README.md` (englisch) |
| Messhistorie, Sessionberichte, Folgeprompts | `.superpowers/sdd/` (**lokal, nicht versioniert**) |
| Code | `obsidian-crdt-sync/src/` |
| Messinstrumente (Spikes) | `obsidian-crdt-sync/spike/` |
| Realtest-Harness | `C:\tmp\qollab-test\` |

## Harte Regeln

1. **Grundtext darf nie zerstört werden.** K.o.-Kriterium, keine Abwägung.
2. **Kein Dienst, den jemand betreiben muss.** Signalling als Datei über den gemeinsamen Speicher
   zählt als serverlos; ein Backend nicht.
3. **Realtest-Harness (`C:\tmp\qollab-test\`): `C:\Users\tillq\Obsidian_Vault` ist tabu.**
   `H-START-CDP` startet Obsidian ohne Vault-Argument und stellt alle `open:true`-Vaults aus
   `%APPDATA%\obsidian\obsidian.json` wieder her — so wurde der produktive Vault schon einmal
   unbeabsichtigt mitgeöffnet. Der Guard muss **vor** dem ersten `H-STOP` laufen (`H-STOP` killt
   jeden Obsidian-Prozess). **Niemals** den globalen `Local Storage\leveldb` löschen — dort liegen
   die Profile aller Vaults in einer Datenbank.
4. **Kein `Co-Authored-By`** in Commit-Messages.
5. **Merge nach `master` und Rollout brauchen Tills ausdrückliches Go.** Ein Formatwechsel der
   Hilfsdateien zwingt alle Geräte zum gleichzeitigen Update — ein halb aktualisierter Vault
   verliert Hilfsdateien.

## Arbeitsweise (teuer gelernt)

- **Jedes Agentenergebnis selbst nachmessen.** In einer Session hielten von 10 geprüften
  Vorschlägen 0.
- **Einzelfall-Tests geben hier systematisch das falsche Signal.** Belegt: ein Kandidat bestand
  5/5 Einzelfälle und fiel über 1152 Harness-Läufe mit 100 % Grundtext-Verlust. Wo es um Raten
  geht, über den Harness gehen.
- **Zu jeder Positiv-Prüfung eine Gegenprobe**, die belegt, dass das Instrument etwas sehen kann.
  Bisher waren **sechs** Messinstrumente nachweislich blind — zuletzt zwei in einer einzigen
  Session, davon eines beim Prüfer selbst.
- **Zahlen nur mit Zellbasis und Verfahren.** Wo keine Messung auffindbar ist: sagen, nicht
  weiterreichen. Eine früher zitierte Zahl („162/400") war eine unbelegte Ableitung.
- **Kürzungen der Zellbasis ausdrücklich nennen.** Stillschweigende Kürzung ist der schwerere
  Fehler.
- **Divergenz 0 ist kein Erfolgsmaß.** „Beide haben denselben Text" heißt nicht „nichts fehlt".
- **Spikes committen, nicht liegen lassen.** Ein Fuzzer ist auf genau diesem Weg schon verloren
  gegangen.

## Testen

Aus `obsidian-crdt-sync/`:

```bash
npx jest --no-cache --cacheDirectory <eigener-pfad> --testPathIgnorePatterns "node_modules" "worktrees"
npx tsc --noEmit
```

Spike-Läufe (720 Zustellordnungen je Zelle, rund 200 s; große Notiz rund 450 s):

```bash
SPIKE_SCHRANKE=<wert> SPIKE_DIFF=<wert> npx jest --config ../jest.spike.config.js --rootDir .. \
  -t "<testname>" --no-cache --cacheDirectory <eigener-pfad> \
  --testPathIgnorePatterns "node_modules" "worktrees"
```

**Fallstricke, real bezahlt:**

- **Eigenes `--cacheDirectory` je Lauf ist Pflicht.** Zwei parallele Läufe im selben Cache geben
  unter Windows EPERM — die Suite meldet dann eine rote Suite, die inhaltlich gar nicht rot ist.
- **Im Worktree** findet `--testPathIgnorePatterns worktrees` **null Tests**, weil der eigene Pfad
  das Muster matcht. Dort nur `--testPathIgnorePatterns "node_modules"`.
- **`--testPathIgnorePatterns "a" "b" <pfad>`** schluckt den Pfad als drittes Ignore-Muster.
  Dasselbe gilt für `--setupFilesAfterEnv <pfad> <testname>`.
- **`<rootDir>` ist das Repo-Root**, nicht `obsidian-crdt-sync/`.
- **Jest färbt die Ausgabe** — `grep -E "^Tests:"` matcht nie. `tail` nehmen oder `grep -a`.
- **`TaskStop` beendet nur die Shell, nicht `jest`** — der Prozess schreibt weiter in dieselbe
  Logdatei.

## Schalterstände

Beide Standards wurden am 2026-08-07 nach Messung umgestellt. Die alten Stände bleiben erhalten,
damit der Bestand nachmessbar ist — **ein Lauf ohne gesetzte Variablen misst den neuen Stand:**

| Variable | Standard | Bestand |
| --- | --- | --- |
| `QOLLAB_SWEEP_SCHRANKE` / `SPIKE_SCHRANKE` | `basis-signatur` | `aus` |
| `QOLLAB_DIFF_MODUS` / `SPIKE_DIFF` | **`zeile`** | `roh` |

**Korrektur 2026-08-12:** Hier stand `semantisch` als Standard. Der Code sagt `zeile`
(`src/crdt-manager.ts:276`, `?? 'zeile'`) — seit dem Fix vom 2026-08-10 (`82c5426`). Nachgemessen:
`QOLLAB_DIFF_MODUS=zeile` liefert auf der Zelle N=4/`kopie` zeichengleich `verdopp=845` wie ein Lauf
ohne gesetzte Variable. `semantisch` ist der Stand von 2026-08-07 bis 2026-08-09.
