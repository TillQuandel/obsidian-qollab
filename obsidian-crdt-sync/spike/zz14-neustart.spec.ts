// TEIL 14 — NEUSTART. Das Instrument, ohne das der Merkposten-Verlust nicht
// messbar ist, und der Beleg, dass er real ist.
//
// V — VALIDIERUNG des Instruments gegen bekannte Erwartungen. Faellt sie, gilt
//     keine Zahl darunter.
// N — der SCHADEN: ein Nachtrag vor dem Neustart wird danach nicht mehr repariert.

import { Geraet } from './geraet';
import { Wolke } from './wolke';
import { occ } from './invarianten';
import { guidQuelleAn, guidQuelleAus, setzeGuidFolge } from './guid-quelle';

const NOTE = 'note.md';
const BASIS = 'kopf\nzeile-1\nfuss\n';
const KLEIN = '00000000000000000000000000000000';
const GROSS = 'ffffffffffffffffffffffffffffffff';

jest.setTimeout(300000);

// Zwei Geraete, gemeinsame Ausgangslage. B bekommt A's `.md` per Sync geliefert,
// A's Hilfsdatei bleibt zurueck — der belegte Regelfall.
async function baueLage(): Promise<{ a: Geraet; b: Geraet; w: Wolke }> {
  guidQuelleAn();
  setzeGuidFolge([KLEIN, GROSS, KLEIN, GROSS, GROSS]);
  const a = new Geraet('aaaa1111');
  const b = new Geraet('bbbb2222');
  const w = new Wolke([a, b]);
  w.saeen([a, b], NOTE, BASIS);

  // Beide praegen auf demselben Text, A gewinnt den Tie-Break.
  await a.tippe(NOTE, BASIS);
  await a.modify(NOTE);
  await b.tippe(NOTE, BASIS);
  await b.modify(NOTE);
  w.ladeSidecarsHoch(a);
  w.ladeSidecarsHerunter(b);
  await b.poll(NOTE);
  w.ladeSidecarsHoch(b);
  w.ladeSidecarsHerunter(a);
  await a.poll(NOTE);
  return { a, b, w };
}

