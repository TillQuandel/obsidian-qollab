// TEIL 6 — dem einen Regress nachgehen.
//
// In der Zelle `geteilt` + externer Editor meldet `parken-4` 36/720 STILLE
// Verluste (Token in keiner `.md` und in keiner Konfliktkopie). Der Bestand hat
// dort 0. „Verlust darf nicht steigen" ist die harte Auflage — also muss klar
// sein, WAS da verloren geht und warum.

import { lauf, permutationen, NOTE, type Editfall } from './lauf';
import { guidQuelleAus } from './guid-quelle';
import { parken } from './politiken';

const PERMS = permutationen(6);
jest.setTimeout(1800000);

describe('Teil 6 — stiller Verlust bei parken-4 / geteilt / extern', () => {
  afterAll(() => guidQuelleAus());

  it('faengt die Faelle ein und zeigt sie', async () => {
    const treffer: Array<{
      pi: number;
      editfall: Editfall;
      aWinnt: boolean;
      still: string[];
      verlust: string[];
      nachtraege: number;
    }> = [];
    for (const editfall of ['nurA', 'nurB', 'beide'] as Editfall[]) {
      for (let pi = 0; pi < PERMS.length; pi += 6) {
        for (const aWinnt of [true, false]) {
          const e = await lauf(
            {
              szenario: 'geteilt',
              editfall,
              reihenfolge: PERMS[pi],
              aWinnt,
              konfliktModus: 'kopie',
              sperreBis: 0,
              externEdit: true,
            },
            parken(4)
          );
          if (e.stillVerloren.length > 0) {
            treffer.push({
              pi,
              editfall,
              aWinnt,
              still: e.stillVerloren,
              verlust: e.befund.verlust,
              nachtraege: e.nachtraege,
            });
          }
        }
      }
    }
    const nachToken: Record<string, number> = {};
    for (const t of treffer) for (const s of t.still) nachToken[s] = (nachToken[s] ?? 0) + 1;
    const nachEditfall: Record<string, number> = {};
    for (const t of treffer) nachEditfall[t.editfall] = (nachEditfall[t.editfall] ?? 0) + 1;
    // eslint-disable-next-line no-console
    console.log(
      `Treffer: ${treffer.length}\nje Token: ${JSON.stringify(
        nachToken
      )}\nje Editfall: ${JSON.stringify(nachEditfall)}\nerste 5 Reihenfolgen: ${JSON.stringify(
        treffer.slice(0, 5).map((t) => [PERMS[t.pi], t.editfall, t.aWinnt, t.still])
      )}`
    );
    expect(NOTE).toBe('note.md');
  });

  // Gegenprobe: dieselbe Zelle mit dem BESTAND und mit `parken-8`.
  it('Gegenprobe Bestand und parken-8 in derselben Zelle', async () => {
    for (const [name, fabrik] of [
      ['heute-ohne-parken', parken(0)],
      ['diff-4', parken(4, false, false)],
      ['union-2', parken(2)],
      ['union-3', parken(3)],
      ['union-4', parken(4)],
      ['union-6', parken(6)],
      ['union-8', parken(8)],
    ] as const) {
      let still = 0;
      let verlust = 0;
      let doppel = 0;
      let eeeFehlt = 0;
      let n = 0;
      for (const editfall of ['nurA', 'nurB', 'beide'] as Editfall[]) {
        for (let pi = 0; pi < PERMS.length; pi += 6) {
          for (const aWinnt of [true, false]) {
            const e = await lauf(
              {
                szenario: 'geteilt',
                editfall,
                reihenfolge: PERMS[pi],
                aWinnt,
                konfliktModus: 'kopie',
                sperreBis: 0,
                externEdit: true,
              },
              fabrik
            );
            n++;
            if (e.stillVerloren.length > 0) still++;
            if (e.befund.verlust.length > 0) verlust++;
            if (e.befund.doppel.length > 0) doppel++;
            if (e.befund.verlust.includes('EEE')) eeeFehlt++;
          }
        }
      }
      // eslint-disable-next-line no-console
      console.log(
        `${name.padEnd(18)} n=${n} still=${still} verlust=${verlust} doppel=${doppel} EEE-fehlt=${eeeFehlt}`
      );
    }
    expect(true).toBe(true);
  });
});
