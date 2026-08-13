# Qollab — Registratur der Versuche

> [!warning] Erzeugte Datei — nicht von Hand editieren.
> Quelle ist `docs/versuche.yaml`. Neu erzeugen mit `node docs/versuche-ansicht.mjs`.
> `tests/versuche-registratur.test.ts` prüft, dass beide übereinstimmen.

**Stand:** 2026-08-13 · **54 Versuche**

| Verdikt | Anzahl | Bedeutung |
| --- | --- | --- |
| gebrochen | 39 | aktiv schlechter oder verletzt ein Kriterium |
| eingebaut | 5 | im Produktivcode auf `master` |
| offen | 4 | gemessen, aber nicht eingebaut |
| leergelaufen | 2 | Vorbedingung trat nie ein — Rückfall aufs Bestandsverhalten, kein Schaden |
| kein Urteil | 2 | Prüfung nicht zustande gekommen |
| überholt | 2 | durch eine bessere Lösung ersetzt |

**5 Einträge sind nicht nachrechenbar** — ihre Instrumente oder Berichte existieren nicht mehr: `K-01`, `K-06`, `K-07`, `K-13`, `K-15`. Vor Zitation außerhalb des Projekts prüfen.

## Inkarnations-Kennung und Erstkontakt

| ID | Versuch | Verdikt | Kennzahl | Beleglage |
| --- | --- | --- | --- | --- |
| `K-01` | Koordination ueber den Sync (Lock, Lease, Fuehrungswahl, Wartefenster) | gebrochen | Wartefenster drueckt die Fehlerrate bei aktivem Peer auf 0,01 %, bleibt im Rollout-Fall zweistellig | **Instrument weg** |
| `K-02` | clientID konstant setzen | gebrochen | 344/400 stille Divergenz | nachlaufbar |
| `K-03` | clientID aus dem Texthash | gebrochen | 400/400 dupliziert unter realistischer Sync-Verzoegerung | nachlaufbar |
| `K-04` | Update-Bytes direkt bauen | gebrochen | keine — semantisch identisch zu K-03 | nachlaufbar |
| `K-05` | Deterministischer Genesis (Zed-Konstruktion) | leergelaufen | 8.640 Laeufe zahlengleich mit dem Bestand, in jeder Zelle beider Transportmodi | nachlaufbar |
| `K-06` | Saat-Kennung (Inkarnationskennung per FNV-1a aus dem Grundtext) | leergelaufen | Vorbedingung 0/24 im Vorabtest, 0/720 je Zelle im Projekt-Harness | **kein Bericht** |
| `K-07` | Kandidat A — Genesis-Blob mit Blob-Hash-Tie-Break | gebrochen | Verlust steigt (baselineRace 7 auf 10); Duplikate fallen in keinem Modus (16>16, 23>24, 15>19) | **Instrument weg** |
| `K-08` | Note-Kennung zur Historien-Kennung ableiten | gebrochen | Verbesserung bei 2 Geraeten, vollstaendiger Zusammenbruch bei 3 | nachlaufbar |
| `K-09` | Bibliothekswechsel (Loro, Automerge, Diamond Types, cola, json-joy, Peritext) | gebrochen | keines der sieben geprueften Systeme fuehrt inhaltsgleiche, unabhaengig erzeugte Einfuegungen zusammen | nachlaufbar |
| `K-10` | Andere Yjs-Datentypen (Y.Array, Y.Map mit Zeilen-Keys) | gebrochen | Y.Array dupliziert gleich | nachlaufbar |
| `K-11` | Nachtraegliche Deduplikation, textuell | gebrochen | konvergent, also stille Korruption | nachlaufbar |
| `K-12` | Nachtraegliche Deduplikation, strukturell | gebrochen | 88 von 130 Faellen mit Textverlust | nachlaufbar |
| `K-15` | Rueckzug plus Konfliktkopie | gebrochen | in 0 von 120 Seeds besser als der Bestand; Endtexte in 120/120 identisch | **kein Bericht** |

### K-01 — Koordination ueber den Sync (Lock, Lease, Fuehrungswahl, Wartefenster)

**Hypothese:** Ein Verfahren einigt die Geraete darauf, wer die Historie anlegt.

**Verdikt:** gebrochen · **2026-07-31**

**Kennzahl:** Wartefenster drueckt die Fehlerrate bei aktivem Peer auf 0,01 %, bleibt im Rollout-Fall zweistellig  
**Zellbasis:** Simulation, Zellbasis nicht ueberliefert

Beweisbar unmoeglich: Bis zum Ablauf des Wartefensters ist "der andere existiert nicht" von "seine Datei ist noch unterwegs" nicht zu unterscheiden, und die Verzoegerung eines Datei-Syncs ist unbeschraenkt. Erledigt die ganze Kategorie — Sperren, Leases, Fuehrungswahl.

*Beleg: Vault-Note, Abschnitt 'Koordination ist beweisbar unmoeglich' — **Instrument weg***

### K-02 — clientID konstant setzen

**Hypothese:** Gleiche Kennung auf beiden Geraeten macht die Ketten kompatibel.

**Verdikt:** gebrochen · **2026-07-31**

**Kennzahl:** 344/400 stille Divergenz  
**Zellbasis:** 400 Laeufe

Bei abweichendem Text divergieren die Geraete still — schlechter als der Bestand. Am Produktivcode reproduziert.

*Beleg: Vault-Note, Ausschlusstabelle — nachlaufbar*

### K-03 — clientID aus dem Texthash

**Hypothese:** Identitaet aus dem Inhalt statt aus einer Zufallszahl.

**Verdikt:** gebrochen · **2026-07-31**

**Kennzahl:** 400/400 dupliziert unter realistischer Sync-Verzoegerung  
**Zellbasis:** 400 Laeufe

Wirkt nur bei exakt gleichem Text. Setzt die Kennung auf ALLE Ops und kollidiert dadurch auch in den Folge-Clocks. Yjs' Autor verbietet clientID-Manipulation mehrfach ausdruecklich; es gibt bewusst keine API.

*Beleg: Vault-Note, Ausschlusstabelle — nachlaufbar*

### K-04 — Update-Bytes direkt bauen

**Hypothese:** Ein Genesis-Update deterministisch erzeugen, ohne clientID zu setzen.

**Verdikt:** gebrochen · **2026-07-31**

**Kennzahl:** keine — semantisch identisch zu K-03  
**Zellbasis:** analytisch

Ein Genesis-Update ist eine in der clientID eineindeutige Funktion. "Deterministisch ohne Kennungsfestlegung" ist ein Widerspruch in sich.

*Beleg: Vault-Note, Ausschlusstabelle — nachlaufbar*

### K-05 — Deterministischer Genesis (Zed-Konstruktion)

**Hypothese:** Ein eingefrorener gemeinsamer Startzustand gibt beiden Ketten denselben Vorfahren.

**Verdikt:** leergelaufen · **2026-08-03**

**Kennzahl:** 8.640 Laeufe zahlengleich mit dem Bestand, in jeder Zelle beider Transportmodi  
**Zellbasis:** 8.640 Laeufe

Die Konstruktion traegt technisch — der Eingriff war aktiv (bit-identische Startzustaende 0/720 auf 350/720) — und bewirkt nichts. Struktureller Grund: In Qollab treffen zwei gepraegte Ketten nie im selben Y.Doc aufeinander; mergeCompatible filtert nach GUID, der Tie-Break-Verlierer verwirft seinen Doc und bringt seinen Beitrag als Text-Diff zurueck. Die Item-ID-Identitaet hat damit keinen Angriffspunkt. Gilt auch fuer N >= 3. Nebenbefund - `new Y.Doc({clientID})` wird stillschweigend ignoriert.

*Beleg: Branch spike/genesis-determinismus, Commit 5cbcbf2; erstkontakt-synthese-2026-08-03.md — nachlaufbar*

### K-06 — Saat-Kennung (Inkarnationskennung per FNV-1a aus dem Grundtext)

**Hypothese:** Zwei Geraete mit demselben Grundtext kommen auf dieselbe Kennung — ein hergestellter gemeinsamer Vorfahre.

**Verdikt:** leergelaufen · **2026-08-07**

**Kennzahl:** Vorbedingung 0/24 im Vorabtest, 0/720 je Zelle im Projekt-Harness  
**Zellbasis:** 24 Laeufe / 720 Zustellordnungen x 8 Zellen

Faellt nicht, weil sie bricht, sondern weil ihre Vorbedingung nie eintritt. Der Praegemoment liegt HINTER dem Saattext (main.ts:1346 - der Start-Sweep ueberspringt Notizen ohne Hilfsdatei, die Kennung entsteht erst beim ersten echten Edit), der Saattext traegt die Kennung also schon, und zwei Menschen tippen nicht bytegleich. In allen acht gepaarten Zellen Spalte fuer Spalte identisch mit dem Bestand.

*Beleg: Vault-Note, Nachtrag 2026-08-07. Der dort genannte Sessionbericht `erstkontakt-2026-08-07.md` existiert nicht — weder im Doku-Repo noch sonstwo; am 2026-08-12 nachgesehen. Die Zahlen stehen nur in der Vault-Note selbst. — **kein Bericht***

### K-07 — Kandidat A — Genesis-Blob mit Blob-Hash-Tie-Break

**Hypothese:** Der Tie-Break entscheidet nach dem Hash des Genesis-Blobs statt nach einer Zufallskennung.

**Verdikt:** gebrochen · **2026-07-31**

