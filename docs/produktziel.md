# Qollab — Produktziel

Was dieses Projekt erreichen will, woran sich jede Entscheidung messen lässt, und welche
Missverständnisse dabei wiederholt aufgetreten sind. **Single Source of Truth für den Zweck.**
Der Ist-Zustand steht im README (nutzerorientiert, englisch), die Messhistorie im privaten Repo
`obsidian-qollab-doku/sdd/`. Dieses Dokument beschreibt das **Ziel** — es ist keine Zustandsbeschreibung.

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
   `obsidian-qollab-doku/sdd/recherche-herkunft-2026-08-04-b.md` existiert die Funktion dort nicht.
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

   **Was heute passiert — am 2026-08-12 gemessen** (`spike/konfliktmarker/`, harness-frei gegen die
   echten Funktionen; vorher stand hier „aus dem Kontrollfluss gelesen, **nicht gemessen**"): Eine
   `.md` mit Git-Konfliktmarkern trägt keinen Lock und stammt nicht aus diesem Prozess → sie wird
   geparkt → später vereinigt → die Markerzeilen stehen als gewöhnlicher Text im CRDT und wandern
   über die eigene Hilfsdatei zu **allen** Peers. **Qollab löst einen Git-Konflikt nicht auf,
   sondern verteilt ihn — bestätigt.** Erkennung, Test und Doku: weiterhin null Treffer in `src/`
   und `tests/` (die `conflict`-Treffer dort meinen durchweg Sync-Konfliktkopien, nicht Git-Marker).

   **Zwei Präzisierungen, die die frühere Fassung nicht hatte:**

   - **`unionMerge` bekommt sie nicht weg, `threeWayMerge` schon.** Räumt ein Gerät die Marker von
     Hand auf und trifft auf einen Peer, der die Markerfassung noch trägt, liefert `unionMerge`
     alle drei Markerzeilen zurück (gemessen 3/3, 82 → 144 Zeichen) — das Aufräumen ist per Union
     nicht durchsetzbar. `threeWayMerge` entfernt sie vollständig (0/3), weil an der Basis die
     Löschung als Hunk ablesbar ist; `unionMerge` hat keine Basis und kann per Konstruktion nichts
     löschen. **Entscheidend ist deshalb, welcher Weg im Produkt läuft — und der Parkplatz löst
     über `unionMerge` auf** (`sync-handler.ts:514`, `unionMerge(p.text, doc)`), also über den Weg,
     der die Marker festhält.
   - **Sie wachsen nicht.** Über sechs Wiederholungsreihen ist jede ab Runde 1 längenstabil; der
     einzige Sprung ist der erste Merge. Die Nicht-Idempotenz trifft diesen Fall nicht.

## Grundtext-Verlust ab drei und vier Geräten — behoben **in der gemessenen Lage**

**Stand 2026-08-10: null bei N ≤ 4 und normalen Notizgrößen — darüber hinaus nicht.** Der Weg
dorthin ging über zwei Apparat-Korrekturen und zwei Fixes am Produktivcode; die Zwischenstände
stehen unten, weil sie zeigen, wie viel davon Messartefakt war.

| Grundtext-Verlust je 3.200 Zeilen | N = 2 | N = 3 | N = 4 |
| --- | --- | --- | --- |
| Ausgangsbefund (2026-08-07) | 0 | 6 | 22 |
| **heute** | **0** | **0** | **0** |

Zwei Drittel des Befunds waren **Artefakte des Messapparats** (fehlendes `noteLocalDiffBase`,
fehlendes Herkunftstor — Details unten). Der verbliebene Rest ab vier Geräten war ein **echter
Fehler** und ist mit `diffModus = 'zeile'` behoben (`src/crdt-manager.ts`, Commit `82c5426`):
`WEG` fällt in allen drei gemessenen Seed-Familien auf 0, bei byte-identischen Nebenzählern.

**Der Preis, ausdrücklich:** Verdopplung +1,0 bis +1,7 %. Nach Gruppe 5 die richtige Richtung
(sichtbar statt still) — für den Nutzer sieht eine doppelte Zeile aber wie ein Fehler aus.

### Wo der Fix NICHT trägt (gemessen 2026-08-10)

> [!warning] Überholt seit `T-04` — nachgemessen am 2026-08-14
> **Die drei Achsen unten tragen inzwischen.** Die Tabelle beschreibt den Stand vor dem
> zeilenweisen 3-Wege-Merge (`T-04`, 2026-08-11) und blieb danach ohne Nachtrag stehen. `T-04`
> behauptete in der Registratur zwar, sie zu erledigen — belegt war das nie mit eigenen Zahlen.
> Jetzt ist es gemessen (`spike/schnitt/t04-achsen.mjs`, **200 Seeds je Zelle**, acht Zellen):
>
> | Grundtextverlust `WEG` | heutiger Stand | Stand vor `T-05` |
> | --- | --- | --- |
> | N = 5 / 6 / 8 | **0 / 0 / 0** | 0 / 11 / 18 |
> | 200 und 1.000 Zeilen, N = 4 | **0 / 0** | 0 / 0 |
> | `mdModus: 'ueberschreiben'`, N = 4 | **0** | 4 |
> | **Summe über alle acht Zellen** | **0** | **36** |
>
> Die Gegenprobe läuft fest im Instrument mit: Es startet sich selbst mit
> `QOLLAB_DIFF_MODUS=semantisch` und meldet „BLIND", wenn auch die alte Fassung nichts zeigt —
> ein Nullbefund ohne diesen Vergleich wäre von „der Apparat erzeugt die Lage nicht" nicht zu
> unterscheiden.
>
> **Was das nicht heißt:** Die Verdopplung bleibt und wächst mit N (839 → 4.581 über N = 4 … 8),
> und die Quote vollständig sauberer Läufe fällt von 198/200 bei N = 2 auf **0/200 bei N = 8**.
> Grundtext hält — „sauber" ist etwas anderes.

Die Tabelle oben gilt für die Lage, in der sie gemessen wurde: **bis vier Geräte, 8 Basiszeilen,
`mdModus: 'kopie'`.** Über fünf Achsen nachgemessen (je 200 Läufe, mehrere Zufallsfamilien):

| Achse | `WEG = 0`? | Anmerkung |
| --- | --- | --- |
| N = 5, 6, 8 | **nein** — Verlust in allen 8 Zellen | Verdopplung +1,9 bis +4,7 %, steigend mit N |
| große Notizen (200/1.000 Zeilen) | **nein** — Fix dort **wirkungslos** | beide Arme byte-identisch |
| `mdModus: 'ueberschreiben'` | **nein** bei N = 4 | Verdopplung *sinkt* dort (−3,8 %) |
| Laufzeit | — | ab 16 Zeilen teurer, bei 5.000 Zeilen `setContent` 0,44 → 16 ms |
| `.yjs`-Größen und Op-Zahlen | — | **kein** Aufschlag, sogar −0,3 bis −1,7 % |

**Der Rest-Verlust über alle Achsen hat eine einzige Adresse — und es ist nicht die gefixte.** Er
entsteht **vor** `setContent`, im Rückgabewert von `mergeForLocalDiff`: der Fuzzy-`patch_apply` in
`threeWayMerge` (`src/text-merge.ts:88`, über `match_main`). Das ist Untervariante A, die weiter
unten als „mit dem Herkunftstor verschwunden" beschrieben ist — **sie verschwindet nur bei N ≤ 4
und 8 Basiszeilen.** Gegenprobe mit exakter statt unscharfer Suche, in vier Regimen: Verlust
2/1/3/1 → **0/0/0/0**.

`diffModus = 'zeile'` sitzt in `setContent` und damit **strukturell hinter** dieser Schadensstelle.
Er kann sie nicht erreichen.

### Der Preis der exakten Suche — gemessen 2026-08-11

**Die Gegenprobe oben führt nur die Grundtext-Spalte. Mit allen Spalten ist sie ein schlechter
Tausch.** Acht Zellen à 200 Seeds × 10 Notizen, Summen
(Bericht `patch-apply-2026-08-11.md` **beim Rechnerwechsel verloren**, s. u.; die Rohdaten liegen
versioniert unter `obsidian-crdt-sync/spike/schnitt/ergebnis-patch-*.txt` — die Zahlen sind also
nachrechenbar, die Herleitung im Bericht nicht mehr nachlesbar):

| Variante | Grundtext `WEG` | `verlust` | `verdopp` | `div` |
| --- | --- | --- | --- | --- |
| Bestand | **23** | 1.679 | 10.672 | 2 |
| exakte Suche (`kein-fuzz`) | 0 | **2.274** (+35,4 %) | 9.696 | 2 |
| **Verwurf melden + dedup** | **0** | **1.501** (−10,6 %) | 11.761 (+10,2 %) | 2 |

**Zwei Befunde, die die Aktenlage korrigieren:**

1. **Der Fuzz verwirft im Bestand nichts.** Über 4.283 Hunks (N=4) ist `results[i] === false`
   **null**mal eingetreten. Der stille Verwurf ist kein Risiko *der exakten Suche gegenüber dem
   Bestand* — er ist ihr **einziger** Effekt. Der Schaden des Fuzz entsteht anderswo: 170 bis 385
   Mal je Zelle findet er eine Stelle, deren Kontext nicht zeichengleich ist, und übersetzt die
   Op-Indizes (`index.js:1869-1899`).
2. **Der Preis hängt an der Notizgröße, gegenläufig zur Erwartung.** Bei 200 und 1.000 Basiszeilen
   ist die exakte Suche in **jeder** Spalte besser als der Bestand (nur 27–30 verworfene Hunks);
   bei 8 Zeilen kostet sie 12–73 % mehr Gesamtverlust. In langem Text ist der 32-Zeichen-Kontext
   praktisch eindeutig.

**Die Variante ohne diesen Preis ist gemessen, aber NICHT eingebaut:** exakte Suche, und der
verworfene Hunk wird als sichtbarer Block angehängt statt geschluckt — mit Prüfung, ob er schon
dasteht. Ohne diese Prüfung ist die Meldung **nicht idempotent** (Textlänge 121 → 186 → 251 über
drei Merge-Runden, dieselbe Bauart wie die im August behobene Ersetzung).

> **BEHOBEN am 2026-08-11 — aber anders als hier beschrieben.** Der Rest-Verlust ist weg, und
> zwar nicht durch Abschalten des Fuzz, sondern durch einen **Werkzeugwechsel**: `threeWayMerge`
> mergt jetzt **zeilenweise gegen die Basis** statt fuzzy zu patchen (Abschnitt unten). Alle acht
> gemessenen Zellen: Grundtextverlust **23 → 0**, Gesamt-Textverlust −18,3 %, Verdopplung −6,5 %.
> Auch die drei Achsen, an denen der Fix vom 2026-08-10 nicht trug — N ≥ 5, große Notizen,
> `mdModus: 'ueberschreiben'` —, sind damit erledigt. Der folgende Abschnitt bleibt stehen, weil
> die Messungen gültig sind und der Weg dorthin erklärt, warum die naheliegende Lösung nicht taugt.

**Der Einbau der Melde-Variante ist am selben Tag versucht worden und gescheitert** (Branch
`versuch/patch-apply-einbau`, nicht gemergt). Vier Anläufe, vier Befunde:

1. **Die exakte Suche bricht den Alltagsfall.** `threeWayMerge('a\n','a\nLokal\n','a\nFremd\n')`
   legt „Lokal" in den Meldeblock statt in den Text. Bei kurzen Texten deckt der Patch-Kontext
   fast alles ab, jede fremde Änderung macht ihn krumm — **und der Fuzz gleicht das in der
   Mehrzahl der Fälle korrekt aus.** Er ist nicht grundsätzlich im Unrecht.
2. **Zeilen-Tokenisierung allein entschärft ihn nicht.** Auch über ganze Zeilen kann ein
   verschobener Hunk fremde Zeilen ersetzen — gemessen fielen zwei einer Ersetzung zum Opfer.
3. **Ein globaler Rückfall bricht die Löschsemantik.** Er verwirft mit dem schädlichen Hunk auch
   die Lösch-Hunks; die offline gelöschte Zeile kehrt zurück
   (`sweep-schranke-basiswahl.test.ts`).
4. **Eine Schadensprüfung pro Hunk löst 149 von 150 Tests, die Löschsemantik nicht.**

**Wichtiger als die vier Anläufe: Die Metrik, auf der die Entscheidungsvorlage steht, ist blind
für den Unterschied zwischen „einsortiert" und „angehängt".** `verlust` zählt ein Token als
vorhanden, sobald es irgendwo im Text steht — auch in einem Meldeblock. Die Tabelle oben
**überschätzt deshalb, wie günstig der Tausch ausfällt.** Wer hier weiterarbeitet, braucht zuerst
eine Kennzahl, die beides unterscheidet.

### Die Lösung: zeilenweiser 3-Wege-Merge statt Fuzzy-Patch (2026-08-11)

**`patch_apply` war das falsche Werkzeug.** Es ist für den Fall **ohne** gemeinsamen Vorfahren
gebaut — hier gibt es einen: `base`. Beide Seiten werden jetzt zeilenweise dagegen aufgelöst, ohne
unscharfe Suche. Der Hinweis stand seit Wochen im eigenen Messapparat
(`spike/schnitt/schnitte.mjs:39`: „Wo ein echter Vorfahr vorliegt, ist der Fuzz unnötig").

Weil auf **Zeilen** gearbeitet wird, kann keine Operation mehr eine fremde Zeile aufbrechen — das
war die Schadensmechanik des Zeichen-Diffs.

| Summe über acht Zellen | `WEG` | `verlust` | `verdopp` | `div` |
| --- | --- | --- | --- | --- |
| Bestand (`patch_apply`) | **23** | 1.679 | 10.672 | 2 |
| **zeilenweise** | **0** | **1.371** (−18,3 %) | **9.982** (−6,5 %) | **1** |

Kein Rückschritt in einer einzigen Zelle, in keiner Spalte. 566/566 Tests grün.

**Zwei Nebenwirkungen, ausdrücklich:** Bei nebenläufigen Einfügungen an derselben Stelle steht
jetzt der fremde Beitrag vor dem lokalen (sortiert, damit **alle** Geräte dasselbe rechnen). Und
die dokumentierte Schwäche „`patch_apply` dedupliziert nicht" entfällt an der Wurzel — wo beide
Seiten dieselbe Zeile hinzufügen, ist das ein Beitrag, kein zweiter.

**Was dabei offen bleibt — die Grenzen von diff3 sind bekannt und nachgemessen:**

- **diff3 ist formal nicht idempotent** (Khanna/Kunal/Pierce, FSTTCS 2007, Fact 4.2.2). Gemessen
  über 2.000 Seeds: der neue Merge in **24,7 %** der Fälle, der **Bestand in 100 %**. Die
  verbleibenden Fälle sind ausnahmslos *wachsende* Ergebnisse — mehrfaches Mergen derselben `.md`
  (Sweep, mehrfache Zustellung) kann eine Zeile verdoppeln. Die Harness zeigt `verdopp` trotzdem
  gesunken: überkompensiert, nicht beseitigt.
- **Konvergenz ist nicht garantiert.** Über 2.000 Seeds mit drei Beiträgen liefern **13,7 %** der
  Merge-Reihenfolgen verschiedene Texte. Grundtext geht dabei in **keiner** Reihenfolge verloren,
  und `div` steht in den gemessenen Zellen bei 0–1, weil Yjs darüberliegt. Für N ≥ 5 über alle
  Achsen ist das nicht abschließend belegt.
- **„Beide behalten in sortierter Reihenfolge"** ist die Interleaving-Anomalie aus Kleppmann et
  al. (PaPoC '19): Sortierung stellt Konvergenz her, nicht Lesbarkeit.
- **Verschobene Blöcke:** Der Literaturbefund (§4.3, Blockduplikation) trifft unsere Lage
  **nicht** — gemessen 0 doppelt, 0 verloren; der Bestand verlor dort 297 Zeilen.
- ~~**Kein Realtest.**~~ **Nachgeholt am 2026-08-12** — siehe „Die Wirkung, an echten Instanzen
  belegt" unten. Die *Batterie* ist weiterhin durch den toten Dateiwächter blockiert; der
  Wirkungsnachweis kommt ohne sie aus.

**Offen vor einem Einbau:** Der gemeldete Block wandert über den Sync zu allen Peers und wird dort
gewöhnlicher Text — dieselbe Lage wie bei den Git-Konfliktmarkern unter „Offene Widersprüche"
Punkt 5, und `unionMerge` kann ihn nicht entfernen. Ungemessen. Ebenso ungemessen: eine zeilentreue
Fassung des Blocks, die die Verdopplung senken könnte. (Der Realtest ist am 2026-08-12 nachgeholt —
siehe unten.)

### Der Umbau brachte einen eigenen Fehler mit — behoben am 2026-08-13 (`T-08`)

**`threeWayMerge` klebte zwei Zeilen aneinander, wenn ein Stand nicht auf einem Zeilenumbruch
endet.** `diff_linesToChars_` tokenisiert *inklusive* Zeilenende; `zeilenListe` schneidet eine
Schlusszeile ohne `\n` ohne Trennzeichen ab, und `dreiWegeZeilen` fügt mit `join('')` zusammen — die
nächste Zeile klebt daran fest. `unionMerge` fängt genau das seit Review C-1 mit `padLast` ab
(`text-merge.ts:376-379`) und beschreibt den Schaden wörtlich im Kommentar. Beim Wechsel auf den
zeilenweisen Merge wurde dieselbe Behandlung **nicht mitgezogen**; `padLast` hatte im ganzen Modul
drei Aufrufstellen, alle drei in `unionMerge`.

Kleinster Fall — einziger Unterschied ist der Schluss-Umbruch:

```
threeWayMerge('a\nb',   'a\nb\nX',   'a\nb\nY')    →  "a\nb\nXb\nY"     ← b klebt an X
threeWayMerge('a\nb\n', 'a\nb\nX\n', 'a\nb\nY\n')  →  "a\nb\nX\nY\n"    ← sauber
```

**Am Produkt gemessen, nicht konstruiert.** Die Realtests `r13-cdp-lokal` und `r14-cdp-lokal`
(zwei echte Obsidian-Instanzen) ordnen den Schaden je einem Schritt zu, mit dem Messpunkt
unmittelbar davor als positivem Gegensignal:

| Runner | letzter sauberer Punkt | erster mit `mB` doppelt | dazwischen liegt |
| --- | --- | --- | --- |
| `r13` | M6 — App **zu**, 165 Zeichen | M7 — 217 Zeichen | der Startup-Sweep |
| `r14` | M7 — 158 Zeichen | M8 — 210 Zeichen | die Zustellung von As Hilfsdatei |

Der Endtext beider Läufe trägt `A2-<RunId>BBB-<RunId>` in **einer** Zeile; bei `r13` sind beide
Vaults byte-gleich — konvergent und damit **still**. Verletzt ist Gruppe 1 („Der Text bleibt
strukturell heil"), **nicht** K.o.-Kriterium 1: kein Grundtext geht verloren.

**Es war nie ein Duplikat.** `H-COUNT` zählt Regex-Treffer im Volltext (`harness-ext.ps1:477`),
deshalb sah die verschmolzene Zeile wie eine Verdopplung aus. Die CRDT-Sicht stand in beiden Läufen
auf 1 — der Schaden sitzt im geschriebenen Text, nicht als zweites Item in der Historie.

**Der Kandidat der Aktenlage ist damit gefallen** (`X-07`). Er lautete: „Der Startup-Sweep löst ihn
per `unionMerge` auf, und der kann per Konstruktion nicht deduplizieren." Beide Hälften halten
nicht — `unionMerge` läuft in diesem Pfad gar nicht (der `unite`-Zweig `sync-handler.ts:1837` hängt
an `adopted`, und B hat eigenen State), und es wäre dort die **Lösung** gewesen: dieselben Eingaben
ergeben 191 Zeichen und den Marker genau einmal. Nach dem Fix trifft `threeWayMerge` dieselben 191.

**Warum es niemand sah:** `tests/three-way-line-endings.test.ts` prüfte CRLF, LF und BOM — 26
Fixtures, und **alle 26** endeten auf einem Zeilenumbruch. Genau der Fall, den `unionMerge`s eigener
Kommentar „in Obsidian der Normalfall" nennt, war für `threeWayMerge` nicht abgedeckt. Seit dem Fix
steht dort ein eigener `describe`-Block mit acht Fällen; die Suite geht damit von **600 auf 608**,
ohne Rückschritt in einer einzigen Zeile.

**Die erste Fassung des Fixes war selbst falsch — gefallen an der adversarialen Prüfung.** Sie
entfernte das angehängte Zeilenende nur, „wenn weder `local` noch `other` eines hatte", und las
`other` damit als Beitrag, auch wenn `other === base` — die Gegenseite also gar nichts geändert hat.
Damit brach die Identität `threeWayMerge(base, local, base) === local`: Der gewöhnliche lokale Edit
am Dateiende bekam einen Umbruch angehängt, den niemand getippt hat, und `sync-handler.ts:1847`
schrieb Datei **und** CRDT-Op für eine Änderung, die es nicht gab — selbstverstärkend, weil die Datei
danach auf `\n` endet. Die tragende Fassung merged das Umbruch-Bit selbst 3-Wege-artig: wer es
gegenüber `base` geändert hat, bestimmt es. Beide Richtungen sind als Test gepinnt.

**Auch die zweite Fassung war noch falsch — gefallen an der zweiten Prüfrunde.** Der Strip nahm
pauschal ein Zeichen zurück, aber `mitNl` ist nicht umkehrbar: Endete das Ergebnis auf einer
**Leerzeile**, löschte er diese Zeile — und verfehlte sein Ziel trotzdem, weil danach immer noch ein
Umbruch dastand. Eigene Messung mit versioniertem Instrument (`spike/duplikat-mb/leerzeile.mjs`,
Seed 20260813): **481 von 19.959** gemergten Tripeln (2,4 %) betroffen, konvergent auf beiden Seiten
und damit still. (Die Prüfung meldete dafür 7.578/65.952 aus einer anders gefilterten Population;
ihr Skript liegt in keinem Repo und ist damit nicht nachlaufbar — deshalb neu erhoben.) Behoben: Ein Text mit
leerer Schlusszeile kann das Bit `false` gar nicht erfüllen, dort ist Nichtstun richtig.

**Der Preis, ausdrücklich:** Die Nicht-Idempotenz beim *Mehrfach*-Merge steigt in den
Ohne-Zeilenende-Zellen — 482 → 741, 204 → 751, 648 → 750 von je 2.000 gepaarten Fällen; die
Mit-Zeilenende-Zelle bleibt bei **760** unverändert. Das ist **kein neues Verhalten, sondern eine
Vereinheitlichung** auf den Pfad, den der Mit-Zeilenende-Fall im Bestand schon nahm: Von den Fällen,
in denen die neue Fassung instabil und die alte stabil ist, sind 305/305, 604/604 und 291/294 dort
schon im Bestand instabil. Die drei Reste sind von Hand nachgesehen und ebenfalls Vereinheitlichung —
eine Schwäche der automatischen Kontrollfrage, nicht des Produkts. diff3 ist formal nicht idempotent
(Khanna/Kunal/Pierce, FSTTCS 2007); der Fix verschiebt nur, welche Fälle in diesen bekannten Pfad
fallen. Gemessen mit festem Seed, `spike/duplikat-mb/idempotenz.mjs`.

**Das Messinstrument war dabei selbst blind — und ist gehärtet.** Sein Alphabet enthielt keinen
Leerstring, und es entfernte per Regex *alle* Schluss-Umbrüche statt nur einem; es konnte damit nie
einen Text mit leerer Schlusszeile erzeugen. Genau die Schadensklasse der zweiten Runde war so
strukturell unsichtbar, und seine Zahl wurde als Entlastung zitiert, die sie für diesen Fall nicht
trug. Jetzt enden 366 von 2.000 erzeugten Texten auf einer Leerzeile. **Neunter Fall von
Messinstrument-Blindheit in diesem Projekt.**

**Zwei Nebenbefunde derselben Untersuchung, beide offen:**

- **Die Sweep-Schranke steht nicht auf `aus`, und sie ist wirksam.** `sync-handler.ts:132-135`
  initialisiert seit dem 2026-08-07 auf `'basis-signatur'`. Die Kommentare an beiden Stellen
  behaupteten bis zum 2026-08-13 „SPIKE-SCHALTER, Standard 'aus'" — wer sie las, hielt einen
  scharfen Schalter für tot; **korrigiert**. Dass sie wirkt, war die ganze Zeit gemessen und mir
  nur entgangen: `sweep-schranke-basiswahl.test.ts:327` fährt den echten `runStartupSweep` aus
  `main.ts` und vergleicht beide Standards — mit `'aus'` stirbt der eigene Edit und
  `sweepSchrankeZaehler` bleibt 0, mit `'basis-signatur'` überlebt er, in Doc **und** Datei. Der
  Abschnitt „Was dieser Apparat NICHT misst" unten bleibt richtig: dort ging es um den
  *Messapparat*, der keinen Neustart modelliert — nicht um das Produkt.
- **`r13` prüft eine Bedingung, die nicht mehr eintreten kann — belegt.** Sein Kopfkommentar führt
  „der file-open-Trigger konnte den Startup-Sweep überholen" als die geprüfte Bedingung. Die
  Reihenfolge ist erzwungen und **getestet**: `sweep-gate.test.ts:80` prüft, dass nach `onload`
  nichts scharf ist und die Reihenfolge exakt `['sweep', 'start', 'poll']` lautet; `:197` prüft
  zusätzlich, dass ein file-open-Scan *während* des Sweeps den nur in der `.md` lebenden Edit nicht
  überschreibt. Zwei unabhängige Gates. Damit ist es dieselbe Lage wie bei `r11`: nicht „ist das ein
  Bug", sondern „der Runner prüft nicht mehr, was er zu prüfen vorgibt". Was **offen** bleibt, ist
  allein die Frage, ob `r13` deshalb umgebaut oder abgelöst gehört.

### Die Wirkung, an echten Instanzen belegt (2026-08-12)

**Erstmals nicht nur Regressionsfreiheit, sondern Wirkung.** `r30` prüft das Herkunftstor an einem
einzigen Vault; die Schadensklasse, die `ba9f943` behebt, kommt darin gar nicht vor. Der Lauf
`harness/agent-t3-fuzz.ps1` löst sie am alten Build aus und zeigt, dass sie am neuen ausbleibt —
drei echte Obsidian-Instanzen, drei Client-IDs, eine geteilte Inkarnation, alle `.md`-Schreibungen
über `app.vault.modify`.

Fixture zeichengleich aus `spike/schnitt/probe-fuzz.mjs` Seed 3: die lokale Ergänzung `|n0-D0-9`
gehört an `n0-base-6`; alle drei Stände tragen `n0-base-4` unverändert.

| Endstand in allen drei Vaults | `n0-base-4` | Verdict |
| --- | --- | --- |
| **alter Build** (`269C24EF…`, vor `ba9f943`), zweimal reproduziert | **`n0-base-4\|n0-D0-9`** — als Zeile zerstört | KLASSE-AUSGELOEST |
| **neuer Build** (`5B34BF7D…`, `efae37a`) | **`n0-base-4`** — unversehrt | WIRKUNG-BELEGT |

Am alten Build ist die Zeile in **allen drei** Vaults verschwunden, bei intakter Konvergenz — der
stille Fall. Beide Läufe aus demselben Skript, mit im Skript erzwungener byte-identischer
Ausgangslage; der deployte Build wurde je Vault gegen die Quelle gehasht. Die Endstände sind
**byte-identisch mit der harness-freien Kalibrierung** (`spike/wirkung/`).

**Der Preis, am echten Produkt sichtbar:** Der neue Merge behält `n0-base-5` neben
`n0-base-5|n0-D1-4` — die „beide behalten, sortiert"-Auflösung. 11 statt 9 Zeilen, kein
Grundtextverlust. Das ist die Interleaving-Anomalie (Kleppmann et al., PaPoC '19), hier erstmals
am Produkt statt in der Simulation.

**Was der Lauf NICHT zeigt:** eine Rate (ein Szenario, nicht 200 Seeds), `mdModus: 'ueberschreiben'`
an echten Instanzen, den Sweep (kein Neustart im Lauf), N ≥ 5. Bericht:
`wirkungsnachweis-2026-08-12.md` — **beim Rechnerwechsel verloren** (s. u.), und anders als bei der
Messung oben ist hier keine versionierte Rohdatei bekannt, aus der sich der Lauf rekonstruieren
ließe. Die Aussagen dieses Abschnitts stehen damit ohne nachlesbaren Beleg.

> **Korrektur 2026-08-12 (zweite Sitzung): Der Unit-Test existiert.** Hier stand, für die behobene
> Klasse gebe es „auf `master` weiterhin **keinen** Unit-Test", `tests/three-way-fuzz.test.ts` liege
> nur auf `versuch/patch-apply-einbau` und sei dort ans nie eingebaute `MELDE_MARKE` gebunden.
> Nachgezählt: Die Datei liegt seit `e827520` auf `master`, hat 84 Zeilen und enthält `MELDE_MARKE`
> **nicht** (`grep -rn MELDE_MARKE src/ tests/` → null Treffer). Sie fährt die Fixture aus
> `spike/schnitt/probe-fuzz.mjs` Seed 3 und prüft drei Zusagen: Grundtext, den alle drei Stände
> unverändert tragen, bleibt stehen; die lokale Ergänzung landet nicht an `n0-base-4`; und der
> Alltagsfall behält beide Beiträge — die Gegenprobe dagegen, dass „nur noch exakt suchen" den
> Grundtext gerettet und den Alltagsfall fallen gelassen hätte. Die Liste der geprüften Zeilen ist
> aus der Fixture **abgeleitet** statt hart geschrieben, kann also nicht davon driften.
>
> Was an der alten Fassung richtig bleibt: Auf `versuch/patch-apply-einbau` liegt **ebenfalls** eine
> Datei dieses Namens, und die ist an `MELDE_MARKE` gebunden. Zwei verschiedene Dateien unter einem
> Namen — die Aussage stammt vom Branch-Stand und wurde beim Wechsel auf `master` nicht nachgezogen.

**Nebenbefund:** Auch der Bestand ist nicht idempotent — rechnet ein zweites Gerät den Merge auf
dem Ergebnis des ersten, steht das lokale Token danach zweimal da (64 → 72 → 80 Zeichen). Das ist
die WARNUNG aus `text-merge.ts:46` („patch_apply dedupliziert nicht"), erstmals belegt.

### Die Bibliotheksgrenze — gefunden und behoben (2026-08-10)

`diff_linesToChars_` deckelt die Zahl **verschiedener** Zeilen des **ersten** Textes bei **40.000**
(diff-match-patch `index.js:507`; die 65.535 gelten erst für den zweiten). Darüber kollabierte der
Rest zu einer Zeile, und zwei nebenläufige Bearbeitungen im kollabierten Schwanz erzeugten
**5.001 verdoppelte Grundtextzeilen** — K.o.-Kriterium 1 blieb gewahrt (nichts *fehlte*), Gruppe 1
„Nichts wird verdoppelt" fiel.

**Behoben** (Commit `04154d7`): `diffOps` fällt oberhalb einer gemessenen Schwelle (39.000
verschiedene Zeilen über beide Texte, Abstand 999 zur Kante) auf `semantisch` zurück. Bei 45.000
Zeilen jetzt **0** verdoppelt; `WEG = 0` bleibt bei byte-identischen Nebenzählern erhalten.

Die Schwelle misst auf **verschiedenen** Zeilen, nicht auf der Gesamtzahl — belegt bei konstant
45.000 Gesamtzeilen: 39.999 verschiedene → kein Kollaps, 40.000 verschiedene → Kollaps. Eine
Schwelle auf `split('\n').length` hätte beide Male denselben Wert gelesen.

### An echten Obsidian-Instanzen belegt (2026-08-10)

Erstmals nicht in Simulation: drei echte Obsidian-Instanzen (`vault-a`, `vault-c`, `vault-d`),
drei Client-IDs, eine geteilte Inkarnation. Ein Gerät läuft über den `.yjs`-Kanal voraus, zwei
rechnen unabhängig dieselbe Rücknahme. Schreibungen über `app.vault.modify`, also derselbe
Herkunftsfall wie ein tippender Mensch — eine hineinkopierte `.md` würde am Herkunftstor geparkt
und erreichte `setContent` nie.

| Endstand in allen drei Vaults | Ergebnis |
| --- | --- |
| **alter Build** (`40A50951…`), zweimal reproduziert | `n5-base-0` / **`n5-basebase-1`** / `n5-base-2` |
| **neuer Build** (`1F4EF2B1…`) | `n5-base-0` / **`n5-base-1`** / `n5-base-2` |

Am alten Build ist `n5-base-1` in **allen drei** Vaults verschwunden, bei intakter Konvergenz — der
stille Fall. Am neuen Build steht die Zeile genau einmal. Das ist die Vorhersage aus
`crdt-manager.ts` und der erste Beleg dafür am echten Produkt.

**Die Regressions-Batterie ist derzeit nicht aussagefähig.** Sieben von neun Runnern brechen an
derselben Stelle ab (`H-WAIT`-Timeout beim ersten Warten auf die Sidecar). Nur `r30` läuft
**PASS 9/9, deckungsgleich mit dem Vorlauf**; `r31` (31 min) wurde nicht gefahren.

> **URSACHE KORRIGIERT am 2026-08-12. Die frühere Erklärung war falsch — es gibt keinen defekten
> Dateiwächter.** Hier stand: „Obsidians nativer Dateiwächter reagiert dort nicht mehr, eine extern
> geschriebene `.md` löst `modify` erst nach 30,4 s aus […] Discriminator: alter Build 120 s, neuer
> Build 119 s — buildunabhängig […] älter als der Fix." Nachgeprüft an den Logs hält davon nichts:
>
> - **Die Sieben warten 90 s auf ein Ereignis, das per Konstruktion frühestens nach 120 s
>   eintritt.** `H-EDIT` schreibt extern (`harness.ps1:162`, `[IO.File]::WriteAllText` bei laufendem
>   Obsidian). Genau das parkt das **Herkunftstor** (`main.ts:329-335`) — und geparkter Inhalt
>   erzeugt **keine Sidecar**. Er wird erst nach Fristablauf nachgetragen:
>   `PARK_FRIST_TICKS = 4` (`main.ts:92`) × `SCAN_INTERVAL_MS = 30_000`
>   (`sidecar-watcher.ts:3`) = **120 s**. Alle sieben Runner setzen **90 s**
>   (`s00.ps1:39`, `r01.ps1:54`, `r11.ps1:68`, `r13.ps1:44`, `r14.ps1:42`, `r15.ps1:46`,
>   `r16.ps1:50`). 90 < 120 — der Abbruch ist rechnerisch unvermeidlich.
> - **Die Trennlinie ist der Schreibweg, nicht der Timeout.** 7/7 Extern-Schreiber scheitern,
>   2/2 Prozess-Schreiber bestehen: `r30` tippt über CDP (`r30-herkunftstor.ps1:62`,
>   `ed.replaceSelection`), `r31` ebenso. In denselben `r30`-Läufen, in derselben Minute, liegen
>   zwischen `.md`-Schreibung und Sidecar **0,075 s** im Prozess und **117,6 s** extern. Ein toter
>   Dateiwächter kann diesen Unterschied nicht machen; das Herkunftstor macht genau ihn.
> - **„120 s" ist ein Konstruktionswert, kein Umgebungssignal.** Alle vier `r30`-`verdict.json`
>   melden `C-nach-frist-erfasst = "nach 120s"` — auch der Lauf vom **2026-08-04**, also vor dem
>   behaupteten Bruch.
> - **Der Zeitpunkt passt auf den Commit, nicht auf die Umgebung.** Die letzten schnellen Logs
>   (2,1 s) stammen vom 2026-08-03; `ae57907` („Herkunftstor im modify-Pfad verdrahten, Uhr
>   definieren") datiert auf den **2026-08-04**. `r30-herkunftstor.ps1:3-7` sagt es selbst vorweg:
>   das alte Abnahmekriterium editiere „ausschliesslich EXTERN […] Genau das gilt seit dem
>   Erstkontakt-Fix als fremd und wird geparkt — der Lauf waere aus einem Harness-Artefakt rot,
>   nicht aus einem Fehler."
> - **„30,4 s" und „119 s" sind in keinem Log als Latenzmessung auffindbar.**
>
> **Die Batterie misst also nicht die Umgebung, sondern ist am Produkt vorbeigebaut.** Sie ist
> nicht kaputt, sie ist veraltet: Sie prüft einen Schreibweg, den das Plugin seit dem 2026-08-04
> bewusst anders behandelt. Zwei Wege zurück, beide mit Preis — Timeouts über 120 s heben (dann
> misst man den *Nachtrag nach Frist*, nicht den lokalen Edit, und die Folge-Waits bei 90–120 s
> fallen als nächstes), oder den Schreibweg auf den Prozess umstellen (`H-CDP type` /
> `app.vault.modify`), was `H-START-CDP` statt `H-START` verlangt und damit einen echten Umbau.
>
> **DISKRIMINATOR GEFAHREN, 2026-08-12 — die Diagnose ist jetzt gemessen, nicht mehr abgeleitet.**
> Die Kette oben war rechnerisch zwingend, aber es gab nach dem 2026-08-04 keinen Lauf mit einer
> Wartezeit über 120 s. Deshalb `runners/r01-discriminator.ps1`: Kopie von `r01.ps1`, **einzige
> Änderung sind zwei Timeout-Zahlen** (Zeile 54: `90` → `240`, Zeile 68: `120` → `240`).
>
> | | `r01` (Timeout 90 s) | `r01-discriminator` (Timeout 240 s) |
> | --- | --- | --- |
> | Lauf | `r01-20260810-080441` | `r01-20260810-211029` |
> | Verdict | **FAIL** | **PASS** |
> | erreichte Asserts | **0** (`"asserts": []`) | **6**, alle grün |
>
> Gemessene Wartezeit an der ersten Sidecar: `H-EDIT` 21:10:47,25 → `H-WAIT` erfüllt 21:12:45,87 =
> **118,6 s**. Das liegt über den 90 s des Timeouts und knapp unter den 120 s der Frist — genau das
> vorhergesagte Fenster. Damit ist belegt: **Der Ausfall war ein zu kurzer Timeout, kein Defekt.**
> Die sechs Asserts (`ruhe-erreicht`, je einmal A/B in beiden Vaults, `sha-gleich`) sind grün — es
> lag also **kein** Regressionssignal unter dem Timeout begraben.
>
> Was der Diskriminator **nicht** zeigt: ob die so gefahrenen Runner noch dasselbe messen wie vor
> dem 2026-08-04. Bei 118,6 s kommt der Text als **Nachtrag nach Fristablauf** in die Historie,
> nicht als sofort erfasster lokaler Edit. Für `r01` (Konvergenz, Zählung je Beitrag) trägt das
> sichtbar; für Runner mit Zusagen über den Erfassungs*zeitpunkt* ist es zu prüfen. Nebenbefund
> desselben Laufs: `guidA ≠ guidB` (Split-Brain, zwei Inkarnationen) — und trotzdem konvergent, mit
> jedem Beitrag genau einmal. `r01` führt das als Befund, nicht als Assert.

### Die übrigen sechs Runner, gefahren am 2026-08-12

Dieselbe Änderung (Wartezeiten ≤ 120 s auf 240 s, sonst keine Zeile) an `s00`, `r11`, `r13`, `r14`,
`r15`, `r16`. Serie sequenziell, 31 min. **Das Ergebnis ist dreigeteilt — die Timeout-Erklärung
trägt nicht überall:**

| Runner | Verdict | Einordnung |
| --- | --- | --- |
| `s00` | **PASS** | Timeout war der Blocker |
| `r11` | **FAIL — 8 Asserts rot** | erreicht seine Prüfungen und ist **inhaltlich** rot (siehe unten) |
| `r13`, `r14`, `r15`, `r16` | FAIL — **0** Asserts | sterben weiter **vor** den Asserts |

**Warum die vier weiter sterben: eine übersehene Wartestelle im gemeinsamen Helfer.** Alle vier
rufen `H-SETUP-SHARED`, und dort steht der Timeout, nicht im Runner:
`harness-ext.ps1:288` wartet **90 s** auf die erste Sidecar, `:297` **120 s** auf die zweite. Beide
liegen wieder unter der 120-s-Frist. Die Diagnose gilt also auch für sie — die Korrektur war nur
unvollständig, weil sie an den Runner-Dateien ansetzte statt am Helfer.

**Zweiter Anlauf mit korrigiertem Helfer (`harness-ext-disc.ps1`, dieselben zwei Werte auf 240 s):
Der Fix trägt.** Wo vorher **null** Asserts erreicht wurden, misst die Batterie wieder:

| Runner | vorher | jetzt | rote Asserts | Art |
| --- | --- | --- | --- | --- |
| `r13` | 0 erreicht | **13** | `alt-A-1x` ist **2** soll 1; `alt-B-1x` ist **3** soll 1 | Duplikate |
| `r14` | 0 erreicht | **15** | `kontrolle2-keine-duplikate` ist **2/2/1** soll 1/1/1 | Duplikate |
| `r15` | 0 erreicht | **19** | `B-text-B-1x` ist **0** soll 1; `A-erhaelt-B-edit` False; `A-text-B2-1x` ist **0** soll 1 | **Verlust** |

`r16` läuft **PASS, 11 Asserts grün** (der erste Versuch scheiterte an `H-START` — Obsidian kam
nicht hoch, weil der Singleton-Lock des Vorlaufs noch hing; nach einer Pause lief er durch. Kein
Befund, ein Infrastruktur-Hänger).

**Gesamtbild der Batterie nach der Korrektur:**

| | vor dem 2026-08-12 | danach |
| --- | --- | --- |
| Runner, die überhaupt messen | **2** (`r30`, `r31`) | **8** von 9 (`r31` weiterhin ungefahren) |
| davon PASS | 2 | **4** (`s00`, `r01`, `r16`, `r30`) |
| davon FAIL mit inhaltlichem Befund | 0 | **4** (`r11`, `r13`, `r14`, `r15`) |
| davon tot vor dem ersten Assert | 7 | **0** |

**Die Batterie ist damit wieder aussagefähig** — was seit dem 2026-08-04 nicht mehr galt.

> **`r31` ist verloren, nicht bloß ungefahren (festgestellt 2026-08-12, zweite Sitzung).** Die
> Tabelle oben führt ihn als einen der neun Runner und als einen der zwei, die vor dem 2026-08-12
> überhaupt maßen. Er existiert nicht mehr: `git rev-list --all --objects` liefert in **beiden**
> Repos null Treffer auf `r31`, und im Dateisystem gibt es ihn ebenfalls nicht. Gerettet wurden nur
> die Runner mit einer Kopie unter `spike/wirkung/` (`r01-discriminator`, `s00-disc`, `r11-disc`,
> `r13-disc`, `r14-disc`, `r15-disc`, `r16-disc`) plus `r30-herkunftstor.ps1` im Doku-Repo. `r31`
> hatte keine — er lag nur unter `C:\tmp\qollab-test\` und ist denselben Weg gegangen wie der
> Harness.
>
> **Das wiegt schwerer als der Ausfall eines der externen Runner:** `r31` tippte laut dem Abschnitt
> oben über CDP, war also einer der **zwei** Prozess-Schreiber — genau die Bauart, auf die die
> übrigen jetzt umgestellt werden müssen. Von den zwei belegten Vorbildern ist nur noch `r30` da.
> Die Zeile „`r31` weiterhin ungefahren" in der Tabelle ist damit irreführend: Er kann nicht
> gefahren werden. Was er prüfte, ist aus keiner erhaltenen Quelle rekonstruierbar — die Aktenlage
> nennt nur seine Laufzeit (31 min) und den Schreibweg.

**Die Befunde zerfallen in zwei Gruppen, und nur eine hat eine Erklärung.** `r13`/`r14` zeigen
Duplikate, kein Verlust — und sie haben eine naheliegende, aber
**ungeprüfte** Erklärung: Der extern geschriebene Stand wird geparkt und per `unionMerge`
aufgelöst; `unionMerge` hat keinen gemeinsamen Vorfahren und kann deshalb per Konstruktion nicht
deduplizieren. Genau das sagt der Code selbst zu (`sync-handler.ts:365-370`: „verliert nie,
verdoppelt genau einmal sichtbar"). Bei `r13` ist die tragende Zusage
(`externe-aenderung-ueberlebt`) grün — es fehlt nichts, es steht doppelt da.

**`r11` und `r15` passen NICHT in dieses Muster.** Dort *fehlt* Text (0 statt 1), und genau das
dürfte `unionMerge` nie tun — derselbe Code verspricht ausdrücklich „verliert nie, verdoppelt genau
einmal sichtbar". **Diese Spannung ist ungelöst.** Entweder trifft die Park-Erklärung für sie nicht
zu, oder die Zusage „verliert nie" gilt nicht in allen Lagen. Beides wäre wichtig zu wissen; beides
ist ungemessen.

> **AUFGELÖST am 2026-08-12 (zweite Sitzung): Die Park-Erklärung trifft zu — für beide.** Die vier
> roten Runner sind über den Prozess-Schreibweg nachgefahren worden (`r11-cdp` … `r15-cdp`,
> zeichengleich mit ihren `-disc`-Fassungen, geändert ist nur der Schreibweg bei laufender App).
> Alle vier Läufe tragen `sidecar-ohne-park-frist` grün, messen also den Erfassungspfad und nicht
> den Nachtrag nach Fristablauf:
>
> | Runner | extern (Bestand) | im Prozess | Klasse |
> | --- | --- | --- | --- |
> | `r11` | FAIL, 8 rot — **Verlust** | **PASS**, 46 grün | entkräftet |
> | `r15` | FAIL, 3 rot — **Verlust** | **PASS**, 21 grün | entkräftet |
> | `r13` | FAIL, 2 rot — Duplikate | FAIL, **1** rot (`alt-B-1x` 3 → 2) | halbiert, Rest offen |
> | `r14` | FAIL, 1 rot — Duplikate | FAIL, 1 rot (`kontrolle2` 2/2/1 → **1**/2/1) | reduziert, Rest offen |
>
> **Die Zusage „verliert nie" hält.** Beide Verlust-Signaturen stammten aus dem Messapparat, nicht
> aus dem Produkt: Extern geschriebener Inhalt wird 120 s geparkt und danach per `unionMerge`
> nachgetragen — ein anderer Pfad als der, auf dem die Zusagen 2026-08-03 aufgestellt wurden. Bei
> `r15` sind alle drei früher roten Asserts grün (`B-text-B-1x`, `A-erhaelt-B-edit`,
> `A-text-B2-1x`), bei `r11` alle sechs.
>
> **Die Duplikate bleiben — und der naheliegende Verdacht ist widerlegt.** In beiden Runnern ist der
> verbliebene Doppelgänger **derselbe Marker**: `mB`, den B im gemeinsamen Aufbau
> (`H-SETUP-SHARED`) setzt. Bei `r13` ist es `alt-B-1x`, bei `r14` das mittlere Element von 1/2/1.
> Das legte den **Aufbauhelfer** als Quelle nahe — und genau das ist gemessen und **gefallen**:
>
> `agent-t8-aufbau.ps1` fährt **nur** den Aufbau und zählt unmittelbar danach aus, in zwei Armen:
>
> | Arm | Aufbau auf | Ergebnis |
> | --- | --- | --- |
> | Normalfall (zweimal gefahren) | frisch angelegter Notiz | **AUFBAU-SAUBER** |
> | `-NotizVorbestehend` | vorbestehender Notiz — die Lage von `r13`/`r14`/`r15` | **AUFBAU-SAUBER** |
>
> In beiden Armen stehen alle vier Marker-Zähler auf 1, die CRDT-Sicht (`markerCounts` aus den
> Hilfsdateien) ebenfalls, die GUID ist geteilt und beide Vaults sind byte-gleich. **Der Helfer
> erzeugt das Duplikat nicht.** Es entsteht im geprüften Szenario — und ist damit ein Produktbefund,
> der einzeln zu verfolgen ist.
>
> **Der zweite Arm war nötig, nicht Zierde.** Der erste fuhr auf einer frisch angelegten Notiz;
> `r13`–`r15` cleanen `Meetingprotokoll.md` nie, und `H-RESET` löscht nur die Hilfsdateien — ihr
> Aufbau läuft also immer auf einer vorbestehenden `.md`. Ohne den Kontrollarm hätte der Lauf einen
> anderen Fall gemessen als den fraglichen.
>
> **Nebenbefund am Helfer, dabei entdeckt:** Existiert die Notiz noch nicht, macht `H-EDIT-CDP` ein
> `app.vault.create` — und ein bloßes `create` prägt **keine** Inkarnation, erst ein `modify` tut es
> (belegt in `agent-t2b.ps1:87-89`). Der Aufbau lief deshalb in den Timeout, sobald ein Runner die
> Notiz vorher aufräumte. In `H-SETUP-SHARED-CDP` behoben: Bleibt die Hilfsdatei aus, wird ein
> zweites Mal gesetzt.
> Dagegen spricht nicht, dass beide Runner ihre tragenden Zusagen halten: `r13`s
> `externe-aenderung-ueberlebt` und `r14`s komplette 0-Byte-Kette (`0byte-datei-nicht-geloescht`,
> `keine-neue-inkarnation`, `text-A/B/B2`) sind grün. Es fehlt nichts, es steht doppelt da.
>
> **Was der Serienlauf über den Apparat lehrte, statt über das Produkt:** `r14` und `r15` starben im
> ersten Durchgang nach drei Asserts, weil nach dem Vorgänger-Runner `vault-b` in `obsidian.json`
> auf `open:true` stand und `H-START-CDP` beim Start ohne Vault-Argument alle so vermerkten Vaults
> hochholt — B lief also, **bevor** der Aufbau zustellen konnte. Gefangen hat das die
> Vorbedingungsprüfung in `H-SETUP-SHARED-CDP`, die derselbe Umbau eingeführt hat; der alte Helfer
> behauptet dieselbe Bedingung seit Monaten nur im Kommentar. Ohne sie hätten beide Runner mit einem
> falsch aufgebauten Zustand weitergemessen und Duplikate gemeldet, die aus dem Aufbau stammen.
> Behoben mit `H-TESTVAULT-FLAGS-WEG` vor jedem Lauf.

### Der Vorlauf-Diskriminator: über den Prozess-Schreibweg überlebt die Zeile (2026-08-12)

`agent-t4-vorlauf.ps1` fährt `r11`s Aufbau — A editiert, **nur die Sidecar** reist zu B, B tippt
zweimal kurz hintereinander —, aber jeder Schreibvorgang läuft über `app.vault.modify` im Renderer
statt extern. Damit ist er „eigen" (`WriteProvenance` umhüllt den DataAdapter), es wird nichts
geparkt, und die Sidecar entsteht sofort statt nach 120 s.

Der Doc-Vorlauf entstand nachweislich: Vor der Zustellung trug `a` den Marker `AAA`, `b` nicht;
nach der Sidecar-Zustellung trug `b`s **Doc** ihn, seine `.md` nicht.

| Endstand | in `a` | in `b` |
| --- | --- | --- |
| As Marker | **1** (soll 1) | **1** (soll 1) |
| Bs Marker 1 | 1 | 1 |
| Bs Marker 2 | 1 | 1 |
| konvergent | **ja** | **ja** |

**Verdict `A-ZEILE-UEBERLEBT`.** Kein Verlust, keine Verdopplung, beide Vaults byte-gleich. Damit
ist `r11`s Rot **sehr wahrscheinlich ein Artefakt des Park-Pfades**, nicht ein Fehler des heutigen
Erfassungspfades.

**Die strikte Variante ist nachgefahren und bestätigt es** (`-BOhneState`, Lauf `t5`): B legt die
Notiz nur per `app.vault.create` an und prägt damit **keinen** eigenen CRDT-State — im Lauf
protokolliert als `b hat 0 Sidecar(s) (soll 0)`. Damit ist `r11`s Vorbedingung („B hat die `.md`,
aber keinen eigenen State") zeichengleich hergestellt, und zwar **ohne** externen Schreibvorgang.
Ergebnis erneut **`A-ZEILE-UEBERLEBT`**: alle drei Marker genau einmal, beide Vaults konvergent.

Damit fällt die Einschränkung des ersten Laufs weg. **Über den Prozess-Schreibweg ist die Klasse
sauber — in beiden Erstkontakt-Lagen.**

#### Der Gegentest widerlegt die naheliegende Erklärung

Um die Ursache festzunageln, wurde derselbe Aufbau mit **externem** Schreibweg gefahren
(`-Extern`, Lauf `t6b`) — dem Weg, den `r11` über `H-EDIT` nimmt. Die Basis-Phase lief bewusst
weiter über den Prozess, damit die Ausgangslage byte-gleich bleibt und **nur** der Schreibweg im
kritischen Moment variiert.

**Erwartet war ein Bruch. Eingetreten ist keiner:** Verdict erneut `A-ZEILE-UEBERLEBT`, alle drei
Marker genau einmal, beide Vaults konvergent. Der einzige Unterschied zum Prozess-Lauf ist die
**Reihenfolge** (`BBB1, BBB2, AAA` statt `AAA, BBB1, BBB2`) — die Sortierung der Union, kein
Verlust.

**Damit ist „der externe Schreibweg verursacht `r11`s Rot" widerlegt.** Die Erklärung, die für
`r13`/`r14` (Duplikate) trägt, trägt für den Verlust in `r11`/`r15` **nicht**. Die Ursache ist
offen.

**Was den Gegentest von `r11` noch unterscheidet** — jede dieser Abweichungen ist ein Kandidat und
keine ist geprüft:

1. **Die Wartezeit.** Dieser Lauf wartet nach jedem externen Schreiben 150 s auf den Nachtrag.
   `r11` tippt „zwei Edits in B kurz hintereinander, ohne dass dazwischen ein 30-s-Poll laeuft" —
   also **mitten in der Park-Frist**. Die B-Edits lagen hier zwar 1 s auseinander, As Nachtrag war
   aber bereits durch.
2. **Wie B seine `.md` bekommt.** Hier per `app.vault.create` im Prozess (kein Parkplatz-Eintrag);
   in `r11` per `H-WRITE-NOTE`, also **extern** — B trägt dann selbst einen geparkten Stand.
3. **Drei Notizen mit gestaffelten Tastenpausen** (1,0 / 2,5 / 6,0 s) statt einer.

Der nächste Diskriminator müsste Punkt 1 und 2 gezielt einführen, statt sie wie hier zu
neutralisieren. **Dieser Lauf ist ein Lehrstück für `[[Messinstrument-Blindheit]]`: Er hat die
Variable, die er prüfen sollte, durch seine eigenen Wartezeiten ausgeschaltet.**

#### Vierter Lauf über den Startup-Sweep — auch dort überlebt die Zeile

Punkt 2 ist nachgeholt (`basis-sweep`, Lauf `t7`). Aus `r11.ps1:86` gelesen statt rekonstruiert:
Dort werden Bs Notizen **extern angelegt, bevor Obsidian dort startet** (`H-START 'b'` steht
dahinter) — sie durchlaufen also den **Startup-Sweep**. Die Läufe `t4`/`t5`/`t6b` haben das nicht
getroffen, weil B dort bereits lief und die Notiz per `create` im Prozess anlegte.

`basis-sweep` stoppt Obsidian, schreibt beide `.md` extern, startet neu und lässt den Sweep laufen.
**Nebenbefund, für sich schon interessant: Nach dem Sweep haben beide Vaults `0` Sidecars** — er
überführt eine extern angelegte, unveränderte `.md` nicht in CRDT-Zustand. Damit ist `r11`s
Vorbedingung („B kennt die Notiz ohne jede Sidecar") über den echten Pfad hergestellt.

Ergebnis des anschließenden Schlags (extern geschrieben): erneut **`A-ZEILE-UEBERLEBT`**.

**Bilanz über vier Varianten derselben Klasse:**

| Lauf | Schreibweg | Bs Ausgangslage | Ergebnis |
| --- | --- | --- | --- |
| `t4` | Prozess | eigener State | A-ZEILE-UEBERLEBT |
| `t5` | Prozess | kein State (`create`) | A-ZEILE-UEBERLEBT |
| `t6b` | **extern** | kein State (`create`) | A-ZEILE-UEBERLEBT |
| `t7` | **extern** | über den **Startup-Sweep** | A-ZEILE-UEBERLEBT |

**Der Verlust aus `r11` ist in keinem kontrolliert aufgebauten Lauf reproduzierbar.** Was bleibt,
sind Unterschiede im Runner selbst — drei Notizen mit gestaffelten Tastenpausen (1,0/2,5/6,0 s),
`H-SYNC-ONE` statt Dateikopie, und ein Vorlauf mit `AliveA`/`AliveB`-Notizen. **Einordnung: Der
Befund ist entkräftet, soweit er sich kontrolliert nachstellen lässt.** Er als Produktfehler zu
führen, wäre durch nichts gedeckt; ihn als erledigt abzuhaken ebenfalls nicht, solange der Runner
selbst rot bleibt. Die nächste sinnvolle Frage ist deshalb nicht mehr „ist das ein Bug", sondern
„prüft `r11` noch, was er zu prüfen vorgibt".

**Der vermutlich tiefere Grund für `r11`s Rot — und er betrifft mehr als diesen Runner:** Die
Vorbedingung des Aufbaus lautet „B hat die `.md`, aber **keinen eigenen CRDT-State**". Genau die
ist heute nur noch über einen **externen** Schreibvorgang herstellbar (`H-WRITE-NOTE`), und genau
der wird seit dem Herkunftstor geparkt. **Der Runner kann seine eigene Ausgangslage nicht mehr
herstellen, ohne den Pfad zu betreten, den er nicht messen wollte.** Das ist kein Timeout-Problem
und mit einer größeren Zahl nicht zu beheben.

Ein gangbarer Weg für den schärferen Lauf steht im Harness bereits belegt: `app.vault.create`
erzeugt **keine** Sidecar, erst ein `modify` tut es (gemessen, `agent-t2b.ps1:87-89`). B könnte die
Notiz also im Prozess anlegen, ohne eigenen State zu prägen — damit wäre `r11`s Vorbedingung
zeichengleich und ohne Parken herstellbar.

**`r11` ist der ernste Befund.** Der Runner prüft den Doc-Vorlauf (Task 16): A editiert eine Notiz,
**nur die Sidecar** reist zu B (die `.md` bewusst nicht, sonst entsteht kein Vorlauf), B hat die
Notiz nie geöffnet, dann zwei Edits in B kurz hintereinander. Zusage laut Kopfkommentar: *„As Zeile
überlebt in BEIDEN Vaults, genau einmal. Vor dem Fix verschwand sie beim zweiten Tippen auf beiden
Geraeten."* Gemessen wurde genau diese Signatur:

    A-A-zeile-1x-{0,1,2}       ist=0  soll=1     As Zeile fehlt in As EIGENEM Vault
    B-A-zeile-1x-{0,1,2}       ist=0  soll=1     und in Bs Vault ebenfalls
    kontrolle-merge-kommt-an   ist=False
    kontrolle-1x               ist=0  soll=1

**Ob das ein echter Verlust oder ein Artefakt der veränderten Semantik ist, ist offen** — und die
Unterscheidung ist die nächste Messung wert, nicht eine Vermutung. Der Runner schreibt extern
(`H-EDIT`), also wird As Edit heute **geparkt** und erst nach Fristablauf per `unionMerge`
nachgetragen; er läuft damit über einen anderen Pfad als 2026-08-03, wo die Zusage aufgestellt
wurde. **Der Diskriminator dafür ist billig:** denselben Fall mit dem Prozess-Schreibweg fahren
(`H-CDP type` bzw. `app.vault.modify`). Dann entfällt das Parken, und es zeigt sich, ob die Zeile
unter dem heutigen Erfassungspfad überlebt. Bis dahin gilt der Befund als **ungeklärt, nicht als
entwarnt** — es ist K.o.-Kriterium 1, das hier zur Debatte steht.

> **DER DISKRIMINATOR IST GEFAHREN, 2026-08-12 (zweite Sitzung): `r11`s Rot war ein Artefakt des
> Park-Pfades.** Der oben verlangte Lauf existiert jetzt als `r11-cdp.ps1` — zeichengleich mit
> `r11-disc`, geändert ist **nur** der Schreibweg bei laufender App (`H-EDIT-CDP` über
> `app.vault.modify` statt `[IO.File]::WriteAllText`). Ergebnis an zwei echten Obsidian-Instanzen:
>
> | | `r11-disc` (extern) | `r11-cdp` (im Prozess) |
> | --- | --- | --- |
> | Verdict | FAIL, 8 Asserts rot | **PASS, 46 Asserts grün** |
> | `A-A-zeile-1x-{0,1,2}` | 0 / 0 / 0 | **1 / 1 / 1** |
> | `B-A-zeile-1x-{0,1,2}` | 0 / 0 / 0 | **1 / 1 / 1** |
> | `kontrolle-merge-kommt-an` | False | **True** |
> | Konvergenz | — | 1 Runde, beide Vaults byte-gleich |
>
> **Der Lauf trägt seinen eigenen Diskriminator:** `sidecar-ohne-park-frist` misst die Zeit vom
> Schreibvorgang bis zur Hilfsdatei und verlangt < 30 s — über den Park-Pfad wären es mindestens
> 120. Er ist grün, also misst dieser Lauf den Erfassungspfad und nicht den Nachtrag nach
> Fristablauf. Ohne ihn wäre ein grünes Ergebnis nicht von „es lief gar nichts" zu unterscheiden.
>
> **Die Einschränkung, ausdrücklich:** Alle drei Versuche melden `leg=writeback`, keiner
> `leg=vorlauf`. Geprüft ist damit **Hälfte 1** von Task 16 (der Write-Back im modify-Pfad feuert),
> **nicht Hälfte 2** (der Doc läuft der Datei voraus). Der Grund ist strukturell: Im Prozess entsteht
> die Sidecar in Millisekunden — gemessen 162 bis 209 ms zwischen Zustellung und erstem Edit —, und
> so kurz hält der Vorlauf-Zustand nicht an. **Der Umbau hat den Runner grün gemacht und dabei einen
> Teil seines Szenarios verschoben.** Wer Hälfte 2 prüfen will, braucht einen Aufbau, der den
> Vorlauf künstlich offen hält.
>
> Zwei Funde am Apparat, beide beim ersten Lauf überhaupt: `Obsidian.exe` wurde nicht gefunden, weil
> die Suche nur `%LOCALAPPDATA%\Obsidian` kannte und der Installer per-user unter
> `%LOCALAPPDATA%\Programs\Obsidian` ablegt (behoben). Und die Kommandozeile an `node.exe` trug
> Nicht-ASCII codepage-abhängig — vier Umlaute kamen als neun Zeichen an. Die Längenprüfung in
> `H-EDIT-CDP` hat es gefangen; ohne sie hätte der Lauf einen Textfehler des Plugins gemeldet, den
> es nicht gibt. Behoben durch `\uXXXX`-Escaping der gesamten Übergabe.

**Bis die Wächter-Ursache gefunden oder die Timeouts der sieben alten Runner angehoben sind, sagt
die Batterie über Regressionen nichts.**

**Was ungemessen bleibt:** N ≥ 5, große Notizen, `mdModus: 'ueberschreiben'`, der Sweep
(`QOLLAB_SWEEP_SCHRANKE` ist im Apparat weiterhin wirkungslos), und die inhaltliche Regression der
sieben blockierten Runner.

### Wie der Befund zustande kam (Zwischenstände)

Strenger Grundtext-Verlust (eine Zeile des Ausgangstextes fehlt am Ende), Zellbasis je Lauf
40 Seeds × 10 Notizen × 8 Basiszeilen = 3.200 Zeilen, Mittelwert (Spanne):

| Apparat-Stand | N = 2 | N = 3 | N = 4 |
| --- | --- | --- | --- |
| Bundle vor dem 05.08. (n = 15) | 0 (0–0) | 7,1 (3–16) | 27,7 (11–37) |
| ohne `noteLocalDiffBase` (n = 13) | 0 (0–0) | 4,6 (2–9) | 19,7 (9–30) |
| mit `noteLocalDiffBase` (n = 3/6/5) | 0 (0–0) | 2,0 (1–3) | 8,0 (3–11) |
| mit Herkunftstor (n = 3/5/5) | 0 (0–0) | 0 (0–0) | 1,2 (1–2) |
| **mit `diffModus = 'zeile'`** (200 Seeds × 3 Familien) | **0** | **0** | **0** |

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

### Was ab vier Geräten übrig bleibt: eine nicht-idempotente Ersetzung

Eine **dritte** Untervariante, zerlegt am 2026-08-09. Sie entsteht aus zwei Ereignissen, die
**einzeln harmlos** sind:

1. **Tor-Kollision.** `WriteProvenance.istEigen` (`src/write-provenance.ts:141-155`) prüft reine
   **Inhaltsgleichheit**. Eine per Sync gelieferte `.md`, die byte-identisch mit dem eigenen
   letzten Schreibstand ist, passiert das Herkunftstor als „eigen". Ist der Doc inzwischen über den
   `.yjs`-Kanal vorausgelaufen — ohne dass ein `.md`-Write die Schreibspur nachzieht, denn
   `resolveParked` schreibt nicht zurück —, wird die veraltete `.md` als **lokale Rücknahme**
   gedeutet.
2. **Zeilenkreuzende Ersetzung.** `CrdtManager.setContent` (`src/crdt-manager.ts:264`, Op-Folge aus
   `diffOps` `:291`) rechnet daraus eine Zeichen-Ersetzung:

       ="n5-base-0|n5-"  -"D3-9|n5-base-1|n5-D3"  +"base"  ="-1|n5-base-2|"

   Die DELETE-Op verschluckt die unbeteiligte Grundtextzeile, die INSERT-Op schreibt ihre Mitte als
   **neues Item** zurück.

Für sich ist das textneutral. Der Schaden entsteht, weil es **nicht idempotent** ist: Rechnen
mehrere Geräte dieselbe Ersetzung unabhängig, verschmelzen die DELETE-Hälften, und die
INSERT-Hälften **stapeln sich**. **Ohne jeden Harness reproduzierbar** (`probe-idempotenz.mjs`,
nur `CrdtManager`):

| Replikate, die dieselbe Ersetzung rechnen | Ergebnis | Zeile da? |
| --- | --- | --- |
| 1 | `n5-base-0 \| n5-base-1 \| n5-base-2` | ja |
| 2 | `n5-base-0 \| n5-**basebase**-1 \| n5-base-2` | **nein** |
| 3 | `n5-base-0 \| n5-**basebasebase**-1 \| n5-base-2` | **nein** |

Die Konvergenz bleibt dabei durchgehend intakt — genau der Fall, vor dem dieses Dokument warnt.

**Warum erst ab vier Geräten:** Nicht die Gerätezahl ist die Bedingung, sondern die **Konjunktion**.
Über je 200 Seeds (16.000 Grundtextzeilen), DET = 42:

| N | Mehrfach gerechnete Ersetzungen | zeilenkreuzende | **beides zugleich** | **Verlust** |
| --- | --- | --- | --- | --- |
| 2 | 0 | 0 | 0 | 0 |
| 3 | 19 | 1 | 0 | 0 |
| 4 | 60 | 9 | **2** | **2** |

`Verlust = beides zugleich` in jeder Zelle. Bei N = 2 ist die Klasse **strukturell aus** (ein
einziger Peer, keine unabhängige Mehrfachrechnung). **Bei N = 3 ist sie latent, nicht
ausgeschlossen** — beide Zutaten kommen einzeln vor, in 200 Seeds nur nie am selben Tripel.
Strukturell sind drei Geräte das Minimum: eines läuft voraus, zwei rechnen dieselbe Rücknahme.

> [!warning] Nachtrag 2026-08-14 — die Gerätezahl ist nicht die Bedingung (`T-09`)
> **Der Satz „bei N = 2 strukturell aus" gilt für die hier gemessene Zelle, nicht für die
> Schadensklasse.** Am Realtest `r14-cdp` tritt dieselbe Mechanik bei **N = 2** auf, und sie ist
> harness-frei reproduzierbar (`spike/duplikat-mb/r14-ursache.mjs`, byte-gleich mit dem Endtext
> des Laufs).
>
> Die eigentliche Bedingung ist, ob der gemeinsame Stand auf einem **Zeilenumbruch endet**.
> `diff_linesToChars_` tokenisiert *inklusive* Zeilenende: `"BBB"` und `"BBB\n"` sind verschiedene
> Tokens. Fehlt der Schluss-Umbruch, ist die letzte Zeile beim nächsten `setContent` keine
> unberührte Zeile mehr, sondern eine **geänderte** — und `diffOps` löst sie als DELETE + INSERT
> auf. Hängen zwei Geräte unabhängig je eine Zeile an, verschmelzen die DELETE-Hälften und die
> INSERT-Hälften stapeln sich: Die letzte Zeile steht danach **zweimal**.
>
> Es braucht dafür **kein** vorauslaufendes drittes Gerät und keine Rücknahme — nur zwei Geräte,
> die anhängen. **In Obsidian ist der fehlende Schluss-Umbruch der Normalfall.**
>
> Warum die Tabelle oben das nicht zeigt: `probe-idempotenz.mjs` kann die Lage strukturell nicht
> erzeugen — seine Texte enden ausnahmslos auf `\n` (`.join(NL) + NL`). Zehnter Fall eines
> nachweislich blinden Messinstruments in diesem Projekt.

**Zwei Hebel wurden gebaut und gegeneinander gemessen** (je 200 Seeds, drei Seed-Familien):

| N = 4, DET = 7 | Grundtext weg | Textverlust gesamt | Verdopplung |
| --- | --- | --- | --- |
| Bestand | 1 | 101 | 904 |
| **A — zeilentreue Ops** | **0** | 96 | 913 |
| B — schärferes `istEigen` | 1 | **65** | 920 |
| A + B | **0** | **60** | 930 |

**A ist eingebaut** (`diffModus = 'zeile'`, Commit `82c5426`). Er ist der einzige Hebel, der die
Kopplung `Verlust = (mehrfach ∧ zeilenkreuzend)` **bricht**: Die Vorbedingung tritt unverändert oft
ein, sie ist nur nicht mehr schädlich. Und seine Wirkung ist **ohne Harness als Eigenschaft**
nachweisbar, nicht nur als Rate.

**B ist nicht eingebaut und bleibt offen.** Er senkt den Textverlust deutlich stärker (−33 bis
−55 %), löst K.o.-Kriterium 1 aber nur in einer von drei Seed-Familien. Zwei Dinge sind vor einem
Einbau zu klären: Im echten Plugin liegt zwischen `merke()` und `istEigen()` das
`pathQueue`-Fenster (`main.ts:302-344`), im Messapparat folgt der Vergleich synchron — **B würde
real mehr Fehlparkungen erzeugen als gemessen.** Und die Doc-Marke müsste ein Hash sein, kein
voller Doc-Text (der Grund, aus dem `MAX_STAENDE = 1` gilt).

> [!warning] Nachtrag 2026-08-15 — der Absatz oben ist überholt (`M-06`)
> **Die Tabelle darüber vergleicht gegen einen Bestand, den es nicht mehr gibt.** Ihre Zeile
> „Bestand" ist `modus=zeichen` vom 2026-08-09, also vor `T-04`, `T-05`, `T-07`, `T-08` und
> `T-09`. Am heutigen Bundle liefern `zeichen` und `zeile` **zahlengleiche Zeilen** — Hebel A ist
> eingebaut, der Spike-Prototyp bewirkt nichts mehr. Und **WEG = 0 steht schon im Bestand**, in
> allen drei Seed-Familien: der Satz „löst K.o.-1 nur in einer von drei" beschrieb einen Bestand,
> der selbst 1/2/1 Zeilen verlor, und ist gegenstandslos.
>
> **Der Vorbehalt ist jetzt gemessen — mit der echten `PathQueue` zwischen `merke()` und
> `istEigen()` und der Handler-Laufzeit als Regler** (200 Seeds × 3 Familien, N = 4, gepaart,
> alles außer dem eigenen Handler läuft prompt):
>
> | Umordnungsrate | Verlust Bestand | Verlust Hebel B | Δ | Divergenz | fehlgeparkt |
> | --- | --- | --- | --- | --- | --- |
> | 0,4 % | 95 | 62 | **−34,7 %** | 0 | 31 |
> | 2,1 % | 153 | 111 | −27,5 % | 0 | 152 |
> | 4,0 % | 323 | 296 | −8,4 % | 0 | 270 |
> | 7,0 % | 677 | 647 | −4,4 % | 0 | 429 |
>
> **Der Gewinn hält, er schrumpft nur** — und wird nie negativ. Grundtextverlust und Divergenz
> bleiben 0 in allen 30 Zellen, auch bei 451 Fehlparkungen.
>
> **Die Fehlparkung ist dabei vollständig**, nicht „mehr als gemessen": 31 von 31, 100 von 102,
> 270 von 298 überholten eigenen Bearbeitungen. Das ist eine Eigenschaft der Regel —
> Tor-Kollision und Fehlparkung sind am Doc-Stand nicht unterscheidbar, beide Male steht unser
> Text in der `.md` und der Doc ist seit unserem Write vorausgelaufen. Verschieden ist allein die
> **Reihenfolge**, und die trägt der Doc-Stand nicht. **Damit erledigt sich auch die Hash-Frage:**
> ein Hash ist dieselbe Vergleichsregel in billig.
>
> **Sie kostet trotzdem nichts.** Ein geparkter Stand hat einen billigen Rückweg: 59,5–89,3 %
> der Parkvorgänge enden, indem die Historie eintrifft und den Stand deckt (`resolveParked`,
> keine Op). **Als Ursache ist das nicht belegt** — die Spanne widerspricht der einfachen
> Lesart, sie ist bei kleiner Verzögerung am schlechtesten und in der Mitte am besten.
>
> **Was vor einem Einbau fehlt, ist genau eine Zahl:** die Umordnungsrate im Feld. Unter ~2 % ist
> B klar im Plus, über 4 % nicht mehr. Sie hängt an Plattenlatenz, Notizgröße und Sync-Intervall
> und ist im Apparat nicht zu gewinnen.
>
> **Selbstkorrektur derselben Session:** Ein erster, frei laufender Arm (nichts wird je
> abgewartet) zeigte B als gebrochen (328 → 345, Divergenz 8 → 33). Er hält nicht — er
> verschlechtert den **Bestand** von 95 auf 328 und misst damit sich selbst. **Warum dort
> zusätzlich Divergenz entsteht, ist offen**; die naheliegende Erklärung über abgelaufene
> Parkvorgänge ist nachgerechnet und trägt nicht. Voller Bericht:
> `obsidian-qollab-doku/sdd/m06-pathqueue-2026-08-15.md`.

Die beiden früher gemessenen Untervarianten (verschobener Fuzzy-Hunk in `patch_apply`; DELETE-Op
über die Zeilengrenze) verschwinden mit dem Herkunftstor und sind an dieser dritten **nicht**
beteiligt: `mergeForLocalDiff` liefert hier exakt den `.md`-Text zurück, es gibt keinen verschobenen
Hunk.

Der Verlust **wandert nicht** nach `tickParked`, wie vermutet: Von 191 `tickParked`-Läufen bei
N = 3 enden nur 4 im `unionMerge`-Nachtrag, und davon **0** mit toter Grundtextzeile. Die 24
Fälle aus der Aktenlage sind damit erstmals messbar — und dabei nicht aufgetreten. Weder bestätigt
noch für alle Lagen entkräftet.

### Ein Produktivcode-Befund am Rand

`flushParked` (`src/sync-handler.ts:424`) hat **repoweit keinen Aufrufer** — nachgeprüft, es gibt
nur die Definition. Sein eigener Kommentar verspricht, beim Abschalten des Plugins jeden geparkten
Stand nachzutragen; `onunload` (`main.ts:1623-1631`) ruft ihn nicht.

**Eingeordnet am 2026-08-12 — im Normalfall kostet das keine Daten.** Der Parkplatz ist rein
in-memory (`sync-handler.ts:365-370`), und der Text steht ja weiterhin in der `.md` auf der Platte.
Beim nächsten Start greift keine der beiden Abkürzungen des Sweeps: der Merker nicht (der
Fremd-Write hat mtime/size der `.md` geändert), die mtime-Prüfung nicht (die eigene Hilfsdatei
wurde seit dem Parken nicht geschrieben, ist also älter). Der Text läuft damit durch
`applyLocalContent` und wird erfasst. Genau das sagt der Code selbst zu: „*Nach einem Neustart ist
ein Parkplatz weg, und der Startup-Sweep erfasst die Datei wie bisher — Bestandsverhalten.*" Preis
ist das Bestandsverhalten (verliert nie, verdoppelt genau einmal sichtbar), nicht Verlust.

**Ein Verlustpfad bleibt in einer Teillage:** Wurde nach dem Parken die **eigene Hilfsdatei**
geschrieben — was der Normallauf tut, `saveState` (`sync-handler.ts:1962`) steht **vor**
`resolveParked` (`:1972`) —, ist ihre mtime jünger als die der `.md`. Dann greift die
mtime-Abkürzung `main.ts:1320` (`stat.mtime >= file.stat.mtime` → `continue`), die Notiz wird
übersprungen, und der erste Write-Back danach überschreibt die `.md` mit dem Doc-Stand: der fremde
Text ist auch von der Platte weg. **Ungemessen** — es gibt keinen Test, der Parkplatz und Neustart
verbindet (`parken-fremder-md.test.ts` bleibt in einer Sitzung, die Neustart-Tests parken nichts).

Ein Aufruf in `onunload` ist **nicht** der naheliegende Fix: `onunload` ist synchron, `flushParked`
ist langlaufend und schreibend (Sicherungskopie plus `writeBinary` je Notiz), es umgeht die
`PathQueue`, und `disposeAll()` zieht ihm die Y.Docs weg. Die Teillage oben ist die eigentliche
Adresse.

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

### Der Ort, erschöpfend zerlegt (2026-08-12)

**Der Befund oben ist bestätigt und präzisiert — Ort und Ursache sind zu trennen.** Die Vault-Note
nennt als Quelle bereits „das Aneinanderhängen zweier Op-Ketten gleicher Kennung
(`mergeCompatible → applyUpdate`)" und die Materialisierungen als deren **Zulieferer**. Genau diese
Arbeitsteilung ist jetzt quantifiziert: Der Doc-Text kann sich nur auf zwei Wegen ändern —
`setContent` (setzt exakt den übergebenen Text) oder `applyUpdate` (Yjs-Merge einer fremden
Sidecar). Beide Wege wurden instrumentiert und die Zunahme der Zeilen-Mehrfachnennung je Aufruf
gezählt (`spike/verdopplung/herkunft.mjs`, 200 Seeds, DET = 42):

| Zelle | `verdopp` (Gerät 0) | über `setContent` | über `applyUpdate` | `applyUpdate` ÷ Geräte |
| --- | --- | --- | --- | --- |
| N = 4, `kopie` | 845 | **14** | **3.378** | 844,5 |
| N = 5 | 1.557 | 20 | 7.823 | 1.564,6 |
| N = 6 | 2.401 | 60 | 14.480 | 2.413,3 |
| N = 4, `ueberschreiben` | 1.056 | 56 | 4.352 | 1.088,0 |

Die Division durch die Gerätezahl trifft den gemessenen Endwert in allen vier Zellen — **rund 99 %
der Verdopplung wird in `CrdtManager.applyUpdate` sichtbar.** Das ist der **Ort**, nicht die
Ursache: Yjs dedupliziert nach Item-ID, nicht nach Inhalt, und trägt beim Merge zusammen, was
vorher entstanden ist. Die **Ursache** ist, dass **derselbe Inhalt auf mehreren Geräten unabhängig
als eigene Ops materialisiert wird** — die Note nennt das den Zulieferer, und `setContent` erzeugt
diese Ops, ohne dass beim Erzeugen schon ein Duplikat entstünde (daher die kleinen `setContent`-
Zahlen: das Duplikat wird erst drüben sichtbar).

**Praktische Folge für die Suche nach einem Hebel:** An `applyUpdate` selbst ist nichts zu holen —
dort ist der Text schon doppelt vorhanden, und Löschen propagiert (siehe „Weglassen statt Löschen"
in der Vault-Note: 2,8–50,7 % stiller Verlust). Der Hebel muss **vor** der Materialisierung
greifen.

**Harness-frei reproduzierbar** (`spike/verdopplung/minimal-crdt.mjs`, fährt den echten
`CrdtManager`):

    A = "a\n", B = "a\n"  (byte-gleich, KEIN gemeinsamer Vorfahr)
    A.applyUpdate(B)  ->  "a\na\n"

    Gegenprobe MIT gemeinsamer Historie  ->  "a\nb\n", keine Verdopplung

**Damit zeigt ein dritter, unabhängiger Weg auf denselben Hebel:** Punkt 1 und 2 unter „Offene
Widersprüche" kamen über die Löschsemantik zum Erstkontakt, dieser Befund kommt über die
Verdopplung. **Der Erstkontakt ohne gemeinsame Historie ist die Adresse der größten Fehlerzahl des
Projekts.**

**Die drei anderen Kandidaten sind gemessen ausgeschieden:**

| Kandidat | Wirkung auf `verdopp` |
| --- | --- |
| `diffModus` (`setContent`) | **flach**: `roh` +0,03 %, `semantisch` −1,2 % — kostet dafür Grundtext (`WEG` 0 → 50 bzw. 20) |
| `unionMerge` | **0,84 %** (49 von 5.859 über vier Zellen); erzeugt über 192.833 Aufrufe selbst nur 872 Doppel |
| `threeWayMerge` | 50 Doppel — noch darunter |
| Herkunftstor schärfen (Hebel B) | **1,6 %** |

**Und der Schaden ist milder als die Zahl vermuten lässt** (`spike/verdopplung/stellen.mjs`,
40 Seeds): Die Doppel stehen **einsortiert**, nicht angehängt — 78 % unmittelbar unter dem Original,
der Rest bis Abstand 3, nur 6 % in einem wiederholten Schlussblock. **Grundtext wird nie
verdoppelt** (0 von 358); betroffen sind ausschließlich Bearbeitungs-Tokens. Typischer Endstand bei
N = 4:

    n1-D0-9
    n1-D2-9      <- je einmal pro Gerät, das den Token
    n1-D2-9         unabhängig materialisiert hat
    n1-D2-9
    n1-base-4

**Nicht gemessen:** Die Zerlegung läuft auf vier der acht Zellen (5.859 der 9.982); die
Großnotiz-Zellen sind nicht enthalten. Und dass die mehrfachen Kopien von verschiedenen Client-IDs
stammen, ist aus dem Muster erschlossen und am Minimalbeispiel gezeigt — **nicht** an den echten
Yjs-Items nachgezählt.

### Die Tür: 81,5 % sitzen in einer Zeile (2026-08-12)

Es gibt repoweit genau **drei** Aufrufstellen von `setContent` — nachgezählt, nicht vermutet:
`ensureDoc` (`sync-handler.ts:1307`), `switchToGuid` (`:1454`), `applyLocalContent` (`:1703`).
Start-Sweep, `unite` und `tickParked` sind keine eigenen Türen, sondern Einstiege, die über diese
drei laufen.

Jede Tür wurde einzeln unterdrückt und der Effekt gemessen (`spike/verdopplung/aufrufstelle.mjs`,
je 200 Seeds, DET = 42):

| unterdrückte Tür | `verdopp` Z0 | Δ | Aktivität des Arms |
| --- | --- | --- | --- |
| — (Basis) | 845 | — | — |
| `ensureDoc:1307` | **845** | **0 %** | feuert: 11.950 gestrichene Zeilen |
| `switchToGuid:1454` | **111** | **−86,9 %** | 432 gestrichene Zeilen |
| `applyLocalContent:1703` | 1.043 | **+23,4 %** | 227 gestrichene Zeilen |

Über alle vier Zellen für `switchToGuid`:

| Zelle | `verdopp` Basis → unterdrückt | `verlust` Basis → unterdrückt |
| --- | --- | --- |
| Z0 N=4 `kopie` | 845 → 111 | 103 → **123** |
| Z1 N=5 | 1.557 → 237 | 153 → 153 |
| Z3 N=6 | 2.401 → 411 | 226 → 217 |
| Z6 N=4 `ueberschreiben` | 1.056 → 323 | 277 → 267 |
| **Summe** | **5.859 → 1.082 (−81,5 %)** | **759 → 760 (+1)** |

**Der Mechanismus steht im Code und ist dort auch benannt.** Das Gate bei `:1444` lautet
`if (winnerText === localText) return;` — es greift nur bei **byte-identischem** Text. Bei jeder
Abweichung wird die ganze Vereinigung als frische Ops **dieses** Geräts materialisiert
(`:1454`, `setContent(unite(winnerText, localText))`), und der Kommentar darüber sagt den Preis
selbst: „*der lokale Beitrag zählt danach als frische Einfügung dieses Geräts*". Jede Zeile darin,
die der Gewinner bereits trägt — nur an anderer Position —, ist ein künftiges Duplikat.

**Zwei methodische Punkte, die für künftige Messungen zählen:**

1. **Der naheliegende Indikator rankt falsch.** Zählt man ungefiltert, wie viel Text eine Tür
   einfügt, der beim Peer schon steht, führt `ensureDoc` mit 87 % — es ist aber **kausal inert**:
   11.950 gestrichene Zeilen ändern `verdopp`, `verlust` und `applyPlus` um **kein einziges
   Zählwerk**. Was der Adopt-Zweig materialisiert, sammelt der Tie-Break ohnehin wieder ein. Erst
   nach Herausrechnen des Grundtexts sagt der Indikator das Ergebnis voraus (84,7 % gegen gemessene
   86,9 %). Ohne die Gegenprobe wäre die falsche Tür bearbeitet worden.
2. **Unterdrücken kann schaden.** Der `applyLocalContent`-Arm hebt `verdopp` um 23 % und `verlust`
   um 33 %; „alle drei" kostet `verlust` 103 → 235. Nur `switchToGuid` ist in der Summe neutral —
   **aber nicht kostenfrei**: Auf Z0 steigt `verlust` von 103 auf 123 (+19 %), auf Z3/Z6 sinkt er.

**Was das NICHT ist: ein Fix.** Der Messarm benutzt den Doc-Stand *anderer* Geräte, den ein echtes
Gerät nicht hat — er zeigt das Potenzial, nicht den Weg.

### Das naheliegende Gate ist gefallen — die Verdopplung ist der Preis der Urheberschaft (2026-08-12)

Der naheliegende Eingriff war: ein rein **lokales, zeilenweises** Gate an `switchToGuid`, das nur
materialisiert, was `winnerText` nicht schon trägt. `winnerText` steht dort lokal zur Verfügung.
**Er ist gemessen gefallen, und der Grund ist strukturell — er trifft jeden Ansatz dieser Bauart.**

**Der Mechanismus** (harness-frei nachvollziehbar, `spike/gate-widerlegung/probe-aliasing.mjs`):

    winnerText = b0 b3 b2          localText = b0 b1 A1 b2 b3

    OHNE Gate   Ziel: b0 b3 b1 A1 b2 b3   -> b3 zweimal: einmal als Item des
                                             Gewinners, einmal als frische Op
                                             des Verlierers
                Gewinner löscht sein b3  -> b0 b1 A1 b2 b3   lokaler Stand lebt

    MIT Gate    Ziel: b0 b3 b1 A1 b2     -> b3 nur noch als Gewinner-Item
                derselbe Delete          -> b0 b1 A1 b2      lokaler Beitrag TOT

**Das Gate lässt eine lokale Zeile weg, *weil* der Gewinner-Doc dafür schon ein Item trägt — und
aliasiert damit den eigenen Beitrag auf ein fremdes Item.** Ab da tötet ihn jeder gewöhnliche Delete
oder Edit auf dem Gewinner-Gerät, der mit dem lokalen Inhalt nie etwas zu tun hatte. Das Löschen ist
in Yjs monoton und propagiert auf alle Geräte; der Endstand bleibt konvergent, der Verlust ist also
**still**.

**Nutzenmenge und Gefahrenmenge sind identisch.** Von 3.348 weggelassenen Vorkommen war **null**
ohne Gewinner-Item — es gibt keine sichere Teilmenge des Eingriffs. Gepaart gemessen (4.000 Seeds,
identisches Szenario je Arm): Grundtextzeilen, die nach einem späteren Delete auf 0 Vorkommen
fallen — **ohne Gate 1.536, mit Gate 2.187 (+42 %)**. Der Tausch lautet damit: −0,84 % sichtbare
Verdopplung gegen **+42 % stillen Grundtextverlust**, also K.o.-Kriterium 1.

> **Die Verdopplung, die das Gate entfernt, ist nicht Rauschen — sie ist der Träger der lokalen
> Urheberschaft.** Das zweite Vorkommen einer Zeile ist die einzige Kopie, die dem Verlierer-Gerät
> gehört. Wer es einspart, gibt seinen Beitrag in fremde Hand.

Das erklärt zugleich den Vorbefund „Grundtext wird nie verdoppelt, betroffen sind ausschließlich
Bearbeitungs-Tokens": Genau diese Tokens sind der lokale Beitrag, und ihre Doppelung ist das, was
ihn überleben lässt.

**Ein zweiter Entwurf — den lokalen Beitrag als Yjs-Update übertragen statt zu materialisieren —
fiel härter:** Das Rest-Update trägt ein **Delete-Set** über die Item-IDs der Verlierer-Kette. Teilen
zwei Geräte dieselbe Verlierer-Inkarnation (der Normalzustand jedes konvergierten Paars, hergestellt
von `mergeCompatible`), löscht das zweite Gerät genau die Items, die im Gewinner-Doc **leben**.
Gepaart gemessen: **1.134 von 1.134 Grundtextzeilen verloren (100 %), 200 von 200 Notizen**,
konvergent und damit still.

**Der lehrreichste Teil ist, warum das keiner Messung auffiel:** `spike/schnitt/schnitte.mjs` prägt
je Notiz und Gerät genau **einmal** eine eigene zufällige Kennung — alle Verlierer-Ketten des
Apparats sind gerätprivat und disjunkt. Ein konvergiertes Paar trifft dort **nie** auf einen
Nachzügler. Die Null, die der Entwurf gemessen hatte, war eine Eigenschaft des Szenariogenerators,
nicht des Entwurfs. Und die Wächter blieben grün, weil sie zwei getrennte `CrdtManager` benutzen —
**ein grüner Wächter über einer gebrochenen Zusage.**

**Was die Kartierung noch ergab** (gemessen über Coverage, nicht geschätzt):

- `switchToGuid` wird über die volle Suite **24×** betreten (18× davon bis `:1454`); genau **zehn**
  Testdateien erreichen es, ihre Einzelzähler summieren sich exakt auf die Suite-Summe.
- **Der einzige Test, der die Zielschadensklasse abbildet, pinnt den Schaden statt ihn zu
  verbieten:** `erstkontakt-duplikat.test.ts:102` erwartet `toBe(2)`.
- **Und ein zeilenweises Gate könnte genau diesen Fall gar nicht treffen** — der Test baut einen
  veralteten Gewinner-Stand, in dem das duplizierte Token gar nicht vorkommt.
- Das bestehende Hash-Gate bei `:1444` ist **ohne gemessene Wirkung**; `hash-gate.test.ts` sagt das
  selbst („Die Mutationsprobe (Gate entfernt) lässt die Tests dieser Datei GRÜN").
- **Keine Löschsemantik ist an dieser Stelle in Gefahr:** `unionMerge` kann per Konstruktion nichts
  entfernen, und der Löschsemantik-Wächter des Projekts betritt `switchToGuid` nie (0 Eintritte).
- **Testlücke:** Alle zehn Dateien arbeiten mit ein bis drei verschiedenen, nicht-leeren Zeilen —
  keine Leerzeile, keine wiederholte Zeile, kein CRLF, kein BOM, kein Frontmatter, kein Fall mit
  mehr als zwei Geräten.

**Folge für die Kandidatenlage:** Der Eintrag „an der Materialisierung ansetzen" ist damit **nicht
mehr offen**, sondern in seiner naheliegenden Form gefallen. Ein dritter Entwurf (`unite` selbst
ändern) hat **kein Urteil** — sein Prüflauf scheiterte technisch. Er ist aber derselben Bauart und
stünde unter demselben Einwand.

#### Nachtrag: die Aliasierung steht bereits im heutigen Stand

**Die Formulierung „die Verdopplung ist der Träger der Urheberschaft" ist richtig, aber sie darf
nicht als „ohne Gate ist der Beitrag sicher" gelesen werden.** Beim Bau der Wächter fiel auf — und
ist harness-frei nachgeprüft (`spike/gate-widerlegung/probe-head-aliasing.mjs`) —, dass dieselbe
Aliasierung **ohne jedes Gate** eintritt, sobald `unionMerge` eine Zeile gar nicht erst verdoppelt:

    Vorlage der Widerlegung   winner "b0 b3 b2"           local "b0 b1 A1 b2 b3"
      -> Vereinigung trägt b3 ZWEIMAL -> Gewinner löscht sein b3 -> Beitrag lebt

    Gewöhnliche Vorlage       winner "# Notiz / nur auf C / gemeinsam"
                              local  "# Notiz / nur auf A / gemeinsam"
      -> Vereinigung trägt „gemeinsam" EINMAL -> Gewinner löscht es -> **Beitrag tot**

Der Unterschied ist die **Ausrichtung des Zeilen-Diffs**: Steht die gemeinsame Zeile auf beiden
Seiten an derselben Stelle, erkennt `unionMerge` sie als gleich und erzeugt kein zweites Item; das
Verlierer-Gerät hat dann keine eigene Kopie.

**Was das für die Bewertung heißt — zwei Fälle, die auseinanderzuhalten sind:**

- **Gemeinsame Zeile, gemeinsam gelöscht** (der Fall oben): Nach dem Wechsel teilen beide Geräte
  die Historie, ein Delete propagiert. Das ist erwartetes CRDT-Verhalten, kein Fehler — auch wenn
  es für den Nutzer auf dem Verlierer-Gerät wie ein Verlust aussieht.
- **Eigener, exklusiver Beitrag aliasiert** (der Gate-Fall): Eine Zeile, die nur der Verlierer an
  dieser Stelle beigetragen hat, wird auf ein fremdes Item gelegt. Das ist der Schaden, den die
  +42 % messen.

Die gepaarte Messung (4.000 Seeds, +42 %) bleibt damit gültig: Das Gate **vergrößert** die Menge der
kollabierten Zeilen erheblich. Es **schafft** das Phänomen aber nicht.

#### Die Rate, gemessen — und warum die naheliegende Zahl nichts aussagt (2026-08-12)

Gemessen wurde nicht über den Diff, sondern **am Yjs-Item**: Nach dem Wechsel trägt der Doc genau
zwei Sorten Items — die per `applyUpdate` eingespielten Gewinner-Ops und die Ops, die `setContent`
gerade erzeugt hat. Jede Ergebniszeile wurde ihrem Einfüger zugeordnet
(`spike/aliasierung/besitz.mjs`, Z0/Z1/Z3/Z6, je 200 Seeds, DET = 42). Das ist Grundwahrheit statt
Stellvertreter; die Kalibrierung reproduziert `ruf`, `neu`, `verdopp` und `verlust` in allen vier
Zellen ziffernidentisch.

**Die rohe Zahl lautet 84,5 % (95.091 von 112.598) — und sie ist wertlos.** Eine adversarische
Gegenprüfung hat gezeigt, warum: Der Grundtext macht **exakt 8,0000** Zeilen je Aufruf aus
(11.815 × 8 = 94.520, Rest 0) — das ist wörtlich der Startwert `SPIKE_BASELINES=8`. Die Rate ist
damit eine Ablesung am Parameter, keine Eigenschaft des Systems. Nachgefahren mit anderer
Notizgröße: **`basis=2` → 58,3 %, `basis=8` → 84,6 %, größer → 95,6 %.**

**Was die Aufschlüsselung dagegen hergibt** (Summe über vier Zellen, Bezug jeweils die lokal
materialisierten Vorkommen dieser Zeilenart):

| Zeilenart | ohne eigene Kopie | Anteil |
| --- | --- | --- |
| Grundtext | 94.520 von 94.520 | **100 %** |
| Token eines fremden Geräts | 500 von 5.282 | 9,5 % |
| **Token des eigenen Geräts** | **71 von 12.796** | **0,55 %** |

Der Grundtext liegt per Konstruktion auf beiden Geräten identisch — das ist der Fall „gemeinsame
Zeile, gemeinsam gelöscht", also erwartetes CRDT-Verhalten. **Der eigene Beitrag bekommt in
99,45 % der Fälle eine eigene Kopie.** Die 71 Ausnahmen wurden im Klartext geprüft: Der Token stand
dort jeweils **bereits im `winnerText`** — eine weitergereichte Kopie desselben Beitrags, kein
zweiter unabhängiger.

**Die härteste Einschränkung, ausdrücklich:** Der eigentliche Schadensfall — eine Zeile, die *nur*
das unterlegene Gerät an dieser Stelle beigetragen hat — ist im Apparat **nicht herstellbar**.
`buildScenario` (`spike/schnitt/harness.mjs:141-150`) vergibt jeden Token genau einmal an genau ein
Gerät, der Grundtext kommt byte-identisch auf jedes. Jeder Zeileninhalt hat damit genau **eine**
Herkunft. Die 0,55 % sind deshalb die schärfste Näherung, die dieser Apparat zulässt — kein Beweis
der Abwesenheit.

**Ist der Schaden erreichbar?** Ja, aber die Kette braucht **sechs** Bedingungen, jede am Code oder
gemessen belegt: (B1) Inkarnationsspaltung auf dieser Notiz; (B2) dieses Gerät ist der Verlierer;
(B3) der Beitrag ist zeichengleich mit einer Gewinnerzeile und überholt keine gemeinsame Zeile;
(B4) die Löschung kommt **nach** dem Wechsel — davor trägt `winnerText` sie nicht mehr, der Diff
sieht einen INSERT und der Verlierer bekommt seine eigene Kopie; (B5) der Verlierer fasst genau
diese Zeile bis dahin nicht an — **ein Edit darauf heilt den Alias vollständig**; (B6) es existiert
ein Delete auf dieses Item.

**Einordnung: erreichbar ja, häufig nicht belegt.** Zwei der sechs Glieder heilen sich im normalen
Gebrauch von selbst (B4, B5). Wer aus der rohen Rate eine Schadensrate macht, überschätzt sie um
den Faktor 1.339 (Mengen) bzw. 152 (Raten).

**Was diese Messung nicht entscheidet:** ob eine aliasierte Grundtextzeile nach einem späteren
Delete tatsächlich fällt — die 94.520 sind die *Population*, aus der die früher gemessenen 1.536
gefallenen Zeilen stammen können, nicht die Schadensmenge. Und die Spalte „mit eigener Kopie" ist
nicht gleich „unschädlich": **41,4 % davon** sind die Verdopplungsklasse des Projekts.

## Quellen

- `README.md` — Ist-Zustand mit Messzahlen (nutzerorientiert)
- `manifest.json` — „Automatische Merge-Konfliktlösung via Yjs CRDTs für OneDrive/SharePoint-Sync."
- `docs/superpowers/plans/2026-05-19-github-collab.md` — GitHub als ursprüngliches Zielszenario
- `obsidian-qollab-doku/sdd/` — Messhistorie und Sessionberichte bis 2026-08-04 (privates Repo).
  Hier stand `.superpowers/sdd/` (lokal, nicht versioniert); der Ordner ging beim Rechnerwechsel am
  2026-08-11 verloren, weil ein `git clone` nur Versioniertes zurückholt. Messergebnisse seit dem
  2026-08-09 liegen als Rohdaten unter `obsidian-crdt-sync/spike/` und als Befunde in diesem Dokument.
- `obsidian-qollab-doku/harness/` — der Realtest-Harness (privates Repo), rekonstruiert am 2026-08-11
- Vault: `[[CRDT-Delete-vs-Edit-Semantik]]`, `[[Per-User-CRDT-State-Files-Pattern]]`
- Till, Sitzung 2026-08-07 — die Präzisierungen in diesem Dokument
