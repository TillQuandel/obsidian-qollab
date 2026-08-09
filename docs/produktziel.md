# Qollab — Produktziel

Was dieses Projekt erreichen will, woran sich jede Entscheidung messen lässt, und welche
Missverständnisse dabei wiederholt aufgetreten sind. **Single Source of Truth für den Zweck.**
Der Ist-Zustand steht im README (nutzerorientiert, englisch), die Messhistorie in `.superpowers/sdd/`
(lokal, nicht versioniert). Dieses Dokument beschreibt das **Ziel** — es ist keine Zustandsbeschreibung.

## Der Satz

> **Zwei oder mehr Menschen teilen einen Obsidian-Vault. Sie bearbeiten dieselbe Notiz. Niemand
> muss etwas tun, damit daraus eine korrekt zusammengeführte Notiz wird — und niemand muss einen
> Server dafür betreiben.**

## Was das im Einzelnen heißt

### Qollab ist der Sync-Dienst

Aus Nutzersicht ist Qollab das, was den geteilten Vault zusammenhält. Es ist **kein Zusatz zu**
einem Sync-Dienst und kein Reparaturwerkzeug hinterher.

**Serverlos heißt: niemand betreibt einen Dienst.** Kein Backend, kein Konto, keine Registrierung,
keine laufenden Kosten. Der Transport ist vorhandene Infrastruktur, die die Beteiligten ohnehin
haben.

**Transport ist austauschbar.** Datei-Sync (OneDrive, SharePoint, Dropbox, iCloud, Syncthing) und
**GitHub** sind beide Zielszenarien — GitHub von Anfang an: die Per-Client-Hilfsdateien
(`<notiz>.<geräte-id>.yjs`) existieren genau deshalb, weil so **kein Git-Konflikt entstehen kann**,
wenn jeder nur seine eigene Datei schreibt (`docs/superpowers/plans/2026-05-19-github-collab.md`).
Ein direkter Geräte-zu-Geräte-Kanal ist nicht ausgeschlossen, solange kein Dienst dafür läuft;
Signalling als Datei über den gemeinsamen Speicher zählt ausdrücklich als serverlos.

### Die Konfliktkopie soll gar nicht erst entstehen

Nicht „Konfliktkopien auflösen", nicht „beim Zusammenführen helfen". Das Artefakt
`Meeting notes (DESKTOP-A1B2C3's conflicted copy).md` soll **nicht entstehen**.

Dass der README heute empfiehlt, den Konfliktkopie-Schutz des Anbieters anzulassen, ist eine
**Krücke für den experimentellen Stand** — ein Sicherheitsnetz, solange das Ziel nicht erreicht
ist. Es ist kein Bestandteil des Produkts und darf nicht als solcher beschrieben werden.

### Zwei oder mehr

Nicht zwei Geräte, nicht zwei Personen. **Mehrere Menschen, mehrere Geräte** ist das Zielszenario.
Ein Verfahren, das nur bei genau zwei Beteiligten trägt, löst die Aufgabe nicht.

Praktische Folge: Wenn eine Regel erst ab drei Geräten wirkt, ist sie deshalb **nicht** nachrangig.
Sie ist im Zielszenario relevant, auch wenn der aktuelle Hauptnutzer heute zu zweit arbeitet.

### Yjs ist die aktuelle Mechanik, nicht das Ziel

CRDTs sind das Mittel, mit dem heute gearbeitet wird. **Trägt Yjs das Ziel nicht, wird weiter
gesucht** — andere CRDT-Bibliotheken, andere Ansätze, anderer Transport. Kein Befund darf mit
„aber Yjs macht das so" abgeschlossen werden; das ist eine Beschreibung des Ist-Zustands, keine
Begründung.

### Mobile ist aufgeschoben, nicht gestrichen

`isDesktopOnly: true` ist eine Zwischenlösung. Der Grund ist der Sidecar-**Lesepfad**
(`getBasePath` nur am `FileSystemAdapter`) — nicht die Herkunftserkennung. Mobile bleibt Ziel.

