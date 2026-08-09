import * as Y from 'yjs';
import { diff_match_patch, DIFF_DELETE, DIFF_INSERT, DIFF_EQUAL } from 'diff-match-patch';

type Diff = [number, string];

const istHoch = (c: number): boolean => c >= 0xd800 && c <= 0xdbff;
const istNiedrig = (c: number): boolean => c >= 0xdc00 && c <= 0xdfff;

// Richtet Diff-Grenzen auf ganze Zeichen aus.
//
// Der Grund, gemessen (Szenariosuche 2026-07-31): `diff-match-patch` UND
// `Y.Text` arbeiten beide auf UTF-16-Einheiten. Ein Zeichen ausserhalb der
// Basisebene — jedes Emoji, seltene CJK-Zeichen, mathematische Symbole — besteht
// dort aus zwei Einheiten (einem Surrogatpaar), und der Diff setzt die Op-Grenze
// bereitwillig mitten hinein:
//
//   'Stimmung: 😀' → 'Stimmung: 😁'
//   EQUAL "\uD83D" · DELETE "\uDE00" · INSERT "\uDE01"
//
// `Y.Text` splittet den ContentString an dieser Grenze und ersetzt das verwaiste
// Halbzeichen durch U+FFFD. Der Doc ist danach dauerhaft kaputt; die `.md` sieht
// zunaechst noch richtig aus, bis irgendein spaeterer Edit den Stand
// zurueckschreibt. Auf der Platte stehen dann `ef bf bd` statt `f0 9f 98 81` —
// nicht wiederherstellbar, und der Sync traegt es zum anderen Geraet. Es braucht
// dafuer kein zweites Geraet.
//
// Die Regel ist bewusst konservativ: Endet ein unveraenderter Abschnitt mit
// einer hohen Haelfte, wandert sie in die Aenderung; beginnt der folgende
// unveraenderte Abschnitt mit einer niedrigen Haelfte, ebenfalls. Damit liegt
// jedes betroffene Paar vollstaendig innerhalb einer Aenderung und wird nie
// gesplittet. Preis: Ein Zeichen am Rand einer Aenderung bekommt neue Item-IDs,
// obwohl es unveraendert bleibt — ein paar Byte, und nur bei Nicht-BMP-Zeichen.
// Die Op-Sparsamkeit fuer alles andere bleibt unberuehrt (Test dazu in
// `surrogate-pairs.test.ts`).
export function alignSurrogateBoundaries(roh: Diff[]): Diff[] {
  const aus: Diff[] = [];
  let i = 0;
  while (i < roh.length) {
    if (roh[i][0] === DIFF_EQUAL) {
      aus.push([roh[i][0], roh[i][1]]);
      i++;
      continue;
    }
    // Zusammenhaengende Aenderung einsammeln: dmp liefert DELETE und INSERT als
    // Paar, die Reihenfolge ist nicht garantiert.
    let entfernt = '';
    let eingefuegt = '';
    while (i < roh.length && roh[i][0] !== DIFF_EQUAL) {
      if (roh[i][0] === DIFF_DELETE) entfernt += roh[i][1];
      else eingefuegt += roh[i][1];
      i++;
    }

    // Der unveraenderte Abschnitt davor endet mit einer hohen Haelfte: Sie
    // gehoert zum Zeichen, das die Aenderung anfasst.
    const davor = aus.length > 0 ? aus[aus.length - 1] : undefined;
    if (davor && davor[0] === DIFF_EQUAL && davor[1].length > 0) {
      const letzte = davor[1].charCodeAt(davor[1].length - 1);
      if (istHoch(letzte)) {
        const zeichen = davor[1][davor[1].length - 1];
        davor[1] = davor[1].slice(0, -1);
        entfernt = zeichen + entfernt;
        eingefuegt = zeichen + eingefuegt;
      }
    }

    // Der unveraenderte Abschnitt danach beginnt mit einer niedrigen Haelfte:
    // dasselbe von der anderen Seite.
    const danach = i < roh.length ? roh[i] : undefined;
    if (danach && danach[0] === DIFF_EQUAL && danach[1].length > 0) {
      const erste = danach[1].charCodeAt(0);
      if (istNiedrig(erste)) {
        const zeichen = danach[1][0];
        danach[1] = danach[1].slice(1);
        entfernt = entfernt + zeichen;
        eingefuegt = eingefuegt + zeichen;
      }
    }

    if (entfernt.length > 0) aus.push([DIFF_DELETE, entfernt]);
    if (eingefuegt.length > 0) aus.push([DIFF_INSERT, eingefuegt]);
  }
  // Leergelaufene Abschnitte fallen raus, damit die Anwendungsschleife nichts
  // Sinnloses transportiert.
  return aus.filter((d) => d[1].length > 0);
}