**Kennzahl:** Verlust steigt (baselineRace 7 auf 10); Duplikate fallen in keinem Modus (16>16, 23>24, 15>19)  
**Zellbasis:** 3 Modi x 40 Seeds, alle 120 Zustellreihenfolgen, 7 Mutationsproben

Verfehlt beide Haelften seines eigenen Akzeptanzkriteriums. Der lehrreiche Teil - fuenf seiner sechs Konstruktionsbedingungen sind im Bestand bereits implementiert; real aendert er nur den Tie-Break-SCHLUESSEL, und der ist nicht die tragende Stelle. Wirkt ueber Adoption, nicht ueber Item-ID, ist also von K-05 nicht miterledigt und musste einzeln gemessen werden.

*Beleg: spike-report.md §3.4 — **Instrument weg***

### K-08 — Note-Kennung zur Historien-Kennung ableiten

**Hypothese:** Aus dem Notiznamen eine gemeinsame Historien-Kennung gewinnen.

**Verdikt:** gebrochen · **2026-07-31**

**Kennzahl:** Verbesserung bei 2 Geraeten, vollstaendiger Zusammenbruch bei 3  
**Zellbasis:** nicht ueberliefert

Eine geteilte Identitaet ist keine geteilte Historie. Gleiche Kennungen machen alle Ketten kompatibel, also werden ALLE gemergt.

*Beleg: Vault-Note, Ausschlusstabelle — nachlaufbar*

### K-09 — Bibliothekswechsel (Loro, Automerge, Diamond Types, cola, json-joy, Peritext)

**Hypothese:** Ein anderes CRDT fuehrt inhaltsgleiche Einfuegungen zusammen.

**Verdikt:** gebrochen · **2026-08-04**

**Kennzahl:** keines der sieben geprueften Systeme fuehrt inhaltsgleiche, unabhaengig erzeugte Einfuegungen zusammen  
**Zellbasis:** 7 Bibliotheken, an den Primaerquellen geprueft

Identitaet ist ueberall (ReplicaID, Counter), der Merge ist Vereinigung ueber Op-IDs, Inhalt wird nie verglichen. Der Yjs-Maintainer in yjs#364 - "There is no algorithm (based on CRDTs) that can magically resolve the merge to be the expected result ... Even if the insertions contain the same content." Loro und Automerge empfehlen selbst den Workaround. Zweitbefund - eine feste Geraete-ID als CRDT-Client-ID ist gefaehrlich, nicht hilfreich.

*Beleg: Vault-Note, Abschnitt 'Kein Text-CRDT loest es'; recherche-crdt-2026-08-04.md — nachlaufbar*

### K-10 — Andere Yjs-Datentypen (Y.Array, Y.Map mit Zeilen-Keys)

**Hypothese:** Ein anderer Datentyp umgeht das Problem.

**Verdikt:** gebrochen · **2026-08-04**

**Kennzahl:** Y.Array dupliziert gleich  
**Zellbasis:** analytisch

Y.Map mit inhaltsabgeleiteten Zeilen-Keys macht einseitige Loeschung zum Muenzwurf und braucht EBENFALLS einen geteilten Genesis.

*Beleg: Vault-Note, Ausschlusstabelle — nachlaufbar*

### K-11 — Nachtraegliche Deduplikation, textuell

**Hypothese:** Das Duplikat hinterher wieder entfernen.

**Verdikt:** gebrochen · **2026-07-31**

**Kennzahl:** konvergent, also stille Korruption  
**Zellbasis:** nicht ueberliefert

Frisst legitime Wiederholungen und zerlegt Edits im duplizierten Block. Konvergent heisst hier - alle Geraete sind sich einig, dass etwas fehlt.

*Beleg: Vault-Note, Ausschlusstabelle — nachlaufbar*

### K-12 — Nachtraegliche Deduplikation, strukturell

**Hypothese:** Ueber die CRDT-Struktur statt ueber den Text deduplizieren.

**Verdikt:** gebrochen · **2026-07-31**

**Kennzahl:** 88 von 130 Faellen mit Textverlust  
**Zellbasis:** 130 Faelle an echtem Material

Ignoriert Position und Kontext; Ersetzungs-Edits werden verstuemmelt ("status - ongoing>done" ergibt "status - on").

*Beleg: Vault-Note, Ausschlusstabelle — nachlaufbar*

### K-15 — Rueckzug plus Konfliktkopie

**Hypothese:** Die unterlegene Seite verwirft ihre Fassung und legt eine Konfliktkopie an — die Empfehlung der Vorbilder.

**Verdikt:** gebrochen · **2026-08-02**

**Kennzahl:** in 0 von 120 Seeds besser als der Bestand; Endtexte in 120/120 identisch  
**Zellbasis:** 120 Seeds

Der gemessene Verlust (83 Faelle) verschwand nicht durch den Rueckzug, sondern stammte vollstaendig AUS der Konfliktkopie. Der praktische Punkt dahinter - eine Konfliktkopie gibt es in dieser Umgebung schon ohne Plugin. Wer sie als neue Sicherung einbaut, verlegt nur, wer sie erzeugt, und verliert dabei den Merge, den das CRDT in denselben Faellen hinbekommen haette.

*Beleg: Vault-Note, Nachtrag 2026-08-02 — einzige Spur ist eine Zeile in der Daily Note vom 02.08. — **kein Bericht***

## Materialisierung und Verdopplung

| ID | Versuch | Verdikt | Kennzahl | Beleglage |
| --- | --- | --- | --- | --- |
| `M-01` | Zeilenweises Gate an switchToGuid | gebrochen | -0,84 % sichtbare Verdopplung gegen +42 % stillen Grundtextverlust (1.536 auf 2.187 kollabierte Zeilen) | nachlaufbar |
| `M-02` | Lokalen Beitrag als Yjs-Update uebertragen statt materialisieren | gebrochen | 1.134 von 1.134 Grundtextzeilen verloren (100 %), 200 von 200 Notizen | nachlaufbar |
| `M-03` | unite selbst aendern | kein Urteil | keine — Prueflauf technisch gescheitert | nachlaufbar |
| `M-04` | Tuer ensureDoc unterdruecken | gebrochen | 0 % Wirkung — verdopp bleibt 845, obwohl der Arm 11.950 Zeilen streicht | nachlaufbar |
| `M-05` | Tuer applyLocalContent unterdruecken | gebrochen | +23,4 % Verdopplung und +33 % Verlust | nachlaufbar |
| `M-06` | Herkunftstor schaerfen (Hebel B, istEigen) | offen | Textverlust -33 bis -55 % (101 auf 65 bei N=4); loest K.o.-1 aber nur in einer von drei Seed-Familien | nachlaufbar |
| `D-01` | Doc neu aufbauen (Weglassen) | offen | 0 % stiller Verlust | nachlaufbar |
| `D-02` | Zieltext per setContent (Delete-Ops) | gebrochen | 0 bis 0,2 % stiller Verlust | nachlaufbar |
| `D-03` | clock-Bereich gezielt loeschen | gebrochen | 2,8 bis 50,0 % stiller Verlust | nachlaufbar |
| `D-04` | Y.UndoManager.undo() | gebrochen | 29,9 bis 50,7 % stiller Verlust — das schlechteste der vier Verfahren | nachlaufbar |

### M-01 — Zeilenweises Gate an switchToGuid

**Hypothese:** Nur materialisieren, was winnerText nicht schon traegt — der Text steht lokal zur Verfuegung.

**Verdikt:** gebrochen · **2026-08-12**

**Kennzahl:** -0,84 % sichtbare Verdopplung gegen +42 % stillen Grundtextverlust (1.536 auf 2.187 kollabierte Zeilen)  
**Zellbasis:** 4.000 Seeds, gepaart, identisches Szenario je Arm

Das Gate laesst eine lokale Zeile weg, WEIL der Gewinner-Doc dafuer schon ein Item traegt — und aliasiert damit den eigenen Beitrag auf ein fremdes Item. Ab da toetet ihn jeder gewoehnliche Delete auf dem Gewinner-Geraet. Nutzenmenge und Gefahrenmenge sind identisch - von 3.348 weggelassenen Vorkommen war NULL ohne Gewinner-Item, es gibt keine sichere Teilmenge. Die Erkenntnis dahinter - die Verdopplung ist nicht Rauschen, sie ist der Traeger der lokalen Urheberschaft. Trifft jeden Ansatz dieser Bauart.

*Beleg: docs/produktziel.md; spike/gate-widerlegung/probe-aliasing.mjs — nachlaufbar*

### M-02 — Lokalen Beitrag als Yjs-Update uebertragen statt materialisieren

**Hypothese:** Statt Text neu zu erzeugen, das Rest-Update der Verlierer-Kette einspielen.

**Verdikt:** gebrochen · **2026-08-12**

**Kennzahl:** 1.134 von 1.134 Grundtextzeilen verloren (100 %), 200 von 200 Notizen  
**Zellbasis:** 200 Notizen, gepaart

Das Rest-Update traegt ein Delete-Set ueber die Item-IDs der Verlierer-Kette. Teilen zwei Geraete dieselbe Verlierer-Inkarnation — der Normalzustand jedes konvergierten Paars —, loescht das zweite genau die Items, die im Gewinner-Doc LEBEN. Konvergent und damit still. Der lehrreichste Teil ist, warum das keiner Messung auffiel - der Szenariogenerator vergibt je Notiz und Geraet genau einmal eine eigene Kennung, alle Verlierer-Ketten sind dort disjunkt. Die Null, die der Entwurf gemessen hatte, war eine Eigenschaft des Generators.

*Beleg: docs/produktziel.md, Abschnitt 'Das naheliegende Gate ist gefallen' — nachlaufbar*

