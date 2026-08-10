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

// --- Die Bibliotheksgrenze ---------------------------------------------------
// `diff_linesToChars_` deckelt die Zahl der VERSCHIEDENEN Zeilen. Ab der 40.000.
// verschiedenen Zeile des ERSTEN Textes faellt alles ab dort zu EINEM Token
// zusammen (`node_modules/diff-match-patch/index.js:492` Abbruch, `:507`
// `maxLines = 40000`; die 65.535 auf `:509` gelten erst fuer den zweiten
// Text). Gemessen mit
// `spike/schnitt/probe-grenze-schwelle.mjs`:
//
//   gesamt | verschieden | chars1 | kollabiert
//    45000 |       39999 |  45000 | false
//    45000 |       40000 |  40000 | true
//
// Die Reihe mit konstant 45.000 Gesamtzeilen belegt zugleich, dass die
// Bibliothek an den VERSCHIEDENEN und nicht an den Gesamt-Zeilen bricht.
//
// Im kollabierten Schwanz deckt eine einzige Op den ganzen Rest der Notiz.
// Bearbeiten zwei Geraete NEBENLAEUFIG zwei verschiedene Stellen dort, loeschen
// beide denselben Riesenblock und fuegen jeweils ihre eigene Fassung ein — beide
// Einfuegungen ueberleben die Vereinigung, der Schwanz steht doppelt da
// (`spike/schnitt/probe-grenze-nebenlaeufig.mjs`, 45.000 Zeilen: 5.001 doppelt).
// K.o.-Kriterium 1 bleibt gewahrt, `docs/produktziel.md` Gruppe 1 „Nichts wird
// verdoppelt" faellt.

// Knapp oberhalb der Grenze: 41.000 verschiedene Zeilen. Der kollabierte Schwanz
// umfasst 41.000 − 39.999 = 1.001 Zeilen.
const OBERHALB = 41000;
// Knapp unterhalb der eingebauten Schwelle (39.000). Die Schwelle zaehlt die
// verschiedenen Zeilen BEIDER Texte zusammen; hier sind das 38.801.
const UNTERHALB = 38800;

function grundtext(zeilen: number): string {
  const z: string[] = [];
  for (let i = 0; i < zeilen; i++) z.push(`n0-base-${i}`);
  return z.join(NL) + NL;
}

function mitMarke(text: string, idx: number, marke: string): string {
  const z = text.split(NL);
  z.splice(idx, 0, marke);
  return z.join(NL);
}

// Zwei Replikate mit gemeinsamem Ausgangsstand bearbeiten unabhaengig zwei
// VERSCHIEDENE Stellen, danach sehen sie einander. Kein Transport, kein Tor.
function nebenlaeufig(basis: string, a: string, b: string, modus?: DiffModus): string {
  const quelle = new CrdtManager();
  if (modus) quelle.diffModus = modus;
  quelle.setContent('gross.md', basis);
  const saat = quelle.encodeState('gross.md');

  const mach = (neu: string): Uint8Array => {
    const c = new CrdtManager();
    if (modus) c.diffModus = modus;
    c.applyUpdate('gross.md', saat);
    c.setContent('gross.md', neu);
    return c.encodeState('gross.md');
  };

  const ziel = new Y.Doc();
  Y.applyUpdate(ziel, mach(a));
  Y.applyUpdate(ziel, mach(b));
  return ziel.getText('content').toString();
}

// Wie viele Grundtextzeilen stehen mehr als einmal da?
function doppelt(ergebnis: string, zeilen: number): number {
  const zaehler = new Map<string, number>();
  for (const z of ergebnis.split(NL)) {
    if (z.length > 0) zaehler.set(z, (zaehler.get(z) ?? 0) + 1);
  }
  let summe = 0;
  for (let i = 0; i < zeilen; i++) {
    const c = zaehler.get(`n0-base-${i}`) ?? 0;
    if (c > 1) summe += c - 1;
  }
  return summe;
}