## Woran „korrekt zusammengeführt" gemessen wird

Sechs Gruppen. Jede Entscheidung sollte sich einer davon zuordnen lassen.

### 1. Korrektheit des Ergebnisses

- Eingefügter Text überlebt auf allen Seiten
- **Gelöschter Text bleibt gelöscht** — mit der Einschränkung unten (Add-wins)
- Nichts wird verdoppelt
- Alle Beteiligten enden mit demselben Text (Konvergenz)
- Der Text bleibt strukturell heil — Zeilen dürfen nicht zerrissen werden
- Ganze Notizen: Umbenennen, Verschieben, Löschen, Wiederherstellen
- Nicht-Text: Anhänge, Bilder, Canvas, Bases

### 2. Nichts tun im Betrieb

- Kein Server, kein Konto, keine Registrierung
- Keine Konfiguration pro Notiz
- **Ein Update darf keine Daten kosten** und keine koordinierte Aktion aller Beteiligten erzwingen
- Kein Aufräumen von Hand (Hilfsdateien, Speicher)

### 3. Nichts am eigenen Verhalten ändern

- Alle dürfen gleichzeitig **offline** arbeiten — Asynchronität ist der Kern, nicht ein Zusatz
- Die App darf **zu** sein, während Änderungen eintreffen
- Keine Reihenfolge einhalten, nicht aufeinander warten
- Andere Werkzeuge dürfen mitspielen: anderer Editor, Skript, `git checkout`, zurückgespieltes Backup
- **Der Konfliktkopie-Schutz des Anbieters darf nicht nötig sein**

### 4. Robustheit

- Absturz, leerer Akku, Kill mitten im Schreiben
- Beschädigte Dateien (Nullfüllung, abgeschnittene Schreibvorgänge)
- Zwei oder mehr Beteiligte
- Große Vaults, lange Ausfälle

### 5. Sichtbarkeit statt Stille

**Stiller Verlust ist schlimmer als sichtbarer.** Wenn ein Fall nicht sauber lösbar ist, muss er
sichtbar werden und der Text muss irgendwo erhalten bleiben — nicht kommentarlos verschwinden.

### 6. Plattform

- Desktop: läuft
- Mobile: aufgeschoben, nicht gestrichen
- Transport: Datei-Sync **und** GitHub

## K.o.-Kriterien

Verletzt eine Änderung eines davon, ist sie gefallen — unabhängig davon, wie gut die übrigen
Zahlen aussehen.

1. **Grundtext darf nie zerstört werden.**
2. **Kein Dienst, den jemand betreiben muss.**
3. **Keine Handarbeit beim Endnutzer**, damit die Zusammenführung stimmt.

## Wiederkehrende Missverständnisse

Diese Fehler sind real aufgetreten — teils mehrfach, teils von mir selbst. Sie stehen hier, damit
sie nicht wiederkehren.

| Missverständnis | Richtig |
| --- | --- |
| „Qollab ist kein Sync-Dienst, der Transport bleibt OneDrive" | Qollab **ist** der Sync-Dienst. Serverlos heißt „niemand betreibt einen Dienst", nicht „es ist keiner". |
| „Es löst Konfliktkopien auf" | Sie sollen **gar nicht entstehen**. |
| „Konfliktkopie-Schutz anlassen" ist Teil des Produkts | Krücke für den experimentellen Stand. |
| „Der Vault wird zu zweit genutzt, also ist der Drei-Geräte-Fall nachrangig" | Zielszenario ist **zwei oder mehr**. Aktuelle Nutzung ≠ Produktscope. |
| „Mobile wird nicht unterstützt" | Aufgeschoben, nicht gestrichen. |
| „GitHub als Transport wäre eine neue Idee" | Die Per-Client-Dateien wurden **genau dafür** gebaut. |
| „Yjs macht das so, also ist der Fall zu" | Yjs ist Mechanik. Trägt sie nicht, wird weiter gesucht. |
| „Divergenz 0, also ist alles gut" | „Beide haben denselben Text" ≠ „nichts fehlt". Beide können übereinstimmend etwas verloren haben. |