// Task 17/F-1: Trägt `update` nachweislich Yjs-Ops? Nötig, um einen echten
// v0.1-State (headerlos, aber gültig) von einer nur unvollständig
// materialisierten Datei zu unterscheiden — für `decodeStateFile` sehen beide
// identisch aus (`guid: null`). Läuft auf einem Wegwerf-Doc; kein geladener
// Zustand wird berührt.
//
// Task 17/R-1: „parst" genügt als Nachweis NICHT. Yjs liest `[0x00, 0x00]` als
// „0 Struct-Clients, 0 Delete-Set-Clients" und ignoriert den Rest — jeder
// nullgefüllte Puffer ab 2 Byte parst damit fehlerfrei zu einem leeren Doc, und
// ein genullter Kopf vor einer intakten Nutzlast ebenfalls.
// Nullfüllung ist aber genau die zweite Erscheinungsform halb materialisierter
// Dateien (fehlgeschlagene OneDrive-Hydrierung, abgebrochener NTFS-Extend,
// Sparse-/Platzhalter-Zustände). Deshalb ist das Kriterium `clients.size > 0` —
// dieselbe Unterscheidung, die `hasOps` unten für den geladenen Doc trifft.
//
// Preis der Verschärfung: Ein LEGITIMER v0.1-State kann ops-frei sein — v0.1
// rief `saveState` auch für eine leere Note, und `encodeStateAsUpdate` eines
// nie befüllten Docs sind exakt die zwei Nullbytes. Eine solche Datei wird ab
// jetzt weder gelöscht noch gemergt, sondern als „Stand unbekannt" gemeldet.
// Verloren geht dabei nichts (sie trägt per Konstruktion keine Op); es bleibt
// eine 2-Byte-Datei liegen und eine Meldung pro Pfad und Sitzung. Umgekehrt
// kostete das schwächere Kriterium eine nullgefüllte Datei, die den vollen
// State trug — Löschung bzw. frische Inkarnation. Der Tausch ist einseitig.
//
// Task 19/A (Merge-Review M-1): Genau dieser Preis wird unten von
// `isEmptyYjsState` zurückgekauft — für die eine Byte-Folge, die beweisbar der
// leere State ist.
export function carriesYjsOps(update: Uint8Array): boolean {
  if (update.length === 0) return false;
  const probe = new Y.Doc();
  try {
    Y.applyUpdate(probe, update);
    return (probe.store as any).clients.size > 0;
  } catch {
    return false;
  } finally {
    probe.destroy();
  }
}

// Task 20 (Nachtrag): Der Text, den ein fremder State trägt — ohne ihn in einen
// lebenden Doc zu mergen. Gebraucht für die Frage „fehlt uns aus dieser
// verworfenen Fassung überhaupt etwas?"; ein Merge wäre dafür die falsche
// Antwort, weil er den Zustand verändert, den wir gerade beurteilen.
// Unlesbares gilt als leer — der Aufrufer hat die Lesbarkeit über
// `carriesYjsOps` bereits festgestellt.
export function textFromUpdate(update: Uint8Array): string {
  const probe = new Y.Doc();
  try {
    Y.applyUpdate(probe, update);
    return probe.getText('content').toString();
  } catch {
    return '';
  } finally {
    probe.destroy();
  }
}

// Task 19/A (Merge-Review M-1): Ist `update` der Yjs-State eines Docs, das nie
// befüllt wurde? `Y.encodeStateAsUpdate(new Y.Doc())` liefert dafür EXAKT zwei
// Nullbytes — „0 Struct-Clients, 0 Delete-Set-Clients" und sonst nichts.
//
// Die Länge ist der ganze Trick, und sie trennt sauber gegen die zwei
// Erscheinungsformen halb materialisierter Dateien, die `carriesYjsOps` oben
// abwehrt:
//   - Nullfüllung erhält die GRÖSSE (OneDrive-Platzhalter, NTFS-Extend). Eine
//     nullgefüllte Datei von 2 Byte Länge kann nur aus einer 2-Byte-Datei
//     entstanden sein — und die war der leere State.
//   - Trunkierung schneidet einen echten State ab, und der beginnt mit
//     `[0x01, …]` (mindestens ein Struct-Client). Seine 2-Byte-Fassung ist
//     `[0x01, x]`, nie `[0x00, 0x00]`.
// `[0x00, 0x00]` ist deshalb kein Zweifelsfall, sondern ein Nachweis.
//
// KEIN Ersatz für `carriesYjsOps`: der Aufrufer muss zusätzlich wissen, dass die
// Datei aus einer Quelle stammt, die leere States überhaupt schreibt (v0.1 tat
// das, siehe `decodeSiblings`). Deshalb zwei Prädikate statt eines gelockerten.
export function isEmptyYjsState(update: Uint8Array): boolean {
  return update.length === 2 && update[0] === 0 && update[1] === 0;
}