### M-03 — unite selbst aendern

**Hypothese:** Die Vereinigungsfunktion so bauen, dass sie nicht doppelt materialisiert.

**Verdikt:** kein Urteil · **2026-08-12**

**Kennzahl:** keine — Prueflauf technisch gescheitert  
**Zellbasis:** —

Derselben Bauart wie M-01 und stuende unter demselben Einwand (Aliasierung des eigenen Beitrags). Nicht gemessen.

*Beleg: docs/produktziel.md, 'Folge fuer die Kandidatenlage' — nachlaufbar*

### M-04 — Tuer ensureDoc unterdruecken

**Hypothese:** Eine der drei setContent-Aufrufstellen ist die Quelle der Verdopplung.

**Verdikt:** gebrochen · **2026-08-12**

**Kennzahl:** 0 % Wirkung — verdopp bleibt 845, obwohl der Arm 11.950 Zeilen streicht  
**Zellbasis:** 200 Seeds, DET 42

Kausal inert - was der Adopt-Zweig materialisiert, sammelt der Tie-Break ohnehin wieder ein. Methodisch wichtig - der naheliegende Indikator rankt diese Tuer mit 87 % auf Platz 1. Erst nach Herausrechnen des Grundtexts sagt er das Ergebnis voraus. Ohne die Gegenprobe waere die falsche Tuer bearbeitet worden.

*Beleg: spike/verdopplung/aufrufstelle.mjs — nachlaufbar*

### M-05 — Tuer applyLocalContent unterdruecken

**Hypothese:** wie M-04

**Verdikt:** gebrochen · **2026-08-12**

**Kennzahl:** +23,4 % Verdopplung und +33 % Verlust  
**Zellbasis:** 200 Seeds, DET 42

Unterdruecken schadet hier aktiv. "Alle drei" kostet Verlust 103 auf 235.

*Beleg: spike/verdopplung/aufrufstelle.mjs — nachlaufbar*

### M-06 — Herkunftstor schaerfen (Hebel B, istEigen)

**Hypothese:** Ein schaerferes Eigen-Kriterium verhindert, dass eine per Sync gelieferte .md als eigener Edit durchgeht.

**Verdikt:** offen · **2026-08-09**

**Kennzahl:** Textverlust -33 bis -55 % (101 auf 65 bei N=4); loest K.o.-1 aber nur in einer von drei Seed-Familien  
**Zellbasis:** 200 Seeds x 3 Seed-Familien, N=4, DET 7

Der staerkste ungenutzte Hebel. Zwei Dinge vor einem Einbau zu klaeren - im echten Plugin liegt zwischen merke() und istEigen() das pathQueue-Fenster (main.ts:302-344), im Messapparat folgt der Vergleich synchron, B wuerde real also MEHR Fehlparkungen erzeugen als gemessen. Und die Doc-Marke muesste ein Hash sein, kein voller Doc-Text.

*Beleg: docs/produktziel.md, 'Zwei Hebel wurden gebaut und gegeneinander gemessen' — nachlaufbar*

### D-01 — Doc neu aufbauen (Weglassen)

**Hypothese:** Den Doc verwerfen und aus einer Teilmenge der Updates neu aufbauen.

**Verdikt:** offen · **2026-08-04**

**Kennzahl:** 0 % stiller Verlust  
**Zellbasis:** n = 576 je Zelle

Verlustfrei, aber nicht immer wirksam - Weglassen propagiert nicht. Hat der Peer die weggelassenen Ops bereits, holt der naechste Sync sie zurueck.

*Beleg: Vault-Note, Nachtrag 2026-08-04 — nachlaufbar*

### D-02 — Zieltext per setContent (Delete-Ops)

**Hypothese:** Den bereinigten Zieltext setzen und Yjs die Differenz rechnen lassen.

**Verdikt:** gebrochen · **2026-08-04**

**Kennzahl:** 0 bis 0,2 % stiller Verlust  
**Zellbasis:** n = 576 je Zelle

Erzeugt echte Delete-Ops, und die propagieren.

*Beleg: Vault-Note, Nachtrag 2026-08-04 — nachlaufbar*

### D-03 — clock-Bereich gezielt loeschen

**Hypothese:** Genau die duplizierenden Ops entfernen.

**Verdikt:** gebrochen · **2026-08-04**

**Kennzahl:** 2,8 bis 50,0 % stiller Verlust  
**Zellbasis:** n = 576 je Zelle

Kennt ein drittes Geraet den Text ausschliesslich ueber die geloeschte Kette, nimmt die propagierte Loeschung ihn dort mit — und er liegt dann in keiner Sicherungskopie mehr. Deckt sich mit dem CALM-Theorem.

*Beleg: Vault-Note, Nachtrag 2026-08-04 — nachlaufbar*

### D-04 — Y.UndoManager.undo()

**Hypothese:** Die Rueckname ueber Yjs' eigenen Undo-Mechanismus.

**Verdikt:** gebrochen · **2026-08-04**

**Kennzahl:** 29,9 bis 50,7 % stiller Verlust — das schlechteste der vier Verfahren  
**Zellbasis:** n = 576 je Zelle

Erzeugt die meisten Delete-Ops und damit den groessten Propagationsschaden.

*Beleg: Vault-Note, Nachtrag 2026-08-04 — nachlaufbar*

## Merge-Verfahren und Textverlust

| ID | Versuch | Verdikt | Kennzahl | Beleglage |
| --- | --- | --- | --- | --- |
| `T-01` | Fuzzy patch_apply in threeWayMerge (Bestand bis 2026-08-11) | überholt | 23 zerstoerte Grundtextzeilen, 1.679 Textverlust, 10.672 Verdopplung | nachlaufbar |
| `T-02` | Exakte Suche statt Fuzz (kein-fuzz) | gebrochen | Grundtext 23 auf 0, aber Gesamtverlust +35,4 % (1.679 auf 2.274) | nachlaufbar |
| `T-03` | Verwurf melden plus dedup | gebrochen | Grundtext 0, Verlust -10,6 %, aber Verdopplung +10,2 %; Einbau in vier Anlaeufen gescheitert | nachlaufbar |
| `T-04` | Zeilenweiser Drei-Wege-Merge gegen die Basis | eingebaut | Grundtext 23 auf 0, Gesamtverlust -18,3 %, Verdopplung -6,5 %, Divergenz 2 auf 1; 566/566 Tests gruen | nachlaufbar |
| `T-05` | diffModus zeile (Hebel A, zeilentreue Ops) | eingebaut | Grundtextverlust 0 bei N=2,3,4; Preis Verdopplung +1,0 bis +1,7 % | nachlaufbar |
| `T-06` | diffModus roh | gebrochen | verdopp +0,03 %, kostet dafuer Grundtext (WEG 0 auf 50) | nachlaufbar |
| `T-07` | Bibliotheksgrenze diff_linesToChars_ abfangen | eingebaut | 5.001 verdoppelte Grundtextzeilen auf 0 bei 45.000 Zeilen | nachlaufbar |
| `T-08` | Zeilenende-Garantie in threeWayMerge (padLast wie in unionMerge) | eingebaut | an r13s Textlage 217 auf 191 Zeichen, mB 2 auf 1; r13-cdp danach PASS (15 gruen). Suite 600 auf 608 gruen, kein Rueckschritt. NICHT wirksam bei r14 - siehe X-08 | nachlaufbar |

### T-01 — Fuzzy patch_apply in threeWayMerge (Bestand bis 2026-08-11)

**Hypothese:** —  (gewachsener Bestand, nie als Kandidat geprueft)

**Verdikt:** überholt · **2026-08-11**

**Kennzahl:** 23 zerstoerte Grundtextzeilen, 1.679 Textverlust, 10.672 Verdopplung  
**Zellbasis:** 8 Zellen a 200 Seeds x 10 Notizen

patch_apply sucht die Stelle eines Hunks unscharf. 170 bis 385 Mal je Zelle findet es eine Stelle, deren Kontext nicht zeichengleich ist, und uebersetzt die Op-Indizes — die Ops landen an verschobener Stelle und veraendern eine Zeile, die niemand angefasst hat. Ersetzt durch T-04.

*Beleg: docs/produktziel.md; spike/schnitt/ergebnis-patch-*.txt — nachlaufbar*

### T-02 — Exakte Suche statt Fuzz (kein-fuzz)

**Hypothese:** Den unscharfen Treffer abschalten rettet den Grundtext.

**Verdikt:** gebrochen · **2026-08-11**

**Kennzahl:** Grundtext 23 auf 0, aber Gesamtverlust +35,4 % (1.679 auf 2.274)  
**Zellbasis:** 8 Zellen a 200 Seeds x 10 Notizen

Bricht den Alltagsfall - threeWayMerge('a','a+Lokal','a+Fremd') legt "Lokal" in den Meldeblock statt in den Text. Bei kurzen Texten deckt der Patch-Kontext fast alles ab, und der Fuzz gleicht das in der Mehrzahl der Faelle KORREKT aus. Zwei Befunde, die die Aktenlage korrigierten - der Fuzz verwirft im Bestand nichts (0 von 4.283 Hunks), und der Preis haengt an der Notizgroesse, gegenlaeufig zur Erwartung.

*Beleg: docs/produktziel.md, 'Der Preis der exakten Suche' — nachlaufbar*

### T-03 — Verwurf melden plus dedup

**Hypothese:** Exakt suchen und den verworfenen Hunk sichtbar anhaengen statt ihn zu schlucken.

**Verdikt:** gebrochen · **2026-08-11**