describe('setContent: jenseits der Zeilengrenze von diff_linesToChars_', () => {
  it('verdoppelt den kollabierten Schwanz nicht', () => {
    const basis = grundtext(OBERHALB);
    const erg = nebenlaeufig(
      basis,
      mitMarke(basis, OBERHALB - 200, 'n0-DA-1'),
      mitMarke(basis, OBERHALB - 100, 'n0-DB-1')
    );
    const zeilen = erg.split(NL).filter((z) => z.length > 0);
    // Beide Einfuegungen kommen an — sonst misst der Test nur, dass nichts
    // passiert ist.
    expect(zeilen).toContain('n0-DA-1');
    expect(zeilen).toContain('n0-DB-1');
    expect(doppelt(erg, OBERHALB)).toBe(0);
    expect(zeilen.length).toBe(OBERHALB + 2);
  });

  // GEGENPROBE zum Instrument: dieselbe Lage UNTERHALB der Grenze ist schon im
  // Bestand sauber. Zeigt der Zaehler auch hier eine Verdopplung, misst er den
  // Kollaps nicht, sondern irgendetwas anderes.
  it('unterhalb der Grenze ist dieselbe Lage sauber', () => {
    const basis = grundtext(UNTERHALB);
    const erg = nebenlaeufig(
      basis,
      mitMarke(basis, UNTERHALB - 200, 'n0-DA-1'),
      mitMarke(basis, UNTERHALB - 100, 'n0-DB-1')
    );
    expect(doppelt(erg, UNTERHALB)).toBe(0);
    expect(erg.split(NL).filter((z) => z.length > 0).length).toBe(UNTERHALB + 2);
  });
});

// --- Die wichtigste Gegenprobe: unterhalb bleibt es zeilentreu ---------------
// Eine zu tief gesetzte Schwelle wuerde den Fix von `82c5426` still abschalten.
// Deshalb dieselbe aktenkundige Ersetzung wie ganz oben, aber eingebettet in
// eine Notiz knapp unterhalb der Schwelle.

const FUELL = UNTERHALB - 5; // + der 5-zeilige VOR-Block = 38.800 verschiedene

// `grundtext` endet auf genau einem NL, `VOR`/`NACH` beginnen mit einem
// Nicht-NL — die Verkettung bleibt zeilenrein.
const grossVor = (): string => grundtext(FUELL) + VOR;
const grossNach = (): string => grundtext(FUELL) + NACH;

function replikateGross(anzahl: number, modus?: DiffModus): string[] {
  const quelle = new CrdtManager();
  if (modus) quelle.diffModus = modus;
  quelle.setContent('g.md', grossVor());
  const saat = quelle.encodeState('g.md');

  const repl: CrdtManager[] = [];
  for (let i = 0; i < anzahl; i++) {
    const c = new CrdtManager();
    if (modus) c.diffModus = modus;
    c.applyUpdate('g.md', saat);
    repl.push(c);
  }
  const nach = grossNach();
  for (const c of repl) c.setContent('g.md', nach);
  for (const a of repl) {
    for (const b of repl) if (a !== b) a.applyUpdate('g.md', b.encodeState('g.md'));
  }
  return repl.map((c) => c.getContent('g.md'));
}

describe('setContent: unterhalb der Schwelle bleibt der Fix von 82c5426 aktiv', () => {
  it.each([2, 3])(
    '%i Replikate verlieren die Grundtextzeile auch in einer grossen Notiz nicht',
    (n) => {
      const erg = replikateGross(n);
      for (const t of erg) expect(t).toBe(erg[0]);
      expect(erg[0].split(NL)).toContain('n5-base-1');
      expect(erg[0]).toBe(grossNach());
    }
  );

  // GEGENPROBE: bei dieser Groesse verliert der Bestandsschalter die Zeile
  // weiterhin. Waere der Test blind, meldete er auch hier gruen.
  it('Bestandsschalter `semantisch` verliert sie bei derselben Groesse', () => {
    const erg = replikateGross(2, 'semantisch');
    for (const t of erg) expect(t).toBe(erg[0]);
    expect(erg[0].split(NL)).not.toContain('n5-base-1');
  });
});