// Nullfüllungs-Fix: Der Befund „diese Nutzlast wurde auf NULL gesetzt" — als
// eigenes Prädikat, weil `carriesYjsOps` ihn mit der TRUNKIERUNG in einem `false`
// zusammenwirft und die beiden verschieden behandelt werden müssen:
//   - Trunkiert: `Y.applyUpdate` WIRFT, integriert dabei aber Structs, die es
//     schon gelesen hat. Dieser Teilstand ist gewollt und geprüft (siehe
//     `truncated-sibling-merge.test.ts`) — die Datei bleibt im Merge.
//   - Genullt: `Y.applyUpdate` wirft NIE. Yjs liest `[0x00, 0x00]` als „0
//     Struct-Clients, 0 Delete-Set-Clients" und ignoriert den Rest. Es gibt
//     keinen Teilstand, nur eine Datei, die vorgibt eine Inkarnation zu sein.
//     Genau die darf im Tie-Break nicht antreten.
// Das Kriterium ist deshalb „parst FEHLERFREI und trägt trotzdem keine Op" —
// länger als der leere State, den `isEmptyYjsState` als gesund ausweist.
export function isNulledYjsState(update: Uint8Array): boolean {
  if (isEmptyYjsState(update)) return false;
  const probe = new Y.Doc();
  try {
    Y.applyUpdate(probe, update);
    return (probe.store as any).clients.size === 0;
  } catch {
    return false; // geworfen = trunkiert, nicht genullt
  } finally {
    probe.destroy();
  }
}

// DER SCHALTER fuer die Op-Folge von `setContent`. Standard ist seit 2026-08-09
// `zeile`; die drei aelteren Staende bleiben erreichbar, damit der jeweilige
// Bestand nachmessbar bleibt (dieselbe Praxis wie bei `sweepSchrankeStandard`).
//
//   'zeile'      — STANDARD seit 2026-08-09. Der Diff wird ueber
//                  `diff_linesToChars_` auf ZEILEN als kleinste Einheit gerechnet,
//                  jede Op deckt danach ganze Zeilen. Begruendung und Messung
//                  unten am Standardwert.
//   'roh'        — Bestand bis 2026-08-07. `diff_main` pur, siehe Begruendung an
//                  `setContent`.
//   'semantisch' — Bestand vom 2026-08-07 bis 2026-08-09: zusaetzlich
//                  `diff_cleanupSemantic`. Er sollte den Schaden beheben, dass
//                  eine geloeschte Zeile als Stueck UEBER die Zeilengrenze
//                  geloescht wird (`"2\nzeile-"` statt `"zeile-2\n"`, gemessen),
//                  wenn zwei benachbarte Zeilen ein Praefix teilen — eine fremde
//                  Einfuegung, die in diesem Stueck verankert ist, landet beim
//                  Merge mitten in der Nachbarzeile. Er GLAETTET den Diff, er
//                  ERZWINGT die Zeilentreue aber nicht; genau daran hing der
//                  Rest-Verlust ab vier Geraeten.
//   'ganz'       — MUTATIONSPROBE, kein Kandidat: der maximal grobe Diff (alles
//                  raus, alles rein). Jedes Zeichen bekommt neue Item-IDs. Damit
//                  ist pruefbar, ob die Verdopplungs-Spalten ueberhaupt steigen
//                  KOENNEN; bleiben sie auch hier stehen, ist das Mass blind und
//                  keine Aussage ueber die Verdopplung traegt.
//
// GEMESSEN (Harness `spike/zzRF-*`, 720 Zustellordnungen je Zelle, Schalter
// `SPIKE_DIFF`):
//   - `semantisch` nimmt den Grundtext-Verlust der offline geloeschten Zeile von
//     296/720 auf 0/720 — in beiden Konfliktmodi, mit und ohne Sweep-Schranke.
//     Verdopplung, stiller Verlust, Divergenz und „Loeschung kam durch" bleiben
//     in ALLEN 24 gemessenen Zellen ziffergleich zum Bestand.
//   - Die Gegenhypothese („groebere Diffs treiben die Verdopplung hoch") ist am
//     `ganz`-Arm belegt: dort steht in JEDER Zelle 720/720 verdoppelte
//     Grundtextzeilen, und die Suite wird rot. Das Mass ist also nicht blind —
//     `semantisch` laesst es trotzdem bei 0.
export type DiffModus = 'roh' | 'semantisch' | 'ganz' | 'zeile';

