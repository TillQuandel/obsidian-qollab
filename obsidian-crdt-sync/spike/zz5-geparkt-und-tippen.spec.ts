// TEIL 5 — die vier benannten Faelle des Auftrags, einzeln und nachvollziehbar.
//
//  F1  Sync-Overwrite geparkt, Hilfsdatei trifft ein          -> Aufloesung
//  F2  Sync-Overwrite geparkt, Nutzer TIPPT waehrenddessen    -> welches Delta?
//  F3  EXTERNER Editor (Notepad), nie eine Hilfsdatei          -> Frist rettet
//  F4  Peer OHNE Qollab: `.md` kommt, Hilfsdatei nie           -> Frist rettet
//
// Alle vier laufen gegen den unveraenderten SyncHandler; der einzige Unterschied
// zum Bestand ist die Park-Klammer in `Geraet`.

import { Geraet } from './geraet';
import { Wolke } from './wolke';
import { occ } from './invarianten';
import { setzeGuidFolge, guidQuelleAn, guidQuelleAus } from './guid-quelle';

const NOTE = 'note.md';
const G = '11111111111111111111111111111111';
const FRIST = 4;

// Zwei Geraete mit EINER gemeinsamen Inkarnation, beide auf demselben Text.
async function aufbau(frist = FRIST): Promise<{ a: Geraet; b: Geraet; w: Wolke }> {
  guidQuelleAn();
  setzeGuidFolge([G]);
  const a = new Geraet('aaaa1111');
  const b = new Geraet('bbbb2222');
  const w = new Wolke([a, b]);
  w.saeen([a, b], NOTE, 'kopf\nfuss\n');

  a.setMd(NOTE, 'kopf\nbestand\nfuss\n');
  await a.modify(NOTE);
  w.ladeMdHoch(a, NOTE);
  w.ladeSidecarsHoch(a);
  w.ladeMdHerunter(b, NOTE);
  w.ladeSidecarsHerunter(b);
  await b.modify(NOTE);
  await b.poll(NOTE);
  // Erst JETZT das Parken einschalten — der Aufbau soll fuer alle Faelle gleich
  // sein.
  a.parkFrist = frist;
  b.parkFrist = frist;
  return { a, b, w };
}

