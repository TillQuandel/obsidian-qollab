// TEIL 11 — ABNAHME. Genau die Zellen, die das Akzeptanzkriterium nennt, und
// nichts darueber hinaus: drei Geraete, drei umkaempfte Notizen, Basiszelle zum
// Vergleich — jeweils unter `parken-4`.
//
// `stichprobe(n, S)` ist deterministisch: dieselbe Zahl liefert dieselben
// Zustellreihenfolgen. Mit S=48 sind die Zeilen hier direkt gepaart mit den
// Achsen-Laeufen A und B vom selben Tag, ohne dass die vollen Achsen erneut
// laufen muessen.

import { laufN, alsN, stichprobe, type KonfigN } from './lauf-n';
import type { Szenario, Editfall } from './lauf';
import { guidQuelleAus } from './guid-quelle';
import { parken } from './politiken';

const MODUS = (process.env.SPIKE_MODUS as 'kopie' | 'ohne') ?? 'kopie';
const S = Number(process.env.SPIKE_STICHPROBE ?? 48);
const SZENARIEN: Szenario[] = ['geteilt', 'alltag'];
const EDITFAELLE: Editfall[] = ['nurA', 'nurB', 'beide'];

jest.setTimeout(3600000);

function pz(x: number, n: number): string {
  return `${String(x).padStart(4)} (${((100 * x) / n).toFixed(1).padStart(5)}%)`;
}

describe(`Abnahme (${MODUS}, Stichprobe ${S})`, () => {
  afterAll(() => guidQuelleAus());

  it('X-abnahme', async () => {
    const zellen: Array<[string, Partial<KonfigN>, number]> = [
      ['N=2 / M=1 (Basis)', { geraete: 2, notizen: 1 }, 6],
      ['N=3 / M=1', { geraete: 3, notizen: 1 }, 9],
      ['N=2 / M=3', { geraete: 2, notizen: 3 }, 10],
    ];
    for (const szenario of SZENARIEN) {
      for (const externEdit of [false, true]) {
        const zeilen: string[] = [];
        for (const [zname, konfig, ereignisse] of zellen) {
          let n = 0;
          let div = 0;
          let verlust = 0;
          let still = 0;
          let doppel = 0;
          let entkopp = 0;
          let frist = 0;
          for (const editfall of EDITFAELLE) {
            for (const reihenfolge of stichprobe(ereignisse, S)) {
              for (const aWinnt of [true, false]) {
                const e = await laufN(
                  {
                    szenario,
                    editfall,
                    reihenfolge,
                    aWinnt,
                    konfliktModus: MODUS,
                    sperreBis: szenario === 'rollout' ? 4 : 0,
                    externEdit,
                    uhrModus: 'alle',
                    ...konfig,
                  },
                  alsN(parken(4))
                );
                n++;
                if (e.divergenz) div++;
                if (e.verlust.length > 0) verlust++;
                if (e.stillVerloren.length > 0) still++;
                if (e.doppel.length > 0) doppel++;
                if (e.entkoppelt) entkopp++;
                frist += e.fristNachtraege;
              }
            }
          }
          zeilen.push(
            `${zname.padEnd(20)} n=${String(n).padStart(4)} | DOPPEL ${pz(doppel, n)} | ` +
              `VERLUST ${pz(verlust, n)} | still ${pz(still, n)} | DIV ${pz(div, n)} | ` +
              `ENTKOPP ${pz(entkopp, n)} | frist-nachtr ${frist}`
          );
        }
        // eslint-disable-next-line no-console
        console.log(
          `\n===== ABNAHME | ${szenario} / ${MODUS} / externer Editor ${
            externEdit ? 'JA' : 'nein'
          } | Stichprobe ${S} =====\n${zeilen.join('\n')}\n`
        );
      }
    }
    expect(true).toBe(true);
  });
});