// Der Standardwert jedes neuen CrdtManager — dieselbe Bauform wie
// `sweepSchrankeStandard` in `sync-handler.ts`. `process` ist im Browser-Bundle
// nicht definiert, deshalb der typeof-Riegel.
//
// Von 2026-08-07 bis 2026-08-09 stand der Standard auf 'semantisch': der rohe
// Diff zerstoert bei einer Offline-Loeschung die NACHBARZEILE, sobald beide
// Zeilen ein gemeinsames Anfangszeichen haben — also bei jeder Aufzaehlung,
// jeder Ueberschriftenfolge, jeder Checkbox-Liste (296/720 = 41 %, gemessen
// ueber sieben Praefix-Formen).
//
// SEIT 2026-08-09 STEHT ER AUF 'zeile'. Der Grund ist eine Eigenschaft, die
// `semantisch` nicht hat: IDEMPOTENZ. Ein Zeichen-Diff kann seine DELETE-Op ueber
// die Zeilengrenze legen, eine unbeteiligte Grundtextzeile verschlucken und ihre
// Mitte als NEUES Item zurueckschreiben. Fuer sich ist das textneutral — rechnen
// aber mehrere Geraete dieselbe Ersetzung unabhaengig, verschmelzen die
// DELETE-Haelften (gleiche Items) und die INSERT-Haelften STAPELN sich. Ohne
// jeden Harness reproduzierbar (`spike/schnitt/probe-idempotenz.mjs`, als Test
// in `tests/zeilentreue-ops.test.ts`), Bestand gegen Standard:
//
//   Replikate:      1                 2                   3
//   'semantisch'    n5-base-1 da      n5-basebase-1       n5-basebasebase-1
//   'zeile'         n5-base-1 da      n5-base-1 da        n5-base-1 da
//
// Die Konvergenz ist dabei durchgehend intakt: alle Geraete haben denselben
// Text, den OHNE die Zeile — „Divergenz 0" ist kein Erfolgsmass.
//
// GEMESSEN (`spike/schnitt/mehrfach.mjs`, je 200 Seeds x 10 Notizen x 8
// Basiszeilen = 16.000 Grundtextzeilen, drei DET-Familien, N = 4):
//
//   DET   WEG semantisch -> zeile    verlust        verdopplung
//   42    2 -> 0                     124 -> 112     888 -> 902
//    7    1 -> 0                     101 ->  96     904 -> 913
//   99    1 -> 0                     105 -> 101     816 -> 830
//
// Bei N = 2 und N = 3 ist WEG in beiden Armen null; der Eingriff nimmt dort
// nichts weg. DER PREIS, ausdruecklich: die Verdopplung steigt um 1,0-1,7 %.
// Ein groeberer Diff gibt mehr Zeichen neue Item-IDs, und ein Zeichen mit neuer
// ID kann bei nebenlaeufiger Bearbeitung doppelt stehen bleiben. Grundtext-
// Verlust ist K.o.-Kriterium 1, sichtbare Verdopplung nicht — der Tausch ist
// nach `docs/produktziel.md` §5 („Sichtbarkeit statt Stille") der richtige.
//
// 'roh', 'semantisch' und 'ganz' bleiben als Schalterstaende erhalten, damit der
// jeweilige Bestand jederzeit nachmessbar ist.
const diffModusStandard: DiffModus =
  (typeof process !== 'undefined'
    ? (process.env?.QOLLAB_DIFF_MODUS as DiffModus | undefined)
    : undefined) ?? 'zeile';

export class CrdtManager {
  private dmp = new diff_match_patch();
  private docs = new Map<string, Y.Doc>();
  private disposed = false;