**Kennzahl:** Grundtext 0, Verlust -10,6 %, aber Verdopplung +10,2 %; Einbau in vier Anlaeufen gescheitert  
**Zellbasis:** 8 Zellen a 200 Seeds; Einbauversuch auf Branch versuch/patch-apply-einbau

Ohne Idempotenz-Pruefung waechst die Meldung (121 auf 186 auf 251 ueber drei Runden). Vier Einbauanlaeufe - exakte Suche bricht den Alltagsfall, Zeilen-Tokenisierung entschaerft ihn nicht, ein globaler Rueckfall bricht die Loeschsemantik, eine Schadenspruefung pro Hunk loest 149 von 150 Tests. Wichtiger als die vier Anlaeufe - die Metrik selbst ist blind fuer den Unterschied zwischen "einsortiert" und "angehaengt", die Entscheidungsvorlage ueberschaetzt den Tausch also.

*Beleg: Branch versuch/patch-apply-einbau, Commit 75235b1 ('FUNKTIONIERT NICHT, nicht mergen') — nachlaufbar*

### T-04 — Zeilenweiser Drei-Wege-Merge gegen die Basis

**Hypothese:** patch_apply ist fuer den Fall OHNE gemeinsamen Vorfahren gebaut — hier gibt es einen.

**Verdikt:** eingebaut · **2026-08-11**

**Kennzahl:** Grundtext 23 auf 0, Gesamtverlust -18,3 %, Verdopplung -6,5 %, Divergenz 2 auf 1; 566/566 Tests gruen  
**Zellbasis:** 8 Zellen a 200 Seeds x 10 Notizen; kein Rueckschritt in einer einzigen Zelle

Weil auf ZEILEN gearbeitet wird, kann keine Operation mehr eine fremde Zeile aufbrechen — das war die Schadensmechanik des Zeichen-Diffs. Der Hinweis stand seit Wochen im eigenen Messapparat. Erledigt auch die drei Achsen, an denen der Fix vom 2026-08-10 nicht trug (N >= 5, grosse Notizen, mdModus ueberschreiben). Bekannte Grenzen - diff3 ist formal nicht idempotent (24,7 % der Faelle, Bestand 100 %), Konvergenz nicht garantiert (13,7 % der Merge-Reihenfolgen liefern verschiedene Texte).

*Beleg: Commit efae37a; Wirkungsnachweis an drei echten Obsidian-Instanzen 2026-08-12 — nachlaufbar*

### T-05 — diffModus zeile (Hebel A, zeilentreue Ops)

**Hypothese:** Ops an Zeilengrenzen ausrichten bricht die Kopplung "Verlust = mehrfach UND zeilenkreuzend".

**Verdikt:** eingebaut · **2026-08-10**

**Kennzahl:** Grundtextverlust 0 bei N=2,3,4; Preis Verdopplung +1,0 bis +1,7 %  
**Zellbasis:** 200 Seeds x 3 Zufallsfamilien x 16.000 Grundtextzeilen

Der einzige Hebel, der die Kopplung BRICHT - die Vorbedingung tritt unveraendert oft ein, sie ist nur nicht mehr schaedlich. Wirkung ohne Harness als Eigenschaft nachweisbar, nicht nur als Rate. Traegt NICHT bei N >= 5, grossen Notizen und mdModus ueberschreiben — dort sitzt der Rest strukturell VOR setContent (siehe T-04).

*Beleg: Commit 82c5426, src/crdt-manager.ts — nachlaufbar*

### T-06 — diffModus roh

**Hypothese:** Rohe Zeichen-Ops ohne Nachbearbeitung.

**Verdikt:** gebrochen · **2026-08-12**

**Kennzahl:** verdopp +0,03 %, kostet dafuer Grundtext (WEG 0 auf 50)  
**Zellbasis:** 4 Zellen

Flach in der Wirkung auf die Verdopplung, teuer beim Grundtext.

*Beleg: docs/produktziel.md, 'Die drei anderen Kandidaten sind gemessen ausgeschieden' — nachlaufbar*

### T-07 — Bibliotheksgrenze diff_linesToChars_ abfangen

**Hypothese:** Oberhalb von 40.000 verschiedenen Zeilen kollabiert diff-match-patch den Rest zu einer Zeile.

**Verdikt:** eingebaut · **2026-08-10**

**Kennzahl:** 5.001 verdoppelte Grundtextzeilen auf 0 bei 45.000 Zeilen  
**Zellbasis:** kalibriert an 39.999 vs. 40.000 verschiedenen Zeilen bei konstant 45.000 Gesamtzeilen

diffOps faellt oberhalb von 39.000 verschiedenen Zeilen ueber beide Texte (Abstand 999 zur Kante) auf semantisch zurueck. Die Schwelle misst auf VERSCHIEDENEN Zeilen - eine Schwelle auf split('\n').length haette in beiden Kalibrierungsfaellen denselben Wert gelesen.

*Beleg: Commit 04154d7 — nachlaufbar*

### T-08 — Zeilenende-Garantie in threeWayMerge (padLast wie in unionMerge)

**Hypothese:** threeWayMerge klebt zwei Zeilen aneinander, wenn ein Stand nicht auf einem Zeilenumbruch endet — der Fall, den unionMerge seit Review C-1 abfaengt.

**Verdikt:** eingebaut · **2026-08-13**

**Kennzahl:** an r13s Textlage 217 auf 191 Zeichen, mB 2 auf 1; r13-cdp danach PASS (15 gruen). Suite 600 auf 608 gruen, kein Rueckschritt. NICHT wirksam bei r14 - siehe X-08  
**Zellbasis:** zwei Realtest-Laeufe an je zwei echten Obsidian-Instanzen (r13-cdp-lokal, r14-cdp-lokal), 8 neue Unit-Tests, Idempotenz ueber 2000 gepaarte Faelle je Zelle; Wirkung am 2026-08-13 in der vollen Batterie nachgefahren

diff_linesToChars_ tokenisiert INKLUSIVE Zeilenende. zeilenListe schneidet eine Schlusszeile ohne \n ohne Trennzeichen ab, dreiWegeZeilen fuegt mit join('') zusammen — die naechste Zeile klebt daran fest. unionMerge faengt das seit Review C-1 mit padLast ab (text-merge.ts:376-379) und beschreibt den Schaden woertlich; beim Wechsel auf den zeilenweisen Merge (T-04) wurde dieselbe Behandlung nicht mitgezogen. padLast hatte im ganzen Modul drei Aufrufstellen, alle drei in unionMerge. Kleinster Fall - threeWayMerge('a\nb','a\nb\nX','a\nb\nY') ergab 'a\nb\nXb\nY' statt 'a\nb\nX\nY'. AM PRODUKT GEMESSEN, nicht konstruiert - beide Runner endeten mit 'A2-<RunId>BBB-<RunId>' in einer Zeile; in r13 sind beide Vaults byte-gleich, also konvergenter und damit STILLER Schaden. Verletzt Gruppe 1 ("Der Text bleibt strukturell heil"), nicht K.o.-1 - kein Grundtext geht verloren. Warum es niemand sah - tests/three-way-line-endings.test.ts prueft CRLF, LF und BOM, aber alle 26 Fixtures endeten auf einem Zeilenumbruch. Genau der Fall, den unionMerges eigener Kommentar "in Obsidian der Normalfall" nennt, war fuer threeWayMerge nicht abgedeckt. DIE ERSTE FASSUNG DES FIXES WAR SELBST FALSCH und ist von der adversarialen Pruefung gefallen. Sie entfernte das angehaengte Zeilenende nur, wenn WEDER local NOCH other eines hatte — und las other damit als Beitrag, auch wenn other === base, die Gegenseite also gar nichts geaendert hat. Damit brach die Identitaet threeWayMerge(base, local, base) === local - der gewoehnliche lokale Edit am Dateiende (Obsidian schreibt dort keinen Umbruch) bekam einen angehaengt, und sync-handler.ts:1847 schrieb Datei und CRDT-Op fuer eine Aenderung, die niemand gemacht hat. Selbstverstaerkend, weil die Datei danach auf einem Umbruch endet. DIE TRAGENDE FASSUNG mergt das Umbruch-Bit selbst 3-Wege-artig - wer es gegenueber base geaendert hat, bestimmt es (zielNl = localNl === baseNl ? otherNl : localNl). Beide Richtungen sind als Test gepinnt. ZWEITE PRUEFRUNDE, zweiter Fehler - der Strip nahm pauschal EIN Zeichen zurueck. `mitNl` ist aber nicht umkehrbar - ein Text ohne Schluss-Umbruch und derselbe Text mit einem bilden beide auf dieselbe gepolsterte Fassung ab. Endete das Ergebnis auf einer LEERZEILE, loeschte der Strip diese Zeile und verfehlte die eigene Zusage trotzdem, weil danach immer noch ein Umbruch dastand. Eigene Messung: 481 von 19.959 gemergten Tripeln (2,4 %) betroffen - konvergent auf beiden Seiten und damit still. Behoben; ein Text mit leerer Schlusszeile kann das Bit `false` gar nicht erfuellen, dort ist Nichtstun richtig. DER PREIS, ausdruecklich - die Nicht-Idempotenz beim MEHRFACH-Merge steigt in den Ohne-Zeilenende-Zellen: 482 auf 741, 204 auf 751, 648 auf 750 von je 2000 gepaarten Faellen; die Mit-Zeilenende-Zelle bleibt bei 760 unveraendert. Das ist KEIN neues Verhalten, sondern eine Vereinheitlichung auf den Pfad, den der Mit-Zeilenende-Fall im Bestand schon nahm: Von den Faellen, in denen neu instabil und alt stabil ist, sind 305/305, 604/604 und 291/294 dort schon im Bestand instabil. Die drei Reste sind von Hand nachgesehen und ebenfalls Vereinheitlichung - eine Schwaeche der automatischen Kontrollfrage, nicht des Produkts (Beispiel im Quelltext von idempotenz.mjs). diff3 ist formal nicht idempotent (Khanna/Kunal/Pierce, FSTTCS 2007); der Fix verschiebt nur, welche Faelle in diesen bekannten Pfad fallen. DAS INSTRUMENT WAR SELBST BLIND und ist gehaertet - sein Alphabet enthielt keinen Leerstring, und es entfernte per Regex ALLE Schluss-Umbrueche statt nur einem - es konnte also nie einen Text mit leerer Schlusszeile erzeugen. Genau die Schadensklasse der zweiten Runde war damit strukturell unsichtbar, und seine Zahl wurde als Entlastung zitiert, die sie fuer diesen Fall nicht trug. Jetzt: 366/2000 der erzeugten Texte enden auf einer Leerzeile.

