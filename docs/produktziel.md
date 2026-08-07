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

## Offen und vorrangig: Grundtext-Verlust ab drei Geräten

Eine Messung vom 2026-08-07 (40 Seeds × 10 Notizen) zeigt für den **Ist-Zustand**:

| | N = 2 | N = 3 | N = 4 |
| --- | --- | --- | --- |
| zerstörter Grundtext | 0 | **6** | **22** |

Das verletzt K.o.-Kriterium 1 — und das Zielszenario lautet ausdrücklich „zwei **oder mehr**".

**Einschränkung, geprüft:** Der Produktivcode-Arm jener Messung ist ein Bundle von **vor dem
05.08.**; er enthält weder `basis-signatur` noch `semantisch` noch `QLB2` (null Treffer). Der
Befund gilt für den alten Stand. Ob er heute noch gilt, ist **nicht gemessen** — der semantische
Diff hat dieselbe Schadensklasse in der Zwei-Geräte-Messung von 296/720 auf 0 gebracht.

**Nächste Messung, mit Vorrang vor allem anderen:** Grundtext-Verlust bei N = 3 und N = 4 am
heutigen Stand.

## Woher die Verdopplung wirklich kommt

**Gemessen (`task-18-report.md`): Die Duplikate stammen zu 100 % aus der Materialisierung der per
Sync gelieferten `.md` als eigene Op** — nicht aus der Inkarnations-Identität.

Das erklärt rückblickend, warum **jeder** Kandidat wirkungslos blieb, der an der Kennung ansetzte:
deterministischer Genesis (8640 Läufe zahlengleich), `clientID` aus dem Texthash, Saat-Kennung
(Vorbedingung 0/720), Kandidat A (ändert real nur den Tie-Break-Schlüssel). Sie alle behandeln,
wer die Historie prägt — die Verdopplung entsteht aber eine Ebene tiefer, dort wo ein fremder Text
in den eigenen CRDT geschrieben wird.

Wer die Verdopplung angehen will, muss an dieser Stelle ansetzen, nicht an der Kennung.

## Quellen

- `README.md` — Ist-Zustand mit Messzahlen (nutzerorientiert)
- `manifest.json` — „Automatische Merge-Konfliktlösung via Yjs CRDTs für OneDrive/SharePoint-Sync."
- `docs/superpowers/plans/2026-05-19-github-collab.md` — GitHub als ursprüngliches Zielszenario
- `.superpowers/sdd/` — Messhistorie und Sessionberichte (lokal, nicht versioniert)
- Vault: `[[CRDT-Delete-vs-Edit-Semantik]]`, `[[Per-User-CRDT-State-Files-Pattern]]`
- Till, Sitzung 2026-08-07 — die Präzisierungen in diesem Dokument
