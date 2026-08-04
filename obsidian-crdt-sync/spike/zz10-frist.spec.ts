// TEIL 10 — DIE FRIST. Der Nachtrag ist als notwendige Bedingung der
// Verdopplung belegt (zz9: 70 von 70 Verdopplungslaeufen hatten einen
// Fristablauf-Nachtrag, 0 ohne). Damit steht die Frage, die der Auftrag
// vorzeichnet: Wie teuer ist eine laengere Frist?
//
// Der Nachtrag existiert, damit eine Notiz nicht dauerhaft aus dem Abgleich
// faellt, wenn die Historie nie kommt. Das ist ein echter Preis — er wird hier
// als `ENTKOPP` mitgemessen und NICHT gegen die Verdopplung verrechnet.
//
// Gemessen wird ueber dieselbe Stichprobe wie Achse A/B, damit die Zeilen
// untereinander vergleichbar sind. `Infinity` ist die reine Verweigerung: kein
// Vorschlag, sondern die Obergrenze — sie zeigt, wieviel Verdopplung ueberhaupt
// am Nachtrag haengt.

import { laufN, alsN, stichprobe, type KonfigN } from './lauf-n';
import type { Szenario, Editfall } from './lauf';
import { guidQuelleAus } from './guid-quelle';
import { parken } from './politiken';

const MODUS = (process.env.SPIKE_MODUS as 'kopie' | 'ohne') ?? 'kopie';
const S = Number(process.env.SPIKE_STICHPROBE ?? 24);
const SZENARIEN: Szenario[] = ['geteilt', 'rollout', 'alltag'];
const EDITFAELLE: Editfall[] = ['nurA', 'nurB', 'beide'];

const FRISTEN: Array<[string, number]> = [
  ['frist-4 (Bestand)', 4],
  ['frist-8', 8],
  ['frist-16', 16],
  ['frist-32', 32],
  ['frist-unendlich', Infinity],
];

jest.setTimeout(3600000);

interface Z {
  n: number;
  div: number;
  verlust: number;
  still: number;
  doppel: number;
  entkopp: number;
  frist: number;
  aufl: number;
}

function pz(x: number, n: number): string {
  return `${String(x).padStart(4)} (${((100 * x) / n).toFixed(1).padStart(5)}%)`;
}

async function miss(
  konfig: Partial<KonfigN>,
  ereignisse: number,
  frist: number,
  externEdit: boolean
): Promise<Z> {
  const z: Z = { n: 0, div: 0, verlust: 0, still: 0, doppel: 0, entkopp: 0, frist: 0, aufl: 0 };
  const perms = stichprobe(ereignisse, S);
  for (const szenario of SZENARIEN) {
    for (const editfall of EDITFAELLE) {
      for (const reihenfolge of perms) {
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
            alsN(parken(frist))
          );
          z.n++;
          if (e.divergenz) z.div++;
          if (e.verlust.length > 0) z.verlust++;
          if (e.stillVerloren.length > 0) z.still++;
          if (e.doppel.length > 0) z.doppel++;
          if (e.entkoppelt) z.entkopp++;
          z.frist += e.fristNachtraege;
          z.aufl += e.aufloesungen;
        }
      }
    }
  }
  return z;
}

describe(`Frist (${MODUS}, Stichprobe ${S})`, () => {
  afterAll(() => guidQuelleAus());

  it('F-fristlaenge', async () => {
    const zellen: Array<[string, Partial<KonfigN>, number]> = [
      ['N=3 / M=1', { geraete: 3, notizen: 1 }, 9],
      ['N=2 / M=3', { geraete: 2, notizen: 3 }, 10],
    ];
    for (const [zname, konfig, ereignisse] of zellen) {
      for (const externEdit of [false, true]) {
        const zeilen: string[] = [];
        for (const [fname, frist] of FRISTEN) {
          const z = await miss(konfig, ereignisse, frist, externEdit);
          zeilen.push(
            `${fname.padEnd(20)} n=${String(z.n).padStart(4)} | DOPPEL ${pz(z.doppel, z.n)} | ` +
              `VERLUST ${pz(z.verlust, z.n)} | still ${pz(z.still, z.n)} | ` +
              `DIV ${pz(z.div, z.n)} | ENTKOPP ${pz(z.entkopp, z.n)} | ` +
              `frist-nachtr ${z.frist} / aufl ${z.aufl}`
          );
        }
        // eslint-disable-next-line no-console
        console.log(
          `\n===== FRIST | ${zname} | ${MODUS} | externer Editor ${
            externEdit ? 'JA' : 'nein'
          } | ${S} Reihenfolgen x 3 Szenarien x 3 Editfaelle x 2 Tie-Break =====\n${zeilen.join(
            '\n'
          )}\n`
        );
      }
    }
    expect(true).toBe(true);
  });
});