*Beleg: spike/duplikat-mb/zeilenende.mjs und idempotenz.mjs (beide Fassungen gegeneinander); tests/three-way-line-endings.test.ts; obsidian-qollab-doku/sdd/runs/ — r13-lokal-lauf2.log, r14-lokal-lauf.log, suite-nach-t08.log (die 608), idempotenz-t08.log; leerzeile.mjs fuer die 481/19.959 — nachlaufbar*

## Lösch-, Rename- und Meldungs-Semantik

| ID | Versuch | Verdikt | Kennzahl | Beleglage |
| --- | --- | --- | --- | --- |
| `S-01` | Konflikt-Vermerk als Zeile in den Text schreiben | gebrochen | konvergiert (konvergent=true, gleich=true) — faellt aber am zweiten Kontakt: vermerke=2 gegen 0 ohne | nachlaufbar |
| `S-02` | Konfliktkopie statt Meldung | gebrochen | keine — beide Fassungen stehen bereits in der Note | nachlaufbar |
| `S-03` | Tombstone-Index als guid -> Set<paths> statt path -> paths[] | gebrochen | faellt im Normalfall — Renames vor dem ersten Doc-Zugriff | nachlaufbar |
| `S-04` | Pfad-Historie in data.json persistieren | gebrochen | keine — am Aufwand-Nutzen-Verhaeltnis verworfen | nachlaufbar |
| `S-05` | Beim Delete .qollab/ nach allen Hilfsdateien mit dieser GUID durchsuchen | gebrochen | wirkungslos gegen den Zielfall | nachlaufbar |
| `S-06` | Beim Rename einen Tombstone auf (oldPath, GUID) setzen | gebrochen | reisst die von Fix A geschlossene Luecke wieder auf | nachlaufbar |
| `S-07` | Reine Pfadform als Klassifikator fuer Legacy-Hilfsdateien | gebrochen | 8 Tests in 4 Bestands-Suiten fallen | nachlaufbar |
| `S-08` | Heuristik "Sync-Overwrite erkennen" (Fix-Richtung C) | kein Urteil | nicht gemessen — als Richtung ausgeschlossen, bevor gebaut wurde | nachlaufbar |

### S-01 — Konflikt-Vermerk als Zeile in den Text schreiben

**Hypothese:** Ein Vermerk im Text ("getrennt bearbeitet auf Geraet X") macht den Erstkontakt sichtbar.

**Verdikt:** gebrochen · **unbekannt**

**Kennzahl:** konvergiert (konvergent=true, gleich=true) — faellt aber am zweiten Kontakt: vermerke=2 gegen 0 ohne  
**Zellbasis:** zwei Szenarien (zweites Geraet, drittes Geraet)

Die Ausgangsannahme "ein Vermerk bricht die Konvergenz" wurde gebaut und ist WIDERLEGT — er konvergiert. Seine Kosten liegen woanders und sind ebenfalls gemessen: Der Vermerk ist Inhalt und bleibt. Eine Zeile je Konfliktereignis, dauerhaft, mit einer Geraete-ID, die der Nutzerin nichts sagt, von Hand zu entfernen — und er sagt nichts, was die Meldung nicht ohnehin sagt.

*Beleg: task-19-report.md §4.4 — nachlaufbar*

### S-02 — Konfliktkopie statt Meldung

**Hypothese:** Eine zweite Datei bewahrt die unterlegene Fassung.

**Verdikt:** gebrochen · **unbekannt**

**Kennzahl:** keine — beide Fassungen stehen bereits in der Note  
**Zellbasis:** analytisch, am gebauten Stand

Dupliziert, was ohnehin dasteht, und erzeugt eine zweite zu synchronisierende Datei samt eigener Hilfsdatei. Deckt sich mit dem unabhaengig gemessenen Befund unter K-15.

*Beleg: task-19-report.md §4.4 — nachlaufbar*

### S-03 — Tombstone-Index als guid -> Set<paths> statt path -> paths[]

**Hypothese:** Der Index an der Inkarnation statt am Pfad ist semantisch naeher am Tombstone.

**Verdikt:** gebrochen · **unbekannt**

**Kennzahl:** faellt im Normalfall — Renames vor dem ersten Doc-Zugriff  
**Zellbasis:** analytisch am Kontrollfluss

Die GUID ist zum Rename-Zeitpunkt oft unbekannt (lazy aus dem Sidecar-Header gelesen). Genau der haeufige Fall — Rename vor dem ersten Doc-Zugriff — faellt damit durch.

*Beleg: task-15-report-runde2.md — nachlaufbar*

### S-04 — Pfad-Historie in data.json persistieren

**Hypothese:** Persistenz loest die Neustart-Grenze des Tombstone-Index.

**Verdikt:** gebrochen · **unbekannt**

**Kennzahl:** keine — am Aufwand-Nutzen-Verhaeltnis verworfen  
**Zellbasis:** analytisch

Loest die Neustart-Grenze, kostet aber ein neues persistiertes Format samt Migration und Pruning — fuer einen Fall, den Issue #11 (Loeschen als CRDT-Op) ohnehin richtig loest. Verstoesst gegen "schlicht halten".

*Beleg: task-15-report-runde2.md — nachlaufbar*

### S-05 — Beim Delete .qollab/ nach allen Hilfsdateien mit dieser GUID durchsuchen

**Hypothese:** Ein Scan findet die zugehoerigen Hilfsdateien und raeumt sie mit ab.

**Verdikt:** gebrochen · **unbekannt**

**Kennzahl:** wirkungslos gegen den Zielfall  
**Zellbasis:** analytisch am Kontrollfluss

Vault-weiter Scan im Event-Handler UND wirkungslos gegen genau den Fall, um den es geht: Die fremde Hilfsdatei ist zum Delete-Zeitpunkt noch gar nicht angekommen.

*Beleg: task-15-report-runde2.md — nachlaufbar*

### S-06 — Beim Rename einen Tombstone auf (oldPath, GUID) setzen

**Hypothese:** Der alte Pfad wird als beerdigt markiert, damit spaet ankommende Hilfsdateien ihn nicht wiederbeleben.

**Verdikt:** gebrochen · **unbekannt**

**Kennzahl:** reisst die von Fix A geschlossene Luecke wieder auf  
**Zellbasis:** analytisch, vom Review belegt

Entwertet `oldPath` fuer eine LEBENDE Inkarnation — sobald der Datei-Sync die .md dort zurueckspielt, ist die Luecke wieder offen. Vom Review ausdruecklich verworfen.

*Beleg: task-15-report-runde2.md, task-16-review.md — nachlaufbar*

### S-07 — Reine Pfadform als Klassifikator fuer Legacy-Hilfsdateien

**Hypothese:** Der Dateiname allein entscheidet, ob eine Hilfsdatei aus v0.1 stammt.

**Verdikt:** gebrochen · **unbekannt**

**Kennzahl:** 8 Tests in 4 Bestands-Suiten fallen  
**Zellbasis:** 4 Suiten (sync-handler, convergence, write-back-guard, concurrency)

Gebaut und wieder verworfen. Die Fixtures legen headerlose, aber gueltige Yjs-Updates unter per-Client-Pfade — die Semantik, die state-file.ts seit jeher zusagt. Acht Bestandstests anzupassen, um eine Zusage zu brechen, die fuer den Fund gar nicht ursaechlich ist, waere der falsche Tausch gewesen. Ursaechlich sind ausschliesslich das Loeschen und das GUID-Praegen.

*Beleg: task-17-report.md, task-17-review.md — nachlaufbar*

### S-08 — Heuristik "Sync-Overwrite erkennen" (Fix-Richtung C)

**Hypothese:** Eine Heuristik erkennt, ob eine .md vom Datei-Sync ueberschrieben wurde.

**Verdikt:** kein Urteil · **unbekannt**

**Kennzahl:** nicht gemessen — als Richtung ausgeschlossen, bevor gebaut wurde  
**Zellbasis:** —

Im Task-Brief ausdruecklich aus dem Scope genommen ("bewusst verworfen"), ohne Messung. Der spaetere Weg ueber die Schreibherkunft (WriteProvenance, siehe Vault-Note "Schreibherkunft ueber die Prozessgrenze") loest dieselbe Frage nicht heuristisch, sondern durch Umhuellung des DataAdapters — er ersetzt diese Richtung, statt sie zu widerlegen.

*Beleg: task-11-brief.md §Nicht in diesem Task, task-11-review.md — nachlaufbar*

## Architektur und Dateiformat