  // Standard = Bestand. Wird nur von den Messlaeufen umgelegt.
  diffModus: DiffModus = diffModusStandard;
  // AKTIVITAETSPROBE: wie oft hat der Schalter die Op-Folge TATSAECHLICH
  // veraendert? Ohne diesen Zaehler waere „keine Wirkung gemessen" nicht von
  // „Schalter tot" zu unterscheiden.
  //
  // Einschraenkung, ausdruecklich: Fuer 'semantisch' ist es ein Differenz-,
  // fuer 'ganz' und 'zeile' ein reiner LAUF-Zaehler. Ein Differenzzaehler
  // brauchte dort einen zweiten, verworfenen `diff_main` je Aufruf — im
  // Standardpfad waere das der doppelte Preis fuer eine Diagnosezahl.
  diffGeaendert = 0;

  private getOrCreate(filePath: string): Y.Doc {
    if (this.disposed) throw new Error('CrdtManager already disposed');
    if (!this.docs.has(filePath)) {
      this.docs.set(filePath, new Y.Doc());
    }
    return this.docs.get(filePath)!;
  }

  // Diff-basiertes Update: berechnet die minimalen Positions-Ops zwischen dem
  // aktuellen Doc-Text und content und wendet sie in EINER Transaktion an.
  // Unveränderte Zeichen behalten ihre Yjs-Item-IDs — dadurch dedupliziert der
  // Merge zweier Replikate statt zu konkatenieren.
  // WELCHE Ops das sind, entscheidet `diffOps` anhand von `diffModus`; ohne
  // umgelegten Schalter laeuft dort seit 2026-08-09 `zeile` (zeilentreue Ops).
  // Die Staende, ihre Messung und der Preis stehen an `DiffModus` oben.
  setContent(filePath: string, content: string): void {
    const doc = this.getOrCreate(filePath);
    const text = doc.getText('content');
    const current = text.toString();
    if (current === content) return;

    const diffs = alignSurrogateBoundaries(this.diffOps(current, content));
    doc.transact(() => {
      let pos = 0;
      for (const [op, data] of diffs) {
        if (op === DIFF_EQUAL) {
          pos += data.length;
        } else if (op === DIFF_INSERT) {
          text.insert(pos, data);
          pos += data.length;
        } else if (op === DIFF_DELETE) {
          text.delete(pos, data.length);
        }
      }
    });
  }

  // Die Op-Folge VOR der Surrogat-Ausrichtung. Ausgelagert, damit der
  // Messschalter an genau EINER Stelle sitzt und `setContent` unveraendert
  // bleibt. Die Ausrichtung laeuft bewusst DANACH: `diff_cleanupSemantic`
  // verschiebt Grenzen und kann dabei ein Surrogatpaar zerlegen, das die
  // Ausrichtung anschliessend wieder zusammenzieht.
  private diffOps(current: string, content: string): Diff[] {
    if (this.diffModus === 'zeile') {
      // Der Standardweg. `diff_linesToChars_` bildet jede VERSCHIEDENE Zeile auf
      // genau ein Zeichen ab; der Diff laeuft danach auf diesen Zeichen, kennt
      // also keine Grenze innerhalb einer Zeile. `diff_charsToLines_` faltet das
      // Ergebnis zurueck — jede DELETE- und INSERT-Op deckt danach ganze Zeilen.
      // `false` schaltet die Zeilenheuristik von `diff_main` ab: sie waere hier
      // eine zweite, verschachtelte Zeilenreduktion auf bereits reduziertem Text.
      //
      // Die Op-SPARSAMKEIT bleibt: unveraenderte Zeilen bleiben EQUAL und
      // behalten ihre Yjs-Item-IDs. Nur der Rand einer Aenderung wird groeber —
      // eine angefasste Zeile geht ganz raus und ganz wieder rein, statt
      // zeichenweise. Genau das ist der Punkt: dieselbe Aenderung, auf mehreren
      // Geraeten unabhaengig gerechnet, trifft damit DIESELBEN Items.
      //
      // Grenze der Bibliothek, bewusst hingenommen: `diff_linesToChars_` bricht
      // bei 65.535 verschiedenen Zeilen ab und fasst den Rest zu EINER Zeile
      // zusammen. Der Diff bleibt dann korrekt, nur grob — bei einer Notiz, die
      // diese Grenze erreicht, ist die Op-Sparsamkeit ohnehin nicht mehr das
      // Problem.
      this.diffGeaendert++;
      const a = this.dmp.diff_linesToChars_(current, content);
      const zeilenweise = this.dmp.diff_main(a.chars1, a.chars2, false) as Diff[];
      this.dmp.diff_charsToLines_(zeilenweise, a.lineArray);
      return zeilenweise.filter((d) => d[1].length > 0);
    }
    if (this.diffModus === 'ganz') {
      this.diffGeaendert++;
      const grob: Diff[] = [
        [DIFF_DELETE, current],
        [DIFF_INSERT, content],
      ];
      return grob.filter((d) => d[1].length > 0);
    }
    const roh = this.dmp.diff_main(current, content) as Diff[];
    if (this.diffModus !== 'semantisch') return roh;
    // ECHTE Kopie, nicht `roh.slice()`: `diff_cleanupSemantic` schreibt IN die
    // Tupel (`diffs[i][1] = …`). Eine flache Kopie zeigt danach auf dieselben
    // Objekte und der Vergleich meldet immer „unveraendert" — der Zaehler waere
    // blind, und blind hiesse ununterscheidbar von „Schalter tot".
    const vorher = roh.map((d) => `${d[0]} ${d[1]}`);
    this.dmp.diff_cleanupSemantic(roh);
    const gleich =
      vorher.length === roh.length &&
      roh.every((d, i) => `${d[0]} ${d[1]}` === vorher[i]);
    if (!gleich) this.diffGeaendert++;
    return roh;
  }

