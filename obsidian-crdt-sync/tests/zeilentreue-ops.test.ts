import * as Y from 'yjs';
import { CrdtManager, DiffModus } from '../src/crdt-manager';

// Die dritte Untervariante des Grundtext-Verlusts ab vier Geraeten, als Test.
//
// BEFUND (`.superpowers/sdd/grundtext-n-2026-08-09.md`, Teil 4; ohne jeden
// Harness reproduziert in `spike/schnitt/probe-idempotenz.mjs`):
// `CrdtManager.setContent` rechnet ZEICHEN-Diffs. Teilen zwei benachbarte Zeilen
// ein Praefix, legt der Diff seine DELETE-Op UEBER die Zeilengrenze — sie
// verschluckt eine unbeteiligte Grundtextzeile, und die INSERT-Op schreibt deren
// Mitte als NEUES Item zurueck:
//
//   ="n5-base-0|n5-"  -"D3-9|n5-base-1|n5-D3"  +"base"  ="-1|n5-base-2|"
//
// Fuer sich ist das textneutral. Der Schaden ist die fehlende IDEMPOTENZ:
// rechnen mehrere Replikate dieselbe Ersetzung unabhaengig voneinander, dann
// verschmelzen die DELETE-Haelften (gleiche Items) und die INSERT-Haelften
// STAPELN sich (verschiedene Items). Gemessen am Bestand:
//
//   1 Replikat  -> "n5-base-0|n5-base-1|n5-base-2|"             Zeile da
//   2 Replikate -> "n5-base-0|n5-basebase-1|n5-base-2|"         Zeile TOT
//   3 Replikate -> "n5-base-0|n5-basebasebase-1|n5-base-2|"     Zeile TOT
//
// Die Konvergenz bleibt dabei intakt — alle Replikate haben denselben Text, den
// OHNE die Zeile. Genau der Fall, vor dem `docs/produktziel.md` warnt:
// „Divergenz 0" ist kein Erfolgsmass.

const NL = String.fromCharCode(10);

// Der Doc-Stand, den alle Replikate gemeinsam haben (zwei fremde Zeilen um eine
// Grundtextzeile herum) — und der Text, auf den jedes Replikat unabhaengig
// zurueckgeht. `n5-base-1` fasst dabei NIEMAND an.
const VOR = ['n5-base-0', 'n5-D3-9', 'n5-base-1', 'n5-D3-1', 'n5-base-2'].join(NL) + NL;
const NACH = ['n5-base-0', 'n5-base-1', 'n5-base-2'].join(NL) + NL;

// `anzahl` Replikate mit IDENTISCHEN Item-IDs, jedes rechnet dieselbe Ersetzung
// unabhaengig, danach sehen sie einander (Sidecar-Austausch). Kein Transport,
// kein Herkunftstor, kein Parkplatz — nur die Umrechnung Text -> Ops.
function replikate(anzahl: number, modus?: DiffModus): string[] {
  const quelle = new CrdtManager();
  if (modus) quelle.diffModus = modus;
  quelle.setContent('n5.md', VOR);
  const saat = quelle.encodeState('n5.md');

  const repl: CrdtManager[] = [];
  for (let i = 0; i < anzahl; i++) {
    const c = new CrdtManager();
    if (modus) c.diffModus = modus;
    c.applyUpdate('n5.md', saat);
    repl.push(c);
  }
  for (const c of repl) c.setContent('n5.md', NACH);
  for (const a of repl) {
    for (const b of repl) if (a !== b) a.applyUpdate('n5.md', b.encodeState('n5.md'));
  }
  return repl.map((c) => c.getContent('n5.md'));
}

describe('setContent: dieselbe Ersetzung mehrfach gerechnet', () => {
  // Ohne gesetzten `diffModus` — der Test prueft also den AUSGELIEFERTEN Stand,
  // nicht einen Schalter. Wer ihn mit `QOLLAB_DIFF_MODUS=<alter Wert>` laufen
  // laesst, misst absichtlich den Bestand und bekommt ihn rot.
  it.each([2, 3, 4])(
    '%i Replikate verlieren die unberuehrte Grundtextzeile nicht',
    (n) => {
      const erg = replikate(n);
      // Konvergenz ist hier KEIN Erfolgsmass, sondern nur die Vorbedingung
      // dafuer, dass die naechste Zusicherung ueberhaupt etwas aussagt.
      for (const t of erg) expect(t).toBe(erg[0]);
      expect(erg[0].split(NL)).toContain('n5-base-1');
      expect(erg[0]).toBe(NACH);
    }
  );

  // GEGENPROBE zum Test selbst: sieht er ueberhaupt etwas? Am Bestandsschalter
  // muss er die Zeile VERLIEREN — sonst waere „gruen" kein Nachweis, sondern
  // ein blindes Instrument (die Akte kennt sieben davon).
  it('Bestandsschalter `semantisch` verliert die Zeile ab 2 Replikaten', () => {
    expect(replikate(1, 'semantisch')[0].split(NL)).toContain('n5-base-1');
    for (const n of [2, 3, 4]) {
      const erg = replikate(n, 'semantisch');
      for (const t of erg) expect(t).toBe(erg[0]);
      expect(erg[0].split(NL)).not.toContain('n5-base-1');
    }
  });
});