## Offene Widersprüche in der Aktenlage

**Diese Punkte sind nicht entschieden. Wer hier weiterarbeitet, muss sie auflösen statt eine Seite
zu übernehmen.**

1. ~~**Kausale Schranke bei Löschungen.**~~ **Aufgelöst am 2026-08-07.** Die Vault-Note war um
   zwölf Stunden veraltet (geschrieben 11:23, Messung 23:56), der Folgeprompt hatte recht.
   `Y.encodeStateVectorFromUpdate` trägt die Schranke **nicht** — und zwar strukturell, nicht
   ratenbedingt: Eine Löschung erzeugt in Yjs keinen Struct und hebt keine clock, sie steht
   ausschließlich im DeleteSet. Selbst nachgemessen: Update wächst (38 → 54 Byte), State-Vector
   bleibt byteidentisch. Die Vault-Note ist korrigiert.

   **Was daraus folgt, ist wichtiger als der aufgelöste Widerspruch:** Ohne gemeinsame Historie
   ist eine kausale Schranke **jeder** Bauart uninformativ (Spike `zzPRF-sv-blind`, PRF5) — im
   SV-Teil wie im DeleteSet-Teil. Da genau die Zellen ohne gemeinsame Historie 53–83 %
   Wiederbelebung tragen, heißt das: **Der Erstkontakt muss vor der Löschsemantik gelöst sein**,
   nicht danach.