  hasDoc(filePath: string): boolean {
    return this.docs.has(filePath);
  }

  // Prüft ob der Doc tatsächlich Ops enthält (State-Vector nicht leer).
  // Ein frischer Y.Doc ohne jegliche Edits hat store.clients.size === 0.
  // Nach setContent (Insert-Ops) oder Delete-Ops ist clients.size > 0.
  // Wird von Guard 2 (onRemoteYjsUpdate) genutzt, um einen historienlosen
  // Frisch-Doc von einer echten Leerung (User hat allen Text gelöscht) zu
  // unterscheiden.
  hasOps(filePath: string): boolean {
    if (!this.docs.has(filePath)) return false;
    return (this.docs.get(filePath)!.store as any).clients.size > 0;
  }

  getContent(filePath: string): string {
    if (!this.docs.has(filePath)) return '';
    return this.docs.get(filePath)!.getText('content').toString();
  }

  encodeState(filePath: string): Uint8Array {
    return Y.encodeStateAsUpdate(this.getOrCreate(filePath));
  }

  applyUpdate(filePath: string, update: Uint8Array): void {
    Y.applyUpdate(this.getOrCreate(filePath), update);
  }

  mergeAndGet(filePath: string, remoteState: Uint8Array): string {
    this.applyUpdate(filePath, remoteState);
    return this.getContent(filePath);
  }

  disposeDoc(filePath: string): void {
    this.docs.get(filePath)?.destroy();
    this.docs.delete(filePath);
  }

  // Szenariosuche F3: Der Doc zieht beim Umbenennen MIT, statt verworfen und
  // unter dem neuen Pfad aus der Platte neu aufgebaut zu werden.
  //
  // Der Neuaufbau war korrekt, solange der Dateiumzug im rename-Handler
  // vollständig gelang — er ist aber genau die IO, die scheitern kann (Pfadgrenze
  // für die 22 Zeichen längere Hilfsdatei, gehaltenes Handle). Bleibt die eigene
  // Hilfsdatei am alten Pfad liegen, findet der Neuaufbau unter dem neuen Pfad
  // nichts und prägt eine FRISCHE Inkarnation über einer lebenden Historie. Der
  // Umzug im Speicher kann dagegen nicht scheitern und ist gegenüber der Platte
  // nie veraltet (die eigene Hilfsdatei wird aus genau diesem Doc geschrieben).
  //
  // Ein Doc unter dem Zielpfad beschreibt eine Datei, die dort nicht mehr liegt
  // — Obsidian benennt nicht auf eine existierende Note um. Er wird verworfen,
  // wie es `renameNote` mit `guids[newPath]` ohnehin tut.
  renameDoc(from: string, to: string): void {
    if (from === to) return;
    const doc = this.docs.get(from);
    if (!doc) return;
    this.docs.get(to)?.destroy();
    this.docs.delete(from);
    this.docs.set(to, doc);
  }

  disposeAll(): void {
    this.disposed = true;
    for (const doc of this.docs.values()) doc.destroy();
    this.docs.clear();
  }
}