| ID | Versuch | Verdikt | Kennzahl | Beleglage |
| --- | --- | --- | --- | --- |
| `K-13` | Kandidat B — basis-basierter Drei-Wege-Merge ohne CRDT | gebrochen | B-inhalt 58/120 sauber, B-hash 57/120, B-lokal 3/120 — Bestand 27/120; Verlust steigt in baselineRace | **Instrument weg** |
| `K-14` | Inhaltsadressierter Zustands-Log | gebrochen | N=2 40/40 Fixpunkt und 0 unverwandte Ketten; N=3 33/40; N=4 nur 9/40 | nachlaufbar |
| `K-16` | Einrichtungsschritt mit Verweigerung (git-annex-Regel) | offen | nicht gemessen | nachlaufbar |
| `A-01` | GH-12 Segmente je Geraet (append-only, flach) | gebrochen | verschaerft den Erstkontakt - 197 unverwandte Ketten gegen 184 im Ist, Verdopplung 74 gegen 59, sauber 8/40 gegen 13/40 | nachlaufbar |
| `A-02` | Vault-weites Doc (ein Y.Doc fuer den ganzen Vault) | gebrochen | 151 verlorene Zeilen, 0/40 sauber | nachlaufbar |
| `A-03` | Yjs-Subdocuments plus gemeinsamer Store | gebrochen | keine — analytisch verworfen | nachlaufbar |
| `A-04` | Aufloesungsflaeche an die vorhandenen Meldungen | offen | gemessen konvergent, 105/105 Zeilen aus der geparkten Hilfsdatei rettbar, ohne Formataenderung | nachlaufbar |

### K-13 — Kandidat B — basis-basierter Drei-Wege-Merge ohne CRDT

**Hypothese:** Eine gespeicherte Basis ersetzt das CRDT; gemergt wird gegen sie.

**Verdikt:** gebrochen · **2026-07-31**

**Kennzahl:** B-inhalt 58/120 sauber, B-hash 57/120, B-lokal 3/120 — Bestand 27/120; Verlust steigt in baselineRace  
**Zellbasis:** 3 Varianten x 120 Zustellreihenfolgen

Verfehlt das Akzeptanzkriterium (Verlust steigt), verdoppelt aber die Zahl sauberer Laeufe und beseitigt Nicht-Konvergenz und Nicht-Fixpunkt vollstaendig. Zwei harte Grenzen - er braucht eine fuenfte, in der Vorlage nicht vorgesehene Zutat, sonst waechst der Text unbegrenzt; und ohne gesyncte Hilfsdatei ist er unbrauchbar (B-lokal - 83/120 Explosionen). Bricht beim DRITTEN Replikat (Unison-Spezifikation §11). Sync-Scope schrumpft von 10,5 MB wachsend auf 0,74 MB konstant.

*Beleg: spike-report.md §2.2, Teil 2; Vault-Note Zeile 'Basis-Drei-Wege-Merge statt CRDT' — **Instrument weg***

### K-14 — Inhaltsadressierter Zustands-Log

**Hypothese:** Kennung eines Zustands = Hash seines Textes; damit ist jeder je veroeffentlichte Zustand ein Anschlusspunkt.

**Verdikt:** gebrochen · **2026-08-07**

**Kennzahl:** N=2 40/40 Fixpunkt und 0 unverwandte Ketten; N=3 33/40; N=4 nur 9/40  
**Zellbasis:** 40 Seeds je Zelle

Der einzige Kandidat, der die Bedingung ENTFERNT statt sie zu bewirtschaften — und er konvergiert nicht. Bei N=3 Seed 1 waechst der Text nach dem letzten Nutzer-Edit von 136 auf 15.208 Zeichen, der Graph von 36 auf 4.813 Knoten, alles merge-erzeugt. Kernversprechen "0 unverwandte Ketten" gilt nur bei N=2. Offenes Loch, ausdruecklich - die Nichtkonfluenz ist eine Eigenschaft der spike-eigenen Merge-Funktion, nicht zwingend inhaltsadressierter Logs ueberhaupt. Erledigt ist diese Bauart, nicht die Idee. Gewinn, der bleibt - 4 statt 35 Dateien je Seed bei N=2.

*Beleg: Vault-Note, Nachtrag 2026-08-07; erstkontakt-synthese-2026-08-03.md — nachlaufbar*

### K-16 — Einrichtungsschritt mit Verweigerung (git-annex-Regel)

**Hypothese:** Ein Geraet initialisiert, die anderen treten bei; unverwandte Historien werden abgelehnt statt gemergt.

**Verdikt:** offen · **2026-08-03**

**Kennzahl:** nicht gemessen  
**Zellbasis:** —

Verschiebt das Problem - aendert die Koernung des Rennens von vielen kleinen (Schaden - eine Notiz) zu einem grossen (Schaden - der ganze Vault). Verwertbar nur mit Verweigerung statt Warnung, Vorbild `git merge`, das unverwandte Historien standardmaessig ablehnt; Nextcloud hat aus demselben Grund von Warnung auf Blockade verschaerft. Bis auf eine unentscheidbare Frage pruefbar — die beantwortet ein Mensch, und das ist Koordination ausserhalb des Kanals, vom Unmoeglichkeitssatz nicht erfasst.

*Beleg: Vault-Note 'Was bleibt'; erstkontakt-synthese-2026-08-03.md Punkt 4 — nachlaufbar*

### A-01 — GH-12 Segmente je Geraet (append-only, flach)

**Hypothese:** Ein Logstrom je Geraet statt einer Hilfsdatei je Notiz und Geraet.

**Verdikt:** gebrochen · **2026-08-03**

**Kennzahl:** verschaerft den Erstkontakt - 197 unverwandte Ketten gegen 184 im Ist, Verdopplung 74 gegen 59, sauber 8/40 gegen 13/40  
**Zellbasis:** 40 Seeds

Darf NICHT als Korrektheitsmassnahme gefuehrt werden. Der Regler ist das Roll-Intervall - bei 30 s liegt die Verdopplung unter dem Ist-Zustand, die Dateiersparnis sinkt dann aber von 8,6x auf 2,3x. Skalierungsgewinn gemessen - 42 MB und ~8.400 Dateien statt 206 MB und 50.000. Es ist eine Skalierungs-, keine Korrektheitsentscheidung. Fehler im Issue korrigiert - die zitierte Kennzahl "25 von 120" gehoert zu Kandidat A, nicht zum Bestand.

*Beleg: Issue GH-12; erstkontakt-synthese-2026-08-03.md — nachlaufbar*

### A-02 — Vault-weites Doc (ein Y.Doc fuer den ganzen Vault)

**Hypothese:** Ein einziges Dokument statt eines je Notiz.

**Verdikt:** gebrochen · **2026-08-03**

**Kennzahl:** 151 verlorene Zeilen, 0/40 sauber  
**Zellbasis:** 40 Seeds

Tauscht sichtbaren gegen stillen Schaden. Ein Konflikt forkt den gesamten Vault.

*Beleg: erstkontakt-synthese-2026-08-03.md — nachlaufbar*

### A-03 — Yjs-Subdocuments plus gemeinsamer Store

**Hypothese:** Subdocuments senken die Dateizahl.

**Verdikt:** gebrochen · **2026-08-03**

**Kennzahl:** keine — analytisch verworfen  
**Zellbasis:** analytisch

Subdocuments reduzieren die Dateizahl nicht, und ein gemeinsamer Store forkt den gesamten Vault bei einem einzigen Konflikt. Issue #9 als "not planned" geschlossen.

*Beleg: Issue #9; README 'Known architectural limit' — nachlaufbar*

### A-04 — Aufloesungsflaeche an die vorhandenen Meldungen

**Hypothese:** Den Fall sichtbar machen und dem Menschen eine Flaeche zum Aufloesen geben, statt zu blockieren.

**Verdikt:** offen · **2026-08-03**

**Kennzahl:** gemessen konvergent, 105/105 Zeilen aus der geparkten Hilfsdatei rettbar, ohne Formataenderung  
**Zellbasis:** 105 Zeilen

Der Rest, der ohne Koordinator realistisch bleibt - den Fall sichtbar machen statt still zu vermischen. Loest ihn nicht, verwandelt aber einen stillen Datenfehler in eine Meldung.

*Beleg: erstkontakt-synthese-2026-08-03.md Punkt 3 — nachlaufbar*

## Messapparat