2. ~~**Wie viel der 47,4 % ist überhaupt ein Fehler?**~~ **Beantwortet am 2026-08-07: über 99 %
   sind kein Fehler.** Gemessen über 65 Zellen à 720 Zustellordnungen (46.800 Läufe), Kausalität
   über den Yjs-Zustandsvektor statt über den Text: Von rund 19.874 Wiederbelebungen sind **24
   fehlerhaft (0,12 %)**; von 6.960 kausal nachgelagerten Löschungen werden **24 wiederbelebt
   (0,34 %)**. Ab dem dritten Zustellereignis gilt exakt `Wiederbelebungen = 720 − kausal
   nachgelagerte` — **jede kausal nachgelagerte Löschung hält, jede nebenläufige wird
   wiederbelebt.** Genau das schreibt Add-wins vor.

   **Der Grund ist strukturell:** Eine Wiederbelebung setzt voraus, dass die gelöschte Zeile beim
   Peer als *anderes Item* existiert — das gibt es nur ohne gemeinsame Inkarnation. Ohne
   gemeinsame Inkarnation gibt es aber auch keine Kausalität, gegen die man prüfen könnte. Zwei
   unabhängige Wege sagen damit dasselbe wie Punkt 1: **Der Hebel ist der Erstkontakt, nicht die
   Delete-Semantik.**

   **Die 24 echten Fälle bleiben ein Bug** mit klarer Adresse: `unionMerge` in `tickParked`
   (`src/sync-handler.ts:514`). Vereinigen kann nichts löschen.

   **Der produktive Stand erkauft weniger Verlust mit mehr sichtbarer Wiederbelebung.** Gemessen
   in der Lage `laufend-loeschung`, Zelle `geteilt`, je 720 Ordnungen, zweimal reproduziert:

   | Löschzeitpunkt | `roh/aus` | `semantisch/basis-signatur` |
   | --- | --- | --- |
   | nach 0 | 28 wieder, **0** fehlerhaft | **54** wieder, **0** fehlerhaft |
   | nach 2 | 16 wieder, **6** fehlerhaft | **36** wieder, **6** fehlerhaft |
   | nach 3 | **0** wieder | **14** wieder, **0** fehlerhaft |

   **Jede zusätzliche Wiederbelebung ist legitim** (kausal nebenläufig), die Zahl echter Fehler
   ist in jeder Zeile identisch. Der Stand verschlechtert also nichts an der Korrektheit — er
   behält mehr Text, den ein CRDT nach Standard behalten soll, und tauscht dafür stillen Verlust
   (240 → 60). Nach Gruppe 5 („Sichtbarkeit statt Stille") ist das der richtige Tausch.
   **Trotzdem gilt:** Für den Nutzer sieht eine legitime Wiederbelebung genauso aus wie ein
   Fehler. Nach dem Adoptionskriterium ist der Preis mit diesem Stand höher als vorher.

   **Zwei Einschränkungen, ausdrücklich:** Die 47,4 % selbst wurden dabei **nicht** reproduziert —
   sie stammen aus einem Apparat auf `mess/verdopplung` mit anderer Zellbasis. Und die 0,12 % sind
   eine Zusammenfassung der Messmatrix, keine Feldrate: Beschränkt man sich auf Zellen mit
   geteilter Historie, liegt die Fehlerquote unter den Wiederbelebungen bei **37,5 %**. „Das
   Problem ist klein" gilt für die Rate, nicht für die Schwere im Einzelfall.
3. **`isFileProcessing` bei obsidian-livesync.** Als Vorbild zitiert, laut
   `.superpowers/sdd/recherche-herkunft-2026-08-04-b.md` existiert die Funktion dort nicht.
   Ungeklärt.

4. **Git/GitHub als Transport vs. „keine Registrierung" — Zielkonflikt in diesem Dokument.**
   Oben steht beides: GitHub ist ausdrücklich Zielszenario, und „kein Konto, keine Registrierung"
   ist Teil von „niemand betreibt einen Dienst". Ein GitHub-Konto ist kein *betriebener Dienst*,
   aber es ist eine Registrierung. **Das ist nicht entschieden**, und es entscheidet mit, welche
   Commit-Variante überhaupt zulässig ist (Plugin bringt Git mit → braucht Token; fremdes
   Git-Plugin → Handarbeit bei der Einrichtung).

5. **Die Konfliktfreiheit unter Git gilt nur für die Hilfsdateien, nicht für die Notiz.** Oben
   steht, die Per-Geräte-Dateinamen sorgten dafür, dass „Git nie einen Konflikt sieht". Das
   stimmt für `.yjs` — die `.md` schreiben aber **beide** Seiten. Der Plan von 2026-05-19
   behandelt nur die Hilfsdateien; die Notiz-Hälfte ist nie spezifiziert worden. Die Formulierung
   oben ist damit breiter, als die Konstruktion trägt.

   **Was heute passieren würde** (aus dem Kontrollfluss gelesen, **nicht gemessen**): Eine `.md`
   mit Git-Konfliktmarkern trägt keinen Lock und stammt nicht aus diesem Prozess → sie wird
   geparkt → später vereinigt → die Markerzeilen stehen als gewöhnlicher Text im CRDT und wandern
   über die eigene Hilfsdatei zu **allen** Peers. Und `unionMerge` kann sie nicht wieder
   entfernen. Qollab würde einen Git-Konflikt also nicht auflösen, sondern **verteilen**.
   Erkennung, Test und Doku dazu: null Treffer im gesamten Repo.

## Grundtext-Verlust ab vier Geräten — der Drei-Geräte-Befund ist gefallen

**Revidiert am 2026-08-09 (`grundtext-n-2026-08-09.md`). Der frühere Satz „K.o.-Kriterium 1 wird ab
drei Geräten verletzt" war zum großen Teil ein Artefakt des Messapparats und ist zurückgenommen.
Ab vier Geräten hält der Befund — in schwächerer Form.**

Strenger Grundtext-Verlust (eine Zeile des Ausgangstextes fehlt am Ende), Zellbasis je Lauf
40 Seeds × 10 Notizen × 8 Basiszeilen = 3.200 Zeilen, Mittelwert (Spanne):

| Apparat-Stand | N = 2 | N = 3 | N = 4 |
| --- | --- | --- | --- |
| Bundle vor dem 05.08. (n = 15) | 0 (0–0) | 7,1 (3–16) | 27,7 (11–37) |
| heute, ohne `noteLocalDiffBase` (n = 13) | 0 (0–0) | 4,6 (2–9) | 19,7 (9–30) |
| heute, mit `noteLocalDiffBase` (n = 3/6/5) | 0 (0–0) | 2,0 (1–3) | 8,0 (3–11) |
| **heute, mit Herkunftstor** (n = 3/5/5) | **0 (0–0)** | **0 (0–0)** | **1,2 (1–2)** |

**Maßgeblich ist die letzte Zeile.** Jede darüber ist mit einem Apparat gemessen, der etwas tat,
was das Plugin nicht tut:

1. Er rief nach seinen Write-Backs kein `noteLocalDiffBase` (`main.ts:995`/`:1488`) und arbeitete
   deshalb mit veralteter Diff-Basis.
2. **Gravierender:** Er hatte kein Herkunftstor (`main.ts:329-335`) und verarbeitete eine per Sync
   gelieferte `.md` als **eigenen Edit**. Genau dieser Pfad — `applyLocalContent` → `setContent`
   (`sync-handler.ts:1703`) — war der, auf dem die Schadensklasse nachgewiesen wurde. Das echte
   Plugin **parkt** eine Fremddatei dort, statt sie zu diffen.

Mit geschlossenem Tor fällt der Verlust bei N = 3 auf **null in fünf von fünf Läufen**, bei N = 4
auf 1,2 von 3.200 Zeilen. Verlust, Verdopplung und Konfliktkopien fallen in **jeder** Spalte mit
(N = 3: Verdopplung 440 → 58) — der Gewinn ist nirgends erkauft. Bei **N = 2 ist der Lauf jetzt
vollständig sauber**: 40/40 Seeds ohne jeden Befund, Verdopplung 0.

**Dass das Tor nicht einfach alles wegparkt, ist belegt:** 10 Seeds × 3 Geräte × 10 Notizen × 1
Edit = 300 Tastendrücke; `torEigen` = 302, `applyLocalContent` = 303 (= 302 + 1 Nachtrag aus
`tickParked`), und am Ende jedes Laufs ist nichts mehr geparkt.

### Was ab vier Geräten übrig bleibt

Eine **dritte** Untervariante, die mit den beiden bisher beschriebenen nichts zu tun hat: Die Zeile
wird nicht gelöscht, sondern **zerschnitten** — `n5-base-1` wird zu `n5-basebasebase-1`, durch
nebenläufige Zeichen-**Einfügungen**, ohne jede DELETE-Op. Der Satz der Schadensklasse („die Notiz
wird zeilenweise gedacht, aber zeichenweise bearbeitet") hält also; seine beiden gemessenen
Untervarianten (verschobener Fuzzy-Hunk, Delete-Op über die Zeilengrenze) verschwinden mit dem Tor.

Der Verlust **wandert nicht** nach `tickParked`, wie vermutet: Von 191 `tickParked`-Läufen bei
N = 3 enden nur 4 im `unionMerge`-Nachtrag, und davon **0** mit toter Grundtextzeile. Die 24
Fälle aus der Aktenlage sind damit erstmals messbar — und dabei nicht aufgetreten. Weder bestätigt
noch für alle Lagen entkräftet.

### Ein Produktivcode-Befund am Rand

`flushParked` (`src/sync-handler.ts:424`) hat **repoweit keinen Aufrufer** — nachgeprüft, es gibt
nur die Definition. Sein eigener Kommentar verspricht, beim Abschalten des Plugins jeden geparkten
Stand nachzutragen; `onunload` (`main.ts:1623-1631`) ruft ihn nicht. Wer das Plugin abschaltet,
während etwas geparkt ist, hat einen unbelegten Pfad vor sich.

**Was dieser Apparat NICHT misst — für jede Zahl daraus mitzulesen:**

- **`QOLLAB_SWEEP_SCHRANKE` ist wirkungslos.** Nachgemessen (N = 3, DET = 42): `basis-signatur`
  und `aus` liefern **byteidentische** Zeilen, während `QOLLAB_DIFF_MODUS=roh` sehr wohl wirkt
  (0 → 5). Der Apparat modelliert keinen Neustart, also gibt es keinen Sweep
  (`mergeForLocalDiff(imSweep=true)` = 0). **Von den beiden am 2026-08-07 umgestellten Standards
  ist nur `diffModus = 'semantisch'` je gemessen worden.**
- ~~Das Herkunftstor fehlt.~~ **Geschlossen am 2026-08-09** — mit der echten `WriteProvenance`,
  nicht mit einem Nachbau. Die Folgen stehen oben; sie sind der Grund für die Revision.
- **Die Sicherungskopie wird nicht verteilt.** `onSaveCopy` schreibt sie, aber der Transport gibt
  sie nicht an die Peers — im Plugin käme sie dort als fremde `.md` an und würde selbst geparkt.
  Eigenes Szenario, ungemessen (1 Vorkommnis je 10 Seeds bei N = 3).
- **Nur `mdModus: 'kopie'`.** Der härtere `'ueberschreiben'`-Modus ist ungemessen — dort wäre das
  Tor mutmaßlich noch entscheidender.

**Zum Instrument, für jede künftige Zahl daraus:** `bilanz-n.mjs` ist **nicht reproduzierbar** —
derselbe Aufruf gibt bei jedem Start eine andere Zahl (dreimal hintereinander, Bestand, N = 3:
9, 8, 8). Der Apparat selbst enthält keinen Zufall; der gemessene Produktivcode hat zwei Quellen:
`generateGuid` (`crypto.getRandomValues`) und die pro `Y.Doc` zufällige Yjs-`clientID`. Die früher
zitierten Einzelwerte **6 und 22** sind damit Einzelziehungen ohne Streuungsangabe; beide liegen
innerhalb der oben gemessenen Bestandsspanne, tragen als Messwerte aber nicht. Zahlen aus diesem
Instrument brauchen Wiederholungen und eine Spanne.

### Die Schadensklasse, benannt (2026-08-09)

> **Nachtrag desselben Tages:** Der *Satz* dieser Schadensklasse hält, die beiden unten belegten
> **Untervarianten A und B verschwinden aber, sobald das Herkunftstor geschlossen ist** (siehe
> oben). Beide setzen voraus, dass eine fremde `.md` als eigener Edit gedifft wird — und das tut
> das Plugin nicht. Was ab vier Geräten übrig bleibt, ist eine dritte Variante ohne DELETE-Op.
> Der folgende Abschnitt bleibt stehen, weil der Mechanismus korrekt beschrieben und der
> `threeWayMerge`-Fehler **ohne Harness** reproduzierbar ist — er ist ein echter Fehler in
> `text-merge.ts`, unabhängig davon, wie oft er im Betrieb ausgelöst wird.

**Die Notiz wird zeilenweise gedacht, aber zeichenweise bearbeitet.** Beide Stellen, an denen
Qollab Text in Operationen umrechnet, arbeiten auf Zeichenebene und richten sich nicht an
Zeilengrenzen aus: `threeWayMerge` (diff-match-patch `patch_apply`, **fuzzy**) und
`CrdtManager.setContent` (`diff_main`). Sobald zwei benachbarte Zeilen ein gemeinsames Präfix
teilen, legt der Zeichen-Diff seine Op **über die Zeilengrenze**. In der Messung ist das Präfix
`n1-`; **in echten Notizen ist es jede Aufzählung, jede Überschriftenfolge, jede Checkbox-Liste.**

Zwei Untervarianten, beide belegt: **(A)** `match_main` verschiebt einen Zeichen-Hunk eine Zeile
tiefer und löscht dort vier Zeichen aus einer unberührten Zeile. **(B)** Die DELETE-Op endet mitten
in der Zeile; die Zeile verliert ihre Yjs-Item-Identität und wird von einer nebenläufigen
Einfügung zerrissen (`n2-n2-D1-7|base-6`).

**Geburtsort der Lösch-Op: `src/sync-handler.ts:1703`** (`crdtManager.setContent`). 6/6 bei N=3 und
24/24 bei N=4 der geborenen Grundtext-Lösch-Ops laufen über diese eine Zeile; die beiden anderen
`setContent`-Aufrufstellen tragen null. Beteiligt sind ferner `src/text-merge.ts:88` (A) und
`src/crdt-manager.ts:264/291` (B).

**Warum erst ab drei Geräten:** Die Bedingung ist nicht die Gerätezahl, sondern eine **DELETE-Op in
`setContent`**. Über 40 Seeds: N=2 → 5 von 1946 Aufrufen (0,3 %), N=3 → 416 von 4147 (10,0 %),
N=4 → 1163 von 6813 (17,1 %). Mit **einem** Peer ist die Differenz `.md` gegen Doc einseitig, der
Merge ist reines Einfügen. Mit **zwei** Peers kann die `.md` gleichzeitig voraus und zurück sein —
der Merge wird zur **Ersetzung**, und die Ersetzung ist zeichenweise.

**Gegenprobe:** `match_main` auf exakte Suche zurückgeschnitten → geborene Grundtext-Lösch-Ops
6 → 0 bei N=3. Der Endstand sinkt nur 6 → 5 (Untervariante B ist unberührt, und der Eingriff
verschiebt die Ablaufbahn). **Das ist kein Fix.**

**Ausgeschlossen:** `unite`/`unionMerge` (`sync-handler.ts:601`) — 1514 Aufrufe, **0** mit toter
Grundtextzeile. **Ausdrücklich NICHT geprüft:** `unionMerge` in `tickParked`
(`sync-handler.ts:514`) wird im Messapparat 0-mal aufgerufen; die 24 bekannten Fälle dort sind
weder bestätigt noch entkräftet.

**Was der Fix von 2026-08-07 geleistet hat und was nicht:** `diffModus = 'semantisch'` glättet den
Diff und hat die Zwei-Geräte-Variante beseitigt (N = 2 bleibt bei null), **erzwingt aber keine
Zeilentreue**. Genau daran hängt der Rest.

**Nächster Schritt:** die Umrechnung Text → Ops an Zeilengrenzen ausrichten. Vorher ist eine
Fidelitätslücke des Messapparats zu schließen — er ruft nach seinen Write-Backs kein
`noteLocalDiffBase`, anders als `main.ts:995`/`1488`. Sie trägt den Befund nicht, verzerrt aber
jeden Vergleich, den man gegen einen Fix stellt.

## Woher die Verdopplung wirklich kommt

**Gemessen (`task-18-report.md`): Die Duplikate stammen zu 100 % aus der Materialisierung der per
Sync gelieferten `.md` als eigene Op** — nicht aus der Inkarnations-Identität. Wer die Verdopplung
angehen will, muss dort ansetzen, nicht an der Kennung.

Das erklärt, warum jeder Kandidat wirkungslos blieb, der an der Kennung ansetzte. **Die
vollständige Kandidatenlage mit Instrumenten, Zellbasen und Zahlen steht in der Vault-Note
`[[CRDT-Erstkontakt-ohne-gemeinsame-Historie]]`** — dort ist die Single Source of Truth für den
Erstkontakt. Dieses Dokument führt nur, was für die Produktentscheidung nötig ist.

## Quellen

- `README.md` — Ist-Zustand mit Messzahlen (nutzerorientiert)
- `manifest.json` — „Automatische Merge-Konfliktlösung via Yjs CRDTs für OneDrive/SharePoint-Sync."
- `docs/superpowers/plans/2026-05-19-github-collab.md` — GitHub als ursprüngliches Zielszenario
- `.superpowers/sdd/` — Messhistorie und Sessionberichte (lokal, nicht versioniert)
- Vault: `[[CRDT-Delete-vs-Edit-Semantik]]`, `[[Per-User-CRDT-State-Files-Pattern]]`
- Till, Sitzung 2026-08-07 — die Präzisierungen in diesem Dokument
