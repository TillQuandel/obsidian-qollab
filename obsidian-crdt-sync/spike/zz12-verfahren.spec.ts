// TEIL 12 — die drei Verfahren gegen DIESELBE Stichprobe.
//
//   ersetzen     Bestand: eigene Kette verwerfen, aus der Fremdhistorie neu
//                aufbauen. Bedingung: Doc seit dem Nachtrag unveraendert.
//   undo         Weg A: markierte Transaktion, per Y.UndoManager zurueckgenommen.
//                Keine Bedingung an zwischenzeitliche Edits — Merkposten lebt
//                aber im Speicher.
//   korrigieren  Weg B: Merkposten IM Doc, ueberzaehlige Zeilen nach dem Merge
//                entfernen. Keine Vorbedingung.
//
// Verglichen wird nicht nur DOPPEL: Ein Verfahren, das Duplikate senkt und
// Verlust erzeugt, ist schlechter als der Bestand. VERLUST, still und DIV
// stehen gleichberechtigt daneben.

import { laufN, alsN, stichprobe, type KonfigN } from './lauf-n';
import type { Szenario, Editfall } from './lauf';
import { guidQuelleAus } from './guid-quelle';
import { parkenMit } from './politiken';

const MODUS = (process.env.SPIKE_MODUS as 'kopie' | 'ohne') ?? 'kopie';
const S = Number(process.env.SPIKE_STICHPROBE ?? 24);
const SZENARIEN: Szenario[] = ['geteilt', 'alltag'];
const EDITFAELLE: Editfall[] = ['nurA', 'nurB', 'beide'];
const VERFAHREN = ['ersetzen', 'undo', 'korrigieren'] as const;

jest.setTimeout(3600000);

function pz(x: number, n: number): string {
  return `${String(x).padStart(4)} (${((100 * x) / n).toFixed(1).padStart(5)}%)`;
}

describe(`Verfahren (${MODUS}, Stichprobe ${S})`, () => {
  afterAll(() => guidQuelleAus());

  it('V-verfahren', async () => {
    const zellen: Array<[string, Partial<KonfigN>, number]> = [
      ['N=3 / M=1', { geraete: 3, notizen: 1 }, 9],
      ['N=2 / M=3', { geraete: 2, notizen: 3 }, 10],
    ];
    for (const [zname, konfig, ereignisse] of zellen) {
      for (const externEdit of [false, true]) {
        const zeilen: string[] = [];
        for (const verfahren of VERFAHREN) {
          let n = 0;
          let div = 0;
          let verlust = 0;
          let still = 0;
          let doppel = 0;
          let entkopp = 0;
          for (const szenario of SZENARIEN) {
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
                      sperreBis: 0,
                      externEdit,
                      uhrModus: 'alle',
                      ...konfig,
                    },
                    alsN(parkenMit(4, verfahren))
                  );
                  n++;
                  if (e.divergenz) div++;
                  if (e.verlust.length > 0) verlust++;
                  if (e.stillVerloren.length > 0) still++;
                  if (e.doppel.length > 0) doppel++;
                  if (e.entkoppelt) entkopp++;
                }
              }
            }
          }
          zeilen.push(
            `${verfahren.padEnd(13)} n=${String(n).padStart(4)} | DOPPEL ${pz(doppel, n)} | ` +
              `VERLUST ${pz(verlust, n)} | still ${pz(still, n)} | DIV ${pz(div, n)} | ` +
              `ENTKOPP ${pz(entkopp, n)}`
          );
        }
        // eslint-disable-next-line no-console
        console.log(
          `\n===== VERFAHREN | ${zname} | ${MODUS} | externer Editor ${
            externEdit ? 'JA' : 'nein'
          } | Stichprobe ${S} =====\n${zeilen.join('\n')}\n`
        );
      }
    }
    expect(true).toBe(true);
  });
});