| ID | Versuch | Verdikt | Kennzahl | Beleglage |
| --- | --- | --- | --- | --- |
| `X-01` | Timeouts der Runner von 90 auf 240 s anheben | gebrochen | r01 FAIL mit 0 erreichten Asserts auf PASS mit 6; gemessene Wartezeit 118,6 s. Aber 4 von 9 Runnern bleiben rot | nachlaufbar |
| `X-02` | Runner auf den Prozess-Schreibweg umstellen (H-EDIT-CDP) | eingebaut | r11-cdp an zwei echten Obsidian-Instanzen: PASS, 46 Asserts gruen gegen FAIL mit 8 roten beim externen Arm; A-A-zeile-1x 0/0/0 auf 1/1/1 | nachlaufbar |
| `X-04` | r11s Rot als Produktfehler an K.o.-Kriterium 1 fuehren | gebrochen | in 6 kontrollierten Laeufen nicht reproduzierbar (t4, t5, t6b, t7, r11-cdp, r15-cdp); beide Verlust-Runner ueber den Prozess-Schreibweg PASS (46 bzw. 21 gruene Asserts) | nachlaufbar |
| `X-06` | Das Rest-Duplikat in r13/r14 dem Aufbauhelfer zuschreiben | gebrochen | AUFBAU-SAUBER in beiden Armen — alle vier Marker-Zaehler 1, CRDT-Sicht 1, GUID geteilt, Vaults byte-gleich | nachlaufbar |
| `X-07` | Das Rest-Duplikat in r13/r14 dem unionMerge des Startup-Sweeps zuschreiben | gebrochen | unionMerge liefert in der gemessenen Lage 191 Zeichen und mB genau einmal; threeWayMerge liefert 217 und mB zweimal | nachlaufbar |
| `X-08` | Das verbliebene Rot in r14 mit T-08 als erklaert fuehren | gebrochen | nach dem Fix gefahren: r13-cdp PASS (15 gruen), r14-cdp unveraendert FAIL - kontrolle2-keine-duplikate 1/2/1, byte-identisch zum Vorlauf; Endtext 210 Zeichen vorher wie nachher, gegen 158 bei A | nachlaufbar |
| `X-05` | Serienlauf ohne Entflaggen der Testvaults | gebrochen | 2 von 3 Runnern sterben nach 3 Asserts (r14-cdp, r15-cdp); mit H-TESTVAULT-FLAGS-WEG davor 23 bzw. 21 Asserts erreicht | nachlaufbar |
| `X-03` | Messapparat ohne Herkunftstor (bis 2026-08-09) | überholt | zwei Drittel des Befunds 'Grundtextverlust ab drei Geraeten' waren Artefakt; N=3 Verlust 7,1 auf 0, Verdopplung 440 auf 58 | nachlaufbar |

### X-01 — Timeouts der Runner von 90 auf 240 s anheben

**Hypothese:** Der Batterie-Ausfall ist ein zu kurzer Timeout, kein Defekt.

**Verdikt:** gebrochen · **2026-08-12**

**Kennzahl:** r01 FAIL mit 0 erreichten Asserts auf PASS mit 6; gemessene Wartezeit 118,6 s. Aber 4 von 9 Runnern bleiben rot  
**Zellbasis:** 9 Runner

Behebt den Ausfall, misst danach aber den NACHTRAG NACH FRISTABLAUF statt des lokalen Edits. Zweiter Mangel - die Korrektur setzte an den Runner-Dateien an, zwei Wartestellen liegen im gemeinsamen Helfer H-SETUP-SHARED. Der Runner kann seine eigene Ausgangslage nicht mehr herstellen, ohne den Pfad zu betreten, den er nicht messen wollte.

*Beleg: docs/produktziel.md, 'Die uebrigen sechs Runner' — nachlaufbar*

### X-02 — Runner auf den Prozess-Schreibweg umstellen (H-EDIT-CDP)

**Hypothese:** Ueber app.vault.modify im Renderer wird nichts geparkt; die Batterie misst wieder das Produkt.

**Verdikt:** eingebaut · **2026-08-13**

**Kennzahl:** r11-cdp an zwei echten Obsidian-Instanzen: PASS, 46 Asserts gruen gegen FAIL mit 8 roten beim externen Arm; A-A-zeile-1x 0/0/0 auf 1/1/1  
**Zellbasis:** sechs Runner an je zwei echten Obsidian-Instanzen; r11 mit drei Vorlauf-Versuchen (Tastenpausen 1,0 / 2,5 / 6,0 s)

Gebaut fuer r11, r13, r14, r15 plus den Aufbauhelfer; am 2026-08-13 um s00 und r16 ergaenzt, damit KEIN Runner mehr ueber den Park-Pfad misst. s00-cdp: PASS, 10 Asserts (1 Stelle umgestellt). r16-cdp: PASS, 16 Asserts (6 Stellen). Beide tragen `sidecar-ohne-park-frist` gruen, messen also den Erfassungspfad. Bei r16 traf der Lauf die scharfe Konstellation - die alte Inkarnation hatte die lexikografisch KLEINERE GUID (1f18... < e2b1...), haette ohne Tombstone also den Tie-Break gewonnen; der Zombie-Schutz haelt. Die Assert-Sets sind echte Obermengen der Vorlagen (10 aus 9, 16 aus 15, nichts verloren); ergaenzt ist je nur der Diskriminator. Damit ist ein Ergebnisunterschied dem Schreibweg zurechenbar. Die Regel dabei - umzustellen ist nur, was bei LAUFENDER App schreibt; drei Stellen bleiben bewusst extern, weil sie das Szenario sind und nicht sein Artefakt. Ein Waechter (pruefe-runner-schreibwege.ps1) setzt das maschinell durch. Der Lauf traegt seinen eigenen Diskriminator - `sidecar-ohne-park-frist` verlangt die Hilfsdatei in unter 30 s, wo der Park-Pfad mindestens 120 braeuchte. Er ist gruen, also misst der Lauf den Erfassungspfad. EINSCHRAENKUNG - alle drei Versuche melden `leg=writeback`, keiner `leg=vorlauf`. Geprueft ist Haelfte 1 von Task 16, nicht Haelfte 2. Im Prozess entsteht die Sidecar in Millisekunden (162-209 ms), so kurz haelt der Vorlauf-Zustand nicht an. Der Umbau hat den Runner gruen gemacht und dabei einen Teil seines Szenarios verschoben.

*Beleg: obsidian-qollab-doku, Commits 858135b, 1792188, 43fd38c; Lauf-Log runs/r11-cdp-lauf2.log — nachlaufbar*

### X-04 — r11s Rot als Produktfehler an K.o.-Kriterium 1 fuehren

**Hypothese:** Der in r11 gemessene Grundtextverlust ist ein echter Fehler des Plugins.

**Verdikt:** gebrochen · **2026-08-12**

**Kennzahl:** in 6 kontrollierten Laeufen nicht reproduzierbar (t4, t5, t6b, t7, r11-cdp, r15-cdp); beide Verlust-Runner ueber den Prozess-Schreibweg PASS (46 bzw. 21 gruene Asserts)  
**Zellbasis:** vier Diskriminator-Varianten plus die zwei umgebauten Runner selbst

Die Signatur war ernst - As Zeile fehlte in BEIDEN Vaults, bei intakter Konvergenz, also der stille Fall. Widerlegt ist sie ueber den Schreibweg - derselbe Aufbau im Prozess statt extern laesst die Zeile in allen drei Versuchen ueberleben. Ursache war das Herkunftstor - extern geschriebener Inhalt wird 120 s geparkt und danach per unionMerge nachgetragen, ein anderer Pfad als der, auf dem die Zusage 2026-08-03 aufgestellt wurde. Der Runner mass seit dem 2026-08-04 am Produkt vorbei, nicht das Produkt falsch. Lehre - eine Signatur, die exakt wie K.o.-Kriterium 1 aussieht, kann vollstaendig aus dem Messapparat stammen. Ohne den Diskriminator waere hier ein Produktfehler in die Akten gegangen.

*Beleg: docs/produktziel.md, Abschnitt 'Der Vorlauf-Diskriminator'; runs/r11-cdp-lauf2.log, runs/r15-cdp-lauf2.log — nachlaufbar*

### X-06 — Das Rest-Duplikat in r13/r14 dem Aufbauhelfer zuschreiben

**Hypothese:** Der gemeinsame Aufbau (H-SETUP-SHARED-CDP) erzeugt Bs Marker doppelt, nicht das geprüfte Szenario.

**Verdikt:** gebrochen · **2026-08-12**

**Kennzahl:** AUFBAU-SAUBER in beiden Armen — alle vier Marker-Zaehler 1, CRDT-Sicht 1, GUID geteilt, Vaults byte-gleich  
**Zellbasis:** zwei Arme: frisch angelegte Notiz (zweimal gefahren) und vorbestehende Notiz (die Lage von r13/r14/r15)

Der Verdacht lag nahe - in r13 wie r14 ist der verbliebene Doppelgaenger DERSELBE Marker, naemlich der, den B im gemeinsamen Aufbau setzt. agent-t8-aufbau.ps1 faehrt nur den Aufbau und zaehlt unmittelbar danach: In beiden Armen sauber. Der Helfer erzeugt es nicht; das Duplikat entsteht im Szenario und ist ein Produktbefund. Der zweite Arm war noetig - der erste fuhr auf einer frisch angelegten Notiz, waehrend r13-r15 `Meetingprotokoll.md` nie cleanen und H-RESET nur die Hilfsdateien loescht. Ohne Kontrollarm haette der Lauf einen anderen Fall gemessen als den fraglichen. Nebenbefund am Helfer - ein blosses `app.vault.create` praegt keine Inkarnation, erst ein `modify` tut es. Der Aufbau lief in den Timeout, sobald ein Runner die Notiz vorher aufraeumte; in H-SETUP-SHARED-CDP behoben.

*Beleg: runs/t8-aufbau.log und runs/t8-kontroll.log; sdd/agent-t8-aufbau.ps1 — nachlaufbar*

### X-07 — Das Rest-Duplikat in r13/r14 dem unionMerge des Startup-Sweeps zuschreiben

**Hypothese:** Der extern geschriebene Stand wird vom Startup-Sweep per unionMerge aufgeloest; unionMerge hat keinen gemeinsamen Vorfahren und kann per Konstruktion nicht deduplizieren.

**Verdikt:** gebrochen · **2026-08-13**

**Kennzahl:** unionMerge liefert in der gemessenen Lage 191 Zeichen und mB genau einmal; threeWayMerge liefert 217 und mB zweimal  
**Zellbasis:** die Textlage der beiden Runner, byte-genau gegen die echten Merge-Funktionen gerechnet, plus zwei Realtest-Laeufe mit Messpunkten

