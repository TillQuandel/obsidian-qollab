// TEIL 4 — PARKEN, und der Lackmustest daneben.
//
// Aufbau wie Teil 1 (volle Aufzaehlung der Zustellreihenfolgen), aber ZWEIMAL:
//   ohne `externEdit` — nur Sync-Overwrites. Hier ist das Herkunftssignal
//                       eindeutig richtig, und die Frage ist nur, was das
//                       Parken kostet und bringt.
//   mit  `externEdit` — ein anderes PROGRAMM aendert B's `.md` waehrend die App
//                       laeuft. Fuer das Signal sieht das identisch aus, aber
//                       es kommt NIE eine Hilfsdatei dazu. Wer hier Text
//                       verliert, ist unbrauchbar.
//
// Gemessen werden VERLUST und VERDOPPLUNG getrennt, dazu die neue Groesse
// `entkopp`: am Ende steht Text in einer `.md`, den kein Doc deckt — die Note
// ist still aus dem Sync ausgestiegen.

import { lauf, permutationen, type Szenario, type Editfall, type Fabrik } from './lauf';
import { guidQuelleAus } from './guid-quelle';
import { heute, ohneFremdErfassung, parken } from './politiken';

const MODUS = (process.env.SPIKE_MODUS as 'kopie' | 'ohne') ?? 'kopie';
const PERMS = permutationen(6);
const SCHRITT = Number(process.env.SPIKE_PERM_SCHRITT ?? 1);

const varianten: Array<[string, Fabrik]> = [
  ['heute', heute],
  ['ohne-fremd-erfassung', ohneFremdErfassung],
  ['parken-2', parken(2)],
  ['parken-4', parken(4)],
  ['parken-8', parken(8)],
  ['parken-nie', parken(Infinity)],
];

jest.setTimeout(3600000);

interface Zaehler {
  n: number;
  div: number;
  verlust: number;
  still: number;
  doppel: number;
  sauber: number;
  entkopp: number;
  parkungen: number;
  nachtraege: number;
  eeeWeg: number;
  eeeFehlt: number;
}
const leer = (): Zaehler => ({
  n: 0,
  div: 0,
  verlust: 0,
  still: 0,
  doppel: 0,
  sauber: 0,
  entkopp: 0,
  parkungen: 0,
  nachtraege: 0,
  eeeWeg: 0,
  eeeFehlt: 0,
});

for (const externEdit of [false, true]) {
  describe(`Teil 4 — Parken (${MODUS}, externer Editor: ${externEdit ? 'JA' : 'nein'})`, () => {
    afterAll(() => guidQuelleAus());

    for (const szenario of ['geteilt', 'rollout', 'alltag'] as Szenario[]) {
      it(`${szenario}`, async () => {
        const zeilen: string[] = [];
        for (const [name, fabrik] of varianten) {
          const ges = leer();
          for (const editfall of ['nurA', 'nurB', 'beide'] as Editfall[]) {
            for (let pi = 0; pi < PERMS.length; pi += SCHRITT) {
              for (const aWinnt of [true, false]) {
                const e = await lauf(
                  {
                    szenario,
                    editfall,
                    reihenfolge: PERMS[pi],
                    aWinnt,
                    konfliktModus: MODUS,
                    sperreBis: szenario === 'rollout' ? 4 : 0,
                    externEdit,
                  },
                  fabrik
                );
                ges.n++;
                if (e.befund.divergenz) ges.div++;
                if (e.befund.verlust.length > 0) ges.verlust++;
                if (e.stillVerloren.length > 0) ges.still++;
                if (e.befund.doppel.length > 0) ges.doppel++;
                if (e.befund.sauber) ges.sauber++;
                if (e.entkoppelt) ges.entkopp++;
                ges.parkungen += e.parkungen;
                ges.nachtraege += e.nachtraege;
                // Der Lackmustest, isoliert. `eeeFehlt` = steht auf mindestens
                // einer Seite nicht mehr in der `.md`; `eeeWeg` = steht auch in
                // keiner Konfliktkopie mehr (der stille, endgueltige Verlust).
                if (externEdit && e.befund.verlust.includes('EEE')) ges.eeeFehlt++;
                if (externEdit && e.stillVerloren.includes('EEE')) ges.eeeWeg++;
              }
            }
          }
          zeilen.push(
            `${name.padEnd(21)} n=${ges.n} | DIV ${p(ges.div, ges.n)} | VERLUST ${p(
              ges.verlust,
              ges.n
            )} | still ${p(ges.still, ges.n)} | DOPPEL ${p(ges.doppel, ges.n)} | sauber ${p(
              ges.sauber,
              ges.n
            )} | entkopp ${p(ges.entkopp, ges.n)}${
              externEdit
                ? ` | EEE-fehlt ${p(ges.eeeFehlt, ges.n)} EEE-weg ${p(ges.eeeWeg, ges.n)}`
                : ''
            } | park ${ges.parkungen} nachtr ${ges.nachtraege}`
          );
        }
        // eslint-disable-next-line no-console
        console.log(
          `\n===== ${szenario} / ${MODUS} / externer Editor ${
            externEdit ? 'JA' : 'nein'
          } =====\n${zeilen.join('\n')}\n`
        );
        expect(zeilen.length).toBe(varianten.length);
      });
    }
  });
}

function p(x: number, n: number): string {
  return `${String(x).padStart(4)} (${((100 * x) / n).toFixed(1).padStart(5)}%)`;
}