describe('Teil 5 — die vier Faelle', () => {
  afterAll(() => guidQuelleAus());

  it('F1: Sync liefert die `.md`, danach die Hilfsdatei — kein Duplikat, keine eigene Op', async () => {
    const { a, b, w } = await aufbau();
    a.setMd(NOTE, 'kopf\nbestand\nAAA\nfuss\n');
    await a.modify(NOTE);
    w.ladeMdHoch(a, NOTE);
    w.ladeSidecarsHoch(a);

    // Nur die `.md`. Der Text steht in der Datei, NICHT im Doc.
    expect(w.ladeMdHerunter(b, NOTE)).toBe(true);
    await b.modify(NOTE, 'sync');
    expect(b.hatGeparkt(NOTE)).toBe(true);
    expect(b.md(NOTE)).toContain('AAA');
    expect(b.crdt.getContent(NOTE)).not.toContain('AAA'); // Doc haengt zurueck

    // Jetzt die Hilfsdatei.
    w.ladeSidecarsHerunter(b);
    await b.poll(NOTE);
    expect(b.hatGeparkt(NOTE)).toBe(false); // aufgeloest
    expect(occ(b.md(NOTE), 'AAA')).toBe(1); // EINMAL — der Bestand macht hier 2
    expect(b.crdt.getContent(NOTE)).toContain('AAA');
    expect(b.nachtragZaehler).toBe(0); // nie als eigene Op erfasst
  });

  it('F2: Nutzer tippt, WAEHREND geparkt ist — das Delta zaehlt nur seinen Tastendruck', async () => {
    const { a, b, w } = await aufbau();
    a.setMd(NOTE, 'kopf\nbestand\nAAA\nfuss\n');
    await a.modify(NOTE);
    w.ladeMdHoch(a, NOTE);
    w.ladeSidecarsHoch(a);
    w.ladeMdHerunter(b, NOTE);
    await b.modify(NOTE, 'sync');
    expect(b.hatGeparkt(NOTE)).toBe(true);

    // Der Nutzer sieht AAA in der Datei und tippt darunter weiter.
    b.setMd(NOTE, b.md(NOTE).replace('fuss\n', 'BBB\nfuss\n'));
    await b.modify(NOTE, 'nutzer');

    // Der Doc hat NUR den Tastendruck bekommen, nicht den fremden Text.
    expect(b.crdt.getContent(NOTE)).toContain('BBB');
    expect(b.crdt.getContent(NOTE)).not.toContain('AAA');
    // Und die Datei traegt weiter beides — kein Write-Back hat AAA geloescht.
    expect(b.md(NOTE)).toContain('AAA');
    expect(b.md(NOTE)).toContain('BBB');

    // Hilfsdatei trifft ein: beide Beitraege, jeder EINMAL.
    w.ladeSidecarsHerunter(b);
    await b.poll(NOTE);
    w.ladeSidecarsHoch(b);
    w.ladeMdHoch(b, NOTE);
    w.ladeSidecarsHerunter(a);
    await a.poll(NOTE);
    if (w.ladeMdHerunter(a, NOTE)) await a.modify(NOTE, 'sync');
    await a.poll(NOTE);
    await a.parkTick(NOTE);
    await b.parkTick(NOTE);

    // eslint-disable-next-line no-console
    console.log(`F2 A=${JSON.stringify(a.md(NOTE))}\nF2 B=${JSON.stringify(b.md(NOTE))}`);
    for (const g of [a, b]) {
      expect(occ(g.md(NOTE), 'AAA')).toBe(1);
      expect(occ(g.md(NOTE), 'BBB')).toBe(1);
    }
  });

  it('F3: externer Editor, es kommt NIE eine Hilfsdatei — die Frist rettet den Text', async () => {
    const { a, b, w } = await aufbau();
    // Notepad schreibt in B's Datei. Fuer das Signal identisch zum Sync.
    b.setMd(NOTE, 'kopf\nbestand\nEXTERN\nfuss\n');
    await b.modify(NOTE, 'extern');
    expect(b.hatGeparkt(NOTE)).toBe(true);
    expect(b.crdt.getContent(NOTE)).not.toContain('EXTERN');

    // Es kommt nichts. Nur die Uhr laeuft.
    for (let i = 0; i < FRIST; i++) await b.parkTick(NOTE);

    expect(b.hatGeparkt(NOTE)).toBe(false);
    expect(b.nachtragZaehler).toBe(1);
    expect(b.md(NOTE)).toContain('EXTERN');
    expect(b.crdt.getContent(NOTE)).toContain('EXTERN'); // jetzt im CRDT

    // Und der Text erreicht den Peer.
    w.ladeSidecarsHoch(b);
    w.ladeMdHoch(b, NOTE);
    w.ladeSidecarsHerunter(a);
    await a.poll(NOTE);
    if (w.ladeMdHerunter(a, NOTE)) await a.modify(NOTE, 'sync');
    for (let i = 0; i < FRIST; i++) await a.parkTick(NOTE);
    await a.poll(NOTE);
    expect(occ(a.md(NOTE), 'EXTERN')).toBe(1);
  });

  it('F3b: OHNE Frist (nie erfassen) verliert derselbe Fall den externen Text', async () => {
    const { a, b, w } = await aufbau(Infinity);
    b.setMd(NOTE, 'kopf\nbestand\nEXTERN\nfuss\n');
    await b.modify(NOTE, 'extern');

    // A editiert normal weiter und der Sync laeuft.
    a.setMd(NOTE, 'kopf\nAAA\nbestand\nfuss\n');
    await a.modify(NOTE);
    w.ladeMdHoch(a, NOTE);
    w.ladeSidecarsHoch(a);
    w.ladeSidecarsHerunter(b);
    await b.poll(NOTE);
    if (w.ladeMdHerunter(b, NOTE)) await b.modify(NOTE, 'sync');
    await b.poll(NOTE);

    // eslint-disable-next-line no-console
    console.log(
      `F3b B.md=${JSON.stringify(b.md(NOTE))} B.doc=${JSON.stringify(b.crdt.getContent(NOTE))}`
    );
    // Der externe Text ist nie in den CRDT gekommen. Damit war die `.md` sein
    // einziger Traeger — und der Datei-Sync hat sie beim naechsten Abgleich
    // durch die Wolken-Fassung ersetzt. EXTERN steht danach in KEINER `.md`
    // mehr, nur noch in einer Konfliktkopie: sichtbar auf der Platte, aber
    // Handarbeit. Genau das ist der Preis der reinen Verweigerung.
    expect(b.crdt.getContent(NOTE)).not.toContain('EXTERN');
    expect(b.md(NOTE)).not.toContain('EXTERN');
    expect(w.alleKopien().some((k) => k.includes('EXTERN'))).toBe(true);
  });

  it('F4: Peer ohne Qollab — `.md` kommt, Hilfsdatei nie; die Frist erfasst sie', async () => {
    guidQuelleAn();
    setzeGuidFolge([G]);
    const b = new Geraet('bbbb2222');
    const w = new Wolke([b]);
    w.saeen([b], NOTE, 'kopf\nfuss\n');
    b.setMd(NOTE, 'kopf\nbestand\nfuss\n');
    await b.modify(NOTE);
    b.parkFrist = FRIST;

    // Der Peer hat kein Qollab: er legt nur die `.md` ab.
    b.setMd(NOTE, 'kopf\nbestand\nVOM-PEER\nfuss\n');
    await b.modify(NOTE, 'sync');
    expect(b.hatGeparkt(NOTE)).toBe(true);
    for (let i = 0; i < FRIST; i++) await b.parkTick(NOTE);
    expect(b.hatGeparkt(NOTE)).toBe(false);
    expect(occ(b.md(NOTE), 'VOM-PEER')).toBe(1);
    expect(b.crdt.getContent(NOTE)).toContain('VOM-PEER');
  });

  // Der eine Fall, den der Herkunfts-Spike NICHT auswerten konnte: F5 („Sync
  // ueberschreibt eine OFFENE, aktive Note"). Obsidian laedt den Editor neu und
  // SPEICHERT die fremde Fassung danach selbst — dieser Write traegt unsere
  // eigene Schreibspur, das Signal meldet fuer das zweite modify also LOKAL.
  // In den Rohdaten sind das 14/29 bzw. 17/35 Ereignisse mit `hashPasst=true`.
  //
  // Das Parken haelt trotzdem, und zwar wegen der Diff-Basis: sie steht seit dem
  // Parken auf genau diesem Text, das Delta ist leer, es entsteht keine Op.
  it('F5r: Obsidian speichert die fremde Fassung selbst nach — trotzdem keine eigene Op', async () => {
    const { a, b, w } = await aufbau();
    a.setMd(NOTE, 'kopf\nbestand\nAAA\nfuss\n');
    await a.modify(NOTE);
    w.ladeMdHoch(a, NOTE);
    w.ladeSidecarsHoch(a);
    w.ladeMdHerunter(b, NOTE);
    await b.modify(NOTE, 'sync'); // modify #1: fremd -> geparkt
    expect(b.hatGeparkt(NOTE)).toBe(true);

    // modify #2: Obsidians eigener Speichervorgang, gleicher Inhalt, LOKAL.
    await b.modify(NOTE, 'nutzer');
    expect(b.crdt.getContent(NOTE)).not.toContain('AAA'); // keine eigene Op
    expect(b.hatGeparkt(NOTE)).toBe(true);

    w.ladeSidecarsHerunter(b);
    await b.poll(NOTE);
    expect(occ(b.md(NOTE), 'AAA')).toBe(1);
    expect(b.nachtragZaehler).toBe(0);
  });

  // ALTERNATIVE (a) des Auftrags, gegengemessen: fremden Stand verwerfen und aus
  // dem Doc wiederherstellen. Das Signal kann Sync und Notepad nicht trennen —
  // also trifft die Regel BEIDE.
  it('A-a: Verwerfen loescht den externen Edit noch im selben Moment', async () => {
    const { b } = await aufbau();
    b.parkFrist = 0;
    b.verwerfen = true;

    b.setMd(NOTE, 'kopf\nbestand\nEXTERN\nfuss\n');
    await b.modify(NOTE, 'extern');

    // Die Datei traegt den fremden Text nicht mehr — vor den Augen des Nutzers,
    // ohne Konfliktkopie, ohne Meldung, ohne Weg zurueck.
    expect(b.md(NOTE)).not.toContain('EXTERN');
    expect(b.md(NOTE)).toBe('kopf\nbestand\nfuss\n');
  });

  it('A-a: Verwerfen ohne mitsyncende `.qollab` loescht auch den Peer-Beitrag', async () => {
    guidQuelleAn();
    setzeGuidFolge([G]);
    const b = new Geraet('bbbb2222');
    const w = new Wolke([b]);
    w.saeen([b], NOTE, 'kopf\nfuss\n');
    b.setMd(NOTE, 'kopf\nbestand\nfuss\n');
    await b.modify(NOTE);
    b.verwerfen = true;

    // Der Peer hat Qollab, aber `.qollab` ist vom Sync ausgeschlossen: nur die
    // `.md` kommt an.
    b.setMd(NOTE, 'kopf\nbestand\nVOM-PEER\nfuss\n');
    await b.modify(NOTE, 'sync');
    expect(b.md(NOTE)).not.toContain('VOM-PEER');
  });

  it('F5: `parkNurBeiBeleg` erkennt „kein Peer an dieser Notiz" sofort', async () => {
    guidQuelleAn();
    setzeGuidFolge([G]);
    const b = new Geraet('bbbb2222');
    const w = new Wolke([b]);
    w.saeen([b], NOTE, 'kopf\nfuss\n');
    b.setMd(NOTE, 'kopf\nbestand\nfuss\n');
    await b.modify(NOTE);
    b.parkFrist = FRIST;
    b.parkNurBeiBeleg = true;

    b.setMd(NOTE, 'kopf\nbestand\nEXTERN\nfuss\n');
    await b.modify(NOTE, 'extern');
    // Keine fremde Hilfsdatei fuer diese Notiz => gar nicht erst geparkt.
    expect(b.hatGeparkt(NOTE)).toBe(false);
    expect(b.crdt.getContent(NOTE)).toContain('EXTERN');
  });
});
