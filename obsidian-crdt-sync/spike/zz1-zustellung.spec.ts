// TEIL 1 — Zustellreihenfolgen, aufgezaehlt statt gewuerfelt.
//
// Sechs Ereignisse:
//   0 A veroeffentlicht (`.md` + Hilfsdatei)     3 A zieht die Hilfsdatei
//   1 B veroeffentlicht                          4 B zieht die `.md`
//   2 A zieht die `.md`                          5 B zieht die Hilfsdatei
// => 720 Reihenfolgen. Der Schnitt ist absichtlich so gewaehlt, dass die
// EMPFANGSseitige Trennung von Datei und Historie in der Permutation steckt —
// das ist der belegte Ausloeser.
//
// Dazu drei Editfaelle (nur A / nur B / beide) und beide Ausgaenge des
// Tie-Breaks. Zwischen zwei Varianten unterscheidet sich AUSSCHLIESSLICH die
// Politik im Praegemoment (Ausnahme: die letzte Zeile, eine Gegenprobe).

import { lauf, permutationen, type Szenario, type Editfall, type Fabrik } from './lauf';
import { guidQuelleAus } from './guid-quelle';
import {
  heute,
  aufschubUnbegrenzt,
  fristProNote,
  karenzNachBeitritt,
  orakel,
  ohneFremdErfassung,
} from './politiken';

const MODUS = (process.env.SPIKE_MODUS as 'kopie' | 'ohne') ?? 'kopie';
const PERMS = permutationen(6);
const SCHRITT = Number(process.env.SPIKE_PERM_SCHRITT ?? 1); // 1 = alle 720

const varianten: Array<[string, Fabrik]> = [
  ['heute', heute],
  ['aufschub-unbegrenzt', aufschubUnbegrenzt],
  ['frist-note-1', fristProNote(1)],
  ['karenz-3', karenzNachBeitritt(3)],
  ['orakel', orakel],
  ['ohne-fremd-erfassung', ohneFremdErfassung],
];

jest.setTimeout(3600000);

interface Zaehler {
  n: number;
  div: number;
  verlust: number;
  still: number;
  doppel: number;
  sauber: number;
  kopien: number;
  ohneHistorie: number;
}
const leer = (): Zaehler => ({
  n: 0,
  div: 0,
  verlust: 0,
  still: 0,
  doppel: 0,
  sauber: 0,
  kopien: 0,
  ohneHistorie: 0,
});

describe(`Teil 1 — Zustellreihenfolgen (${MODUS})`, () => {
  afterAll(() => guidQuelleAus());

  for (const szenario of ['geteilt', 'rollout', 'alltag'] as Szenario[]) {
    it(`${szenario}`, async () => {
      const zeilen: string[] = [];
      for (const [name, fabrik] of varianten) {
        const ges = leer();
        const je: Record<string, Zaehler> = { nurA: leer(), nurB: leer(), beide: leer() };
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
                },
                fabrik
              );
              for (const z of [ges, je[editfall]]) {
                z.n++;
                if (e.befund.divergenz) z.div++;
                if (e.befund.verlust.length > 0) z.verlust++;
                if (e.stillVerloren.length > 0) z.still++;
                if (e.befund.doppel.length > 0) z.doppel++;
                if (e.befund.sauber) z.sauber++;
                z.kopien += e.kopien;
                if (e.ohneHistorie) z.ohneHistorie++;
              }
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
          )} | ohne-Historie ${ges.ohneHistorie}`
        );
        zeilen.push(
          `${''.padEnd(21)}   DOPPEL je Editfall: nurA ${p(je.nurA.doppel, je.nurA.n)}  nurB ${p(
            je.nurB.doppel,
            je.nurB.n
          )}  beide ${p(je.beide.doppel, je.beide.n)}`
        );
        zeilen.push(
          `${''.padEnd(21)}   VERLUST je Editfall: nurA ${p(je.nurA.verlust, je.nurA.n)}  nurB ${p(
            je.nurB.verlust,
            je.nurB.n
          )}  beide ${p(je.beide.verlust, je.beide.n)}`
        );
      }
      // eslint-disable-next-line no-console
      console.log(`\n===== ${szenario} / Modus ${MODUS} =====\n${zeilen.join('\n')}\n`);
      expect(zeilen.length).toBe(varianten.length * 3);
    });
  }
});

function p(x: number, n: number): string {
  return `${String(x).padStart(4)} (${((100 * x) / n).toFixed(1).padStart(5)}%)`;
}