Der Kandidat stand seit dem 2026-08-12 als ausdrueckliche Vermutung in der Akte. Er faellt auf zwei unabhaengigen Wegen. ERSTENS laeuft unionMerge in diesem Pfad gar nicht - der unite-Zweig (sync-handler.ts:1837) haengt an `base === undefined` und damit an `adopted`; in r13 wie r14 hat B eigenen State, ensureDoc adoptiert nicht, der own-Branch endet auf threeWayMerge (:1847). ZWEITENS waere unionMerge dort die LOESUNG gewesen, nicht die Ursache - mit denselben Eingaben liefert es 191 Zeichen und mB genau einmal. Die tatsaechliche Ursache ist T-08 (fehlende Zeilenende-Garantie in threeWayMerge). Es war ueberdies nie ein Duplikat - der Endtext enthaelt `A2-<RunId>BBB-<RunId>` in EINER Zeile; H-COUNT zaehlt Regex-Treffer im Volltext (harness-ext.ps1:477), deshalb sah die verschmolzene Zeile wie eine Verdopplung aus. Zwei Nebenbefunde derselben Untersuchung, beide unabhaengig zu behandeln - die Sweep-Schranke steht seit 2026-08-07 auf 'basis-signatur', waehrend der Kommentar an der Aufrufstelle (main.ts:1375) weiterhin "Standard 'aus'" behauptet; und der file-open-Trigger kann den Startup-Sweep nicht mehr ueberholen, weil startSidecarWatcher erst hinter dem awaiteten Sweep registriert wird (main.ts:594-616) - r13 fuehrt genau das aber als seine geprueste Bedingung.

*Beleg: obsidian-qollab-doku/sdd/runs/r13-lokal-lauf2.log (M6 gegen M7) und r14-lokal-lauf.log (M7 gegen M8); spike/duplikat-mb/zeilenende.mjs Abschnitt 3 — nachlaufbar*

### X-08 — Das verbliebene Rot in r14 mit T-08 als erklaert fuehren

**Hypothese:** Der Zeilenende-Fix T-08 erklaert und behebt das Rot BEIDER verbliebener Runner, r13 und r14 - so stand es im Folgeprompt vom 2026-08-13 ("ihr gemeinsames Rot ist aufgeklaert und behoben").

**Verdikt:** gebrochen · **2026-08-13**

**Kennzahl:** nach dem Fix gefahren: r13-cdp PASS (15 gruen), r14-cdp unveraendert FAIL - kontrolle2-keine-duplikate 1/2/1, byte-identisch zum Vorlauf; Endtext 210 Zeichen vorher wie nachher, gegen 158 bei A  
**Zellbasis:** volle CDP-Batterie 2026-08-13 (8 Runner, 7 PASS), plus die Textlage byte-genau gegen beide Fassungen der echten Merge-Funktionen gerechnet

Der Fix wurde an r13s Textlage gemessen (217 auf 191 Zeichen, mB 2 auf 1) und daraus auf BEIDE Runner geschlossen. r14 wurde nach dem Fix nie gefahren; fuer ihn gibt es in der Registratur keine Nachher-Zahl. Beim ersten Lauf danach ist er unveraendert rot, mit byte-identischem Assert-Wert. WAS GEMESSEN IST. Der Endtext von vault-b traegt `B2-<RunId>BBB-<RunId>` in EINER Zeile - wieder eine Verklebung, kein Duplikat. Der Schaden steht im CRDT, nicht nur im Dateitext: verify.js liest die Zeile als eigenen Eintrag in markerCounts, textLen 210 gegen 158 bei A. Er ist damit propagierbar - sobald Bs Hilfsdatei in die Gegenrichtung synct, erbt A ihn. Der Runner sieht ihn nur frueher, weil er an dieser Stelle nur a->b synct. UNTERSCHIED ZU r13, ausdruecklich - dort waren beide Vaults byte-gleich beschaedigt (konvergent, still), hier ist nur B betroffen (divergent). Beide GUIDs sind gleich (9400f357...), es ist also kein Erstkontakt, sondern ein Merge-Problem innerhalb EINER geteilten Inkarnation. Kein Grundtextverlust - AAA, BBB und A2 stehen alle mit Count 1. Verletzt ist Gruppe 1 ("der Text bleibt strukturell heil"), nicht K.o.-1. WAS NICHT GEKLAERT IST. Ein einstufiger threeWayMerge ueber die naheliegende Basis erzeugt den gemessenen Text NICHT: mit Fix kommen 184 Zeichen (sauber), ohne Fix 210 mit der Verklebung an der SPIEGELVERKEHRTEN Stelle (`A2-<RunId>BBB-<RunId>` statt `B2-...`). unionMerge liefert in beiden Fassungen 184. Der Fix steckt nachweislich im gefahrenen Build (zielNl 2x, padLast 4x im deployten main.js, alle drei Kopien byte-gleich). Der tatsaechliche Entstehungsweg ist damit offen - mehrstufiger Merge, eine andere Basis als die angenommene, oder eine Stelle ausserhalb text-merge.ts. Das Instrument fuer den naechsten Anlauf liegt bereit. DIE METHODISCHE LEHRE. Ein Fix, der an EINEM Fall gemessen wurde, ist nicht fuer den zweiten belegt - auch dann nicht, wenn beide Faelle dieselbe Signatur zeigen. Die Aktenlage hat aus einer gemessenen Wirkung auf einen ungemessenen Fall geschlossen und ihn als erledigt gefuehrt.

*Beleg: obsidian-qollab-doku/sdd/runs/r14-cdp-bat3-20260813-212759.log und batterie-bat3-20260813-212759.json; spike/duplikat-mb/r14-pfad.mjs (mit Selbsttest gegen die gemessenen Laengen und Gegenprobe auf Klebe-Blindheit) — nachlaufbar*

### X-05 — Serienlauf ohne Entflaggen der Testvaults

**Hypothese:** Mehrere Runner nacheinander brauchen zwischen den Laeufen nichts weiter als eine Pause.

**Verdikt:** gebrochen · **2026-08-12**

**Kennzahl:** 2 von 3 Runnern sterben nach 3 Asserts (r14-cdp, r15-cdp); mit H-TESTVAULT-FLAGS-WEG davor 23 bzw. 21 Asserts erreicht  
**Zellbasis:** eine Serie zu drei Runnern, danach ein Nachlauf zu zweien

Nach einem Lauf steht vault-b in obsidian.json auf open:true (Obsidian schreibt das Flag beim Beenden). H-START-CDP startet ohne Vault-Argument und holt alle so vermerkten Vaults hoch — B lief also, BEVOR der Aufbau zustellen konnte, und praegt dann eine eigene Inkarnation statt zu adoptieren. H-GUARD-SICHERUNG hilft nicht: Es entflaggt nur Vaults AUSSERHALB der Testwurzel. Gefangen hat es die Vorbedingungspruefung in H-SETUP-SHARED-CDP, die derselbe Umbau eingefuehrt hat. Ohne sie haetten beide Runner mit einem falsch aufgebauten Zustand weitergemessen und Duplikate gemeldet, die aus dem Aufbau stammen — als Produktbefund nicht von einem echten zu unterscheiden.

*Beleg: runs/batterie-cdp.log gegen runs/batterie-cdp2.log; harness-cdp.ps1 H-TESTVAULT-FLAGS-WEG — nachlaufbar*

### X-03 — Messapparat ohne Herkunftstor (bis 2026-08-09)

**Hypothese:** — (unerkannter Mangel, kein Kandidat)

**Verdikt:** überholt · **2026-08-09**

**Kennzahl:** zwei Drittel des Befunds 'Grundtextverlust ab drei Geraeten' waren Artefakt; N=3 Verlust 7,1 auf 0, Verdopplung 440 auf 58  
**Zellbasis:** 40 Seeds x 10 Notizen x 8 Basiszeilen

Der Apparat verarbeitete eine per Sync gelieferte .md als EIGENEN Edit — genau der Kanal, den die Ursachenanalyse als Hauptverursacher benennt. Jede Zahl aus diesem Apparat ist unter diesem Vorbehalt zu lesen; welche das sind, ist nicht durchgeprueft. Zweiter Mangel derselben Klasse - fehlendes noteLocalDiffBase nach den Write-Backs.

*Beleg: docs/produktziel.md, 'Wie der Befund zustande kam' — nachlaufbar*

## Reichweite dieser Registratur

Ausgewertet:

- `docs/produktziel.md`
- `Vault: CRDT-Erstkontakt-ohne-gemeinsame-Historie.md`
- `obsidian-qollab-doku/sdd/erstkontakt-synthese-2026-08-03.md`
- `obsidian-qollab-doku/sdd/spike-report.md`
- `obsidian-qollab-doku/sdd/task-11-brief.md`
- `obsidian-qollab-doku/sdd/task-15-report-runde2.md`
- `obsidian-qollab-doku/sdd/task-17-report.md`
- `obsidian-qollab-doku/sdd/task-19-report.md`
- `README.md`

**Nicht** ausgewertet — ein Versuch, der hier fehlt, ist nicht damit auch ungeprüft:

- obsidian-qollab-doku/sdd/ — 166 Dateien. Am 2026-08-12 wurde die task-*-Reihe (50 Dateien) gezielt nach verworfenen Ansaetzen durchsucht statt vollstaendig gelesen; Treffer sind als S-01 bis S-08 aufgenommen. Ein Ansatz, der dort in Prosa steht, ohne eines der Suchmuster zu benutzen, kann weiterhin fehlen.
- Die mess/*-Branches tragen Messlaeufe, die auf master nicht liegen.
