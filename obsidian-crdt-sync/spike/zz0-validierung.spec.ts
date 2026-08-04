// TEIL 0 — Validierung des Messinstruments.
//
// Bevor das Schweigen des Treibers irgendetwas beweist, muss er bekannte Fehler
// LAUT melden. Geprueft wird:
//   1. Der Zaehler selbst (occ / bewerte) erkennt Verlust und Verdopplung,
//      einseitig wie beidseitig, und faellt nicht auf Teilstrings herein.
//   2. Der Treiber reproduziert die belegte Erstkontakt-Kausalkette U1-U4
//      (task-18-report.md, „SEED steht am Ende zweimal") — ohne von Hand
//      gebaute Hilfsdateien, allein aus dem Ablauf.
//   3. Der Treiber reproduziert die Gegenprobe (byte-identische Staende ->
//      kein Duplikat) — sonst meldete er ueberall Schaden.
//   4. Der Datei-Sync selbst legt bei konkurrierenden Schreibvorgaengen eine
//      Konfliktkopie an (das Netz, das es ohne Plugin schon gibt).

import { Geraet } from './geraet';
import { Wolke } from './wolke';
import { occ, bewerte } from './invarianten';
import { setzeGuidFolge, guidQuelleAn, guidQuelleAus } from './guid-quelle';

const NOTE = 'note.md';
const KLEIN = '00000000000000000000000000000000';
const GROSS = 'ffffffffffffffffffffffffffffffff';

describe('Teil 0 — der Zaehler', () => {
  it('occ faellt nicht auf Teilstrings herein', () => {
    expect(occ('T10', 'T1')).toBe(0);
    expect(occ('T1\nT10\nT1\n', 'T1')).toBe(2);
  });

  it('bewerte meldet einseitigen Verlust', () => {
    const b = bewerte('L\nAAA\nBBB\n', 'L\nAAA\n', ['AAA', 'BBB']);
    expect(b.verlust).toEqual(['BBB']);
    expect(b.doppel).toEqual([]);
    expect(b.divergenz).toBe(true);
  });

  it('bewerte meldet einseitige Verdopplung', () => {
    const b = bewerte('L\nSEED\nSEED\n', 'L\nSEED\n', ['SEED']);
    expect(b.doppel).toEqual(['SEED']);
    expect(b.verlust).toEqual([]);
  });

  it('bewerte meldet beidseitige Verdopplung ohne Divergenz', () => {
    const b = bewerte('L\nSEED\nSEED\n', 'L\nSEED\nSEED\n', ['SEED']);
    expect(b.divergenz).toBe(false);
    expect(b.doppel).toEqual(['SEED']);
    expect(b.sauber).toBe(false);
  });
});

describe('Teil 0 — der Treiber gegen den bekannten Fehler', () => {
  beforeEach(() => guidQuelleAn());
  afterEach(() => guidQuelleAus());

  it('U1-U4: zwei unabhaengige Praegungen erzeugen die Verdopplung', async () => {
    // Praegereihenfolge unten: erst A (GROSS -> verliert den Tie-Break), dann B.
    setzeGuidFolge([GROSS, KLEIN]);
    const a = new Geraet('aaaa1111');
    const b = new Geraet('bbbb2222');
    const w = new Wolke([a, b]);
    w.saeen([a, b], NOTE, 'L1\n');

    // (U1) Beide praegen unabhaengig.
    await a.modify(NOTE);
    await b.modify(NOTE);
    expect(await a.sync.currentGuid(NOTE)).toBe(GROSS);
    expect(await b.sync.currentGuid(NOTE)).toBe(KLEIN);

    // B laedt seinen Stand hoch. Er veraltet gleich — das ist die Vorbedingung.
    w.ladeSidecarsHoch(b);

    // A editiert und laedt hoch (`.md` UND Hilfsdatei).
    a.setMd(NOTE, 'L1\nSEED\n');
    await a.modify(NOTE);
    w.ladeMdHoch(a, NOTE);
    w.ladeSidecarsHoch(a);

    // (U2) Der Datei-Sync liefert B zuerst die `.md` — der dominante Weg.
    expect(w.ladeMdHerunter(b, NOTE)).toBe(true);
    await b.modify(NOTE); // Obsidian feuert modify auf die ueberschriebene Datei
    // B hat SEED als EIGENE Op materialisiert, obwohl A's Hilfsdatei existiert:
    // ihre Kennung ist fremd, mergeCompatible ueberspringt sie.
    expect(b.crdt.getContent(NOTE)).toBe('L1\nSEED\n');
    expect(await b.sync.currentGuid(NOTE)).toBe(KLEIN);

    // (U3) A bekommt B's (inzwischen veraltete) Hilfsdatei -> Tie-Break.
    w.ladeSidecarsHerunter(a);
    await a.poll(NOTE);
    expect(await a.sync.currentGuid(NOTE)).toBe(KLEIN);
    w.ladeSidecarsHoch(a);
    w.ladeMdHoch(a, NOTE);

    // (U4) A's neue Hilfsdatei erreicht B: zwei SEED-Ketten unter einer Kennung.
    w.ladeSidecarsHerunter(b);
    await b.poll(NOTE);

    const befund = bewerte(a.md(NOTE), b.md(NOTE), ['SEED', 'L1']);
    // Das ist der belegte Fehler. Meldet der Treiber ihn NICHT, taugt er nicht.
    expect(befund.doppel).toContain('SEED');
  });

  it('Gegenprobe: identischer Text auf beiden Seiten -> kein Duplikat', async () => {
    setzeGuidFolge([GROSS, KLEIN]);
    const a = new Geraet('aaaa1111');
    const b = new Geraet('bbbb2222');
    const w = new Wolke([a, b]);
    w.saeen([a, b], NOTE, 'L1\nSEED\n');

    await a.modify(NOTE);
    await b.modify(NOTE);
    w.ladeSidecarsHoch(a);
    w.ladeSidecarsHoch(b);
    w.ladeSidecarsHerunter(a);
    w.ladeSidecarsHerunter(b);
    await a.poll(NOTE);
    await b.poll(NOTE);

    const befund = bewerte(a.md(NOTE), b.md(NOTE), ['SEED', 'L1']);
    expect(befund.doppel).toEqual([]);
    expect(befund.verlust).toEqual([]);
    expect(befund.divergenz).toBe(false);
  });
});

describe('Teil 0 — das Netz, das der Datei-Sync ohne Plugin schon stellt', () => {
  it('gleichzeitige Aenderung ohne Hilfsdateien erzeugt eine Konfliktkopie', () => {
    const a = new Geraet('aaaa1111');
    const b = new Geraet('bbbb2222');
    const w = new Wolke([a, b]);
    w.saeen([a, b], NOTE, 'L1\n');

    a.setMd(NOTE, 'L1\nAAA\n');
    b.setMd(NOTE, 'L1\nBBB\n');
    w.ladeMdHoch(a, NOTE); // A ist zuerst da
    w.ladeMdHoch(b, NOTE); // B kollidiert -> Kopie
    expect(w.kopien.get(b.id)).toEqual(['L1\nBBB\n']);
    w.ladeMdHerunter(b, NOTE);
    expect(b.md(NOTE)).toBe('L1\nAAA\n');
  });
});
