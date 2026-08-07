// DIE GEGENPROBE ZUM INSTRUMENT, bevor irgendeine Zahl erhoben wird.
//
// Ein Verfahren, das Identitaet aus Text ableitet, hat genau einen Weg, still zu
// versagen: die beiden Texte sind verschieden, die Kennungen damit auch, und der
// Kandidat tut schlicht NICHTS. Eine Tabelle, in der `saat` und `zufall`
// zahlengleich sind, waere dann kein Befund ueber den Kandidaten, sondern ein
// Befund darueber, dass er nie lief.
//
// Diese Datei stellt das fest, bevor gemessen wird:
//   1. `saatKennung` ist deterministisch und trennt verschiedene Texte.
//   2. In der Lage 'bestand' (Praegung beim ersten Edit — der Betriebszustand)
//      praegen A und B NIE dieselbe Kennung.
//   3. In der Lage 'gleich' (Vorab-Erfassung) tun sie es IMMER.
//   4. Mit `kennung: 'zufall'` wird ueberhaupt keine Saat-Kennung gepraegt.
//
// Zellbasis ausdruecklich klein: die ersten 24 der 720 Zustellordnungen. Diese
// Datei misst kein Ergebnis, sie prueft nur, ob der Schalter angeschlossen ist.

import { permutationen, laufRueckfall, type SaatLage } from './lauf-rueckfall';
import { saatKennung } from './saat-kennung';
import type { Kennung } from './saat-kennung';

jest.setTimeout(1800000);

const ORDNUNGEN = permutationen(6).slice(0, 24);

async function probe(
  kennung: Kennung,
  saatLage: SaatLage
): Promise<{ gleich: number; praegungen: number; n: number }> {
  let gleich = 0;
  let praegungen = 0;
  for (const reihenfolge of ORDNUNGEN) {
    const e = await laufRueckfall({
      lage: 'neustart',
      reihenfolge,
      aWinnt: true,
      konfliktModus: 'ueberschreiben',
      schranke: 'aus',
      diffModus: 'roh',
      zelle: 'alltag',
      kennung,
      saatLage,
    });
    if (e.saatGleich) gleich++;
    praegungen += e.saatPraegungen;
  }
  return { gleich, praegungen, n: ORDNUNGEN.length };
}

describe('Saat-Kennung — greift der Schalter ueberhaupt?', () => {
  it('SK0-1: die Ableitung selbst', () => {
    const a = 'kopf\nzeile-1\nzeile-2\n';
    const b = 'kopf\nZUS\nzeile-1\nzeile-2\n';
    // eslint-disable-next-line no-console
    console.log(
      `\n[SK0-1] saatKennung(A)=${saatKennung(a)} saatKennung(A)=${saatKennung(a)} ` +
        `saatKennung(B)=${saatKennung(b)}`
    );
    expect(saatKennung(a)).toBe(saatKennung(a));
    expect(saatKennung(a)).not.toBe(saatKennung(b));
    expect(saatKennung('')).toBeGreaterThan(0);
  });

  it('SK0-2: zufall praegt gar nichts', async () => {
    const r = await probe('zufall', 'bestand');
    // eslint-disable-next-line no-console
    console.log(`[SK0-2] zufall/bestand: gleich ${r.gleich}/${r.n}, Praegungen ${r.praegungen}`);
    expect(r.praegungen).toBe(0);
    expect(r.gleich).toBe(0);
  });

  it('SK0-3: saat im Betriebszustand (Praegung beim ersten Edit)', async () => {
    const r = await probe('saat', 'bestand');
    // eslint-disable-next-line no-console
    console.log(`[SK0-3] saat/bestand:   gleich ${r.gleich}/${r.n}, Praegungen ${r.praegungen}`);
    expect(r.praegungen).toBeGreaterThan(0); // gepraegt wird, nur eben verschieden
    expect(r.gleich).toBe(0); // ... und deshalb NIE dieselbe Kennung
  });

  it('SK0-4: saat mit Vorab-Erfassung', async () => {
    const r = await probe('saat', 'gleich');
    // eslint-disable-next-line no-console
    console.log(`[SK0-4] saat/gleich:    gleich ${r.gleich}/${r.n}, Praegungen ${r.praegungen}`);
    expect(r.gleich).toBe(r.n); // hier MUSS der hergestellte Vorfahre entstehen
  });

  it('SK0-5: saat mit abweichendem Saattext', async () => {
    const r = await probe('saat', 'abweichend');
    // eslint-disable-next-line no-console
    console.log(`[SK0-5] saat/abweichend: gleich ${r.gleich}/${r.n}, Praegungen ${r.praegungen}`);
    expect(r.praegungen).toBeGreaterThan(0);
  });
});
