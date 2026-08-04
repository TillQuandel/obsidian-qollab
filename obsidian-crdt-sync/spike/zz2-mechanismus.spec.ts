// TEIL 2 — der Mechanismus hinter der Zahl.
//
// Die Aufzaehlung in Teil 1 zeigt: die KONTROLLE (`geteilt`, EINE gemeinsame
// Inkarnation, kein Praegemoment) verdoppelt haeufiger als die
// Erstkontakt-Szenarien. Diese Tests halten fest, WARUM — und dass keine
// Praegepolitik daran etwas aendern kann.

import { Geraet } from './geraet';
import { Wolke } from './wolke';
import { occ } from './invarianten';
import { setzeGuidFolge, guidQuelleAn, guidQuelleAus } from './guid-quelle';
import { aufschubUnbegrenzt } from './politiken';

const NOTE = 'note.md';
const G = '11111111111111111111111111111111';

// Zwei Geraete mit EINER gemeinsamen Inkarnation: A praegt, B adoptiert.
async function gemeinsameHistorie(): Promise<{ a: Geraet; b: Geraet; w: Wolke }> {
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
  expect(await a.sync.currentGuid(NOTE)).toBe(G);
  expect(await b.sync.currentGuid(NOTE)).toBe(G); // dieselbe Inkarnation
  return { a, b, w };
}

describe('Teil 2 — Verdopplung OHNE zweite Inkarnation', () => {
  afterAll(() => guidQuelleAus());

  it('geteilte Kennung + `.md` VOR der Hilfsdatei => Text steht doppelt', async () => {
    const { a, b, w } = await gemeinsameHistorie();

    a.setMd(NOTE, 'kopf\nbestand\nAAA\nfuss\n');
    await a.modify(NOTE);
    w.ladeMdHoch(a, NOTE);
    w.ladeSidecarsHoch(a);

    // NUR die `.md` zustellen. B hat AAA jetzt im Text, aber keine Op dafuer.
    expect(w.ladeMdHerunter(b, NOTE)).toBe(true);
    await b.modify(NOTE); // B materialisiert AAA als EIGENE Op — unter G
    expect(occ(b.crdt.getContent(NOTE), 'AAA')).toBe(1);

    // Jetzt die Hilfsdatei. Gleiche Kennung => kompatibel => Yjs haengt an.
    w.ladeSidecarsHerunter(b);
    await b.poll(NOTE);

    expect(occ(b.md(NOTE), 'AAA')).toBe(2);
  });

  it('Gegenprobe: Hilfsdatei VOR der `.md` => sauber', async () => {
    const { a, b, w } = await gemeinsameHistorie();

    a.setMd(NOTE, 'kopf\nbestand\nAAA\nfuss\n');
    await a.modify(NOTE);
    w.ladeMdHoch(a, NOTE);
    w.ladeSidecarsHoch(a);

    w.ladeSidecarsHerunter(b);
    await b.poll(NOTE);
    if (w.ladeMdHerunter(b, NOTE)) await b.modify(NOTE);

    expect(occ(b.md(NOTE), 'AAA')).toBe(1);
  });

  it('keine Praegepolitik kann hier greifen: es wird nichts gepraegt', async () => {
    const { a, b, w } = await gemeinsameHistorie();
    // Haerteste denkbare Politik: NIE praegen.
    const pol = aufschubUnbegrenzt(a, b, () => 0);
    a.setPolitik(pol.a);
    b.setPolitik(pol.b);
    a.politikAktiv = true;
    b.politikAktiv = true;

    a.setMd(NOTE, 'kopf\nbestand\nAAA\nfuss\n');
    await a.modify(NOTE);
    w.ladeMdHoch(a, NOTE);
    w.ladeSidecarsHoch(a);
    w.ladeMdHerunter(b, NOTE);
    await b.modify(NOTE);
    w.ladeSidecarsHerunter(b);
    await b.poll(NOTE);

    // Unveraendert doppelt — und die Politik ist kein einziges Mal gefragt
    // worden, weil `ensureDoc` hier gar nicht in den Praegezweig laeuft.
    expect(occ(b.md(NOTE), 'AAA')).toBe(2);
    expect(a.aufschubZaehler + b.aufschubZaehler).toBe(0);
  });
});