// --- Die Op-FORM ------------------------------------------------------------
// Der Test oben misst die WIRKUNG. Er allein wuerde auch gruen, wenn die Wirkung
// aus einem anderen Grund eintritt. Die Tests hier messen die EIGENSCHAFT, auf
// die der Eingriff zielt: jede Op, die in den CRDT geht, deckt GANZE Zeilen.
//
// Warum eigens: eine Gegenprobe am 2026-08-09 (Op-Form maximal grob gestellt)
// hat gezeigt, dass nur VIER der 554 Alt-Tests die Op-Form ueberhaupt sehen.
// Das Netz an dieser Stelle ist duenn, und sie liegt im Kern-Datenpfad.

type Delta = { retain?: number; insert?: string; delete?: number };

// Die Ops, die `setContent` TATSAECHLICH in den Doc gelegt hat — abgelesen an
// einem Probe-Doc mit demselben Saatstand: `Y.applyUpdate` traegt dort nur die
// neu hinzugekommenen Structs nach, und `observe` meldet sie als Delta gegen den
// ALTEN Text. Kein Zugriff auf Privates; gemessen wird, was im CRDT ankommt.
function ops(vor: string, nach: string, modus?: DiffModus): Delta[] {
  const m = new CrdtManager();
  if (modus) m.diffModus = modus;
  m.setContent('n.md', vor);

  const probe = new Y.Doc();
  Y.applyUpdate(probe, m.encodeState('n.md'));
  let delta: Delta[] = [];
  probe.getText('content').observe((e) => {
    delta = e.delta as Delta[];
  });

  m.setContent('n.md', nach);
  Y.applyUpdate(probe, m.encodeState('n.md'));
  return delta;
}

// Deckt jede DELETE- und INSERT-Op ganze Zeilen? Der Cursor laeuft ueber den
// ALTEN Text (so ist das Yjs-Delta definiert): `retain` und `delete` schieben
// ihn, `insert` nicht.
function zeilentreu(delta: Delta[], vor: string): boolean {
  let pos = 0;
  const amZeilenanfang = () => pos === 0 || vor[pos - 1] === NL;
  for (const d of delta) {
    if (d.retain !== undefined) {
      pos += d.retain;
    } else if (d.delete !== undefined) {
      const stueck = vor.slice(pos, pos + d.delete);
      if (!amZeilenanfang() || !stueck.endsWith(NL)) return false;
      pos += d.delete;
    } else if (d.insert !== undefined) {
      if (!amZeilenanfang() || !d.insert.endsWith(NL)) return false;
    }
  }
  return true;
}

describe('setContent: Form der erzeugten Ops', () => {
  it('erzeugt ausschliesslich zeilentreue Ops', () => {
    expect(zeilentreu(ops(VOR, NACH), VOR)).toBe(true);
  });

  // GEGENPROBE zum Pruefer: `semantisch` ist der Bestand, und fuer genau diese
  // Eingabe legt er seine DELETE-Op ueber die Zeilengrenze. Waere `zeilentreu`
  // blind, meldete es auch hier `true`.
  it('Bestandsschalter `semantisch` ist an derselben Eingabe NICHT zeilentreu', () => {
    expect(zeilentreu(ops(VOR, NACH, 'semantisch'), VOR)).toBe(false);
  });

  // Zeilentreue allein ist zu billig: der Mutationsmodus `ganz` (alles raus,
  // alles rein) erfuellt sie trivial und zerstoert dabei JEDE Item-Identitaet.
  // Der Eingriff muss sparsam bleiben — unberuehrte Zeilen behalten ihre Items,
  // sonst dedupliziert der Merge nicht mehr, sondern konkateniert.
  it('laesst die unberuehrten Zeilen als `retain` stehen', () => {
    const d = ops(VOR, NACH);
    const behalten = d.reduce((s, o) => s + (o.retain ?? 0), 0);
    const geloescht = d.reduce((s, o) => s + (o.delete ?? 0), 0);
    // Genau die beiden fremden Zeilen gehen raus, und es wird NICHTS eingefuegt
    // — jedes uebrige Zeichen behaelt damit sein Item.
    expect(geloescht).toBe(VOR.length - NACH.length);
    expect(d.some((o) => o.insert !== undefined)).toBe(false);
    // Yjs schneidet das abschliessende `retain` weg; die letzte unberuehrte
    // Zeile taucht im Delta deshalb nicht auf. Darum `> 0` statt `NACH.length`.
    expect(behalten).toBeGreaterThan(0);

    // Gegenprobe: `ganz` ist zwar zeilentreu, aber genau nicht sparsam.
    const grob = ops(VOR, NACH, 'ganz');
    expect(zeilentreu(grob, VOR)).toBe(true);
    expect(grob.reduce((s, o) => s + (o.retain ?? 0), 0)).toBe(0);
  });
});