describe('Neustart', () => {
  afterAll(() => guidQuelleAus());

  it('V-validierung: die Platte ueberlebt, der Prozess nicht', async () => {
    const { a } = await baueLage();
    await a.tippe(NOTE, `${BASIS}AAA\n`);
    await a.modify(NOTE);

    const textVorher = a.md(NOTE);
    const docVorher = a.crdt.getContent(NOTE);
    const syncVorher = a.sync;
    const crdtVorher = a.crdt;
    expect(docVorher).toContain('AAA');

    await a.neustart();

    // Der Prozess ist ein anderer.
    expect(a.sync).not.toBe(syncVorher);
    expect(a.crdt).not.toBe(crdtVorher);
    // Der Doc ist leer, bis er aus der Hilfsdatei neu gebaut wird — genau das ist
    // der Zustand, den ein frisch gestartetes Obsidian vorfindet.
    expect(a.crdt.hasDoc(NOTE)).toBe(false);
    // Die Platte ist unveraendert.
    expect(a.md(NOTE)).toBe(textVorher);

    // Nach einem poll ist der Doc aus der Hilfsdatei rekonstruiert und traegt
    // denselben Text. Waere das nicht so, misst der Neustart sich selbst.
    await a.poll(NOTE);
    expect(a.crdt.getContent(NOTE)).toContain('AAA');
    expect(a.md(NOTE)).toContain('AAA');
  });

  it('V-validierung: die Konfiguration ueberlebt, die Messzaehler auch', async () => {
    const { a } = await baueLage();
    a.parkFrist = 4;
    a.sync.nachtragVerfahren = 'korrigieren';
    a.politikAktiv = true;
    a.parkZaehler = 7;

    await a.neustart();

    // Einstellungen stehen im Produkt in der Konfiguration und ueberleben.
    expect(a.parkFrist).toBe(4);
    expect(a.sync.nachtragVerfahren).toBe('korrigieren');
    expect(a.politikAktiv).toBe(true);
    // Messwerte sind kein Prozesszustand — sonst zaehlt die Messung neu bei null.
    expect(a.parkZaehler).toBe(7);
  });

  it('N-schaden: nach einem Neustart repariert der Ersatz den Nachtrag nicht mehr', async () => {
    const { a, b, w } = await baueLage();
    for (const g of [a, b]) g.parkFrist = 4;

    // A tippt. Der Datei-Sync liefert A's `.md` zu B, A's Hilfsdatei bleibt zurueck.
    await a.tippe(NOTE, `${BASIS}AAA\n`);
    await a.modify(NOTE);
    w.ladeMdHoch(a, NOTE);
    w.ladeMdHerunter(b, NOTE);
    await b.modify(NOTE, 'sync');
    expect(b.hatGeparkt(NOTE)).toBe(true);

    // Die Historie kommt nicht. Die Frist laeuft ab, B traegt nach.
    for (let i = 0; i < 6 && b.hatGeparkt(NOTE); i++) await b.parkTick(NOTE);
    expect(b.hatGeparkt(NOTE)).toBe(false);
    expect(b.sync.hatNachtrag(NOTE)).toBe(true);

    // ===== HIER schliesst der Nutzer Obsidian. =====
    await b.neustart();
    b.parkFrist = 4;
    expect(b.sync.hatNachtrag(NOTE)).toBe(false); // der Merkposten ist fort

    // Jetzt trifft A's Hilfsdatei doch noch ein.
    w.ladeSidecarsHoch(a);
    w.ladeSidecarsHerunter(b);
    await b.poll(NOTE);

    // eslint-disable-next-line no-console
    console.log(`\n===== NEUSTART-SCHADEN =====\n  B nach dem Merge: ${JSON.stringify(b.crdt.getContent(NOTE))}\n`);

    // BESTAND, gemessen am 2026-08-04: AAA steht ZWEIMAL. Ohne Neustart steht es
    // einmal — `ersetzeNachtrag` greift dort. Der Merkposten `nachgetragen` ist
    // eine In-Memory-Map; ist sie fort, ist der Nachtrag nicht mehr als solcher
    // erkennbar und der Ersatz laeuft ins Leere.
    //
    // Das ist ein Schadensweg, den KEINE der bisherigen Messungen zeigen konnte:
    // Der Fuzz-Treiber laeuft in einem Prozess durch, dort ueberlebt der
    // Merkposten per Konstruktion immer. Im Betrieb ueberlebt er kein Schliessen
    // von Obsidian — und zwischen Nachtrag (vier Ticks) und dem Eintreffen der
    // Fremdhistorie (naechster Sync des anderen Geraets) liegen typischerweise
    // Stunden.
    //
    // Ein Verfahren, das diesen Fall loesen will, braucht einen Merkposten, der
    // die Platte erreicht — daran ist der UndoManager-Weg gescheitert, und das
    // ist der Grund, warum der Herkunfts-Schnitt ueber Item-IDs interessant ist:
    // `id.client` und `id.clock` liegen im Yjs-State und reisen ohnehin mit.
    expect(occ(b.crdt.getContent(NOTE), 'AAA')).toBe(2);
  });

  it('GEGENPROBE: ohne Neustart repariert der Ersatz denselben Ablauf', async () => {
    const { a, b, w } = await baueLage();
    for (const g of [a, b]) g.parkFrist = 4;

    await a.tippe(NOTE, `${BASIS}AAA\n`);
    await a.modify(NOTE);
    w.ladeMdHoch(a, NOTE);
    w.ladeMdHerunter(b, NOTE);
    await b.modify(NOTE, 'sync');
    for (let i = 0; i < 6 && b.hatGeparkt(NOTE); i++) await b.parkTick(NOTE);
    expect(b.sync.hatNachtrag(NOTE)).toBe(true);

    // KEIN Neustart — der einzige Unterschied zum Test darueber.
    w.ladeSidecarsHoch(a);
    w.ladeSidecarsHerunter(b);
    await b.poll(NOTE);

    expect(occ(b.crdt.getContent(NOTE), 'AAA')).toBe(1);
  });
});
