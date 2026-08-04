// TEIL 15 — DEN EINEN LAUF FINDEN.
//
// `korrigieren` erzeugte in der Zelle N=3 / M=1 / externer Schreiber genau EINEN
// Lauf von 576 mit stillem Verlust — dort, wo `ersetzen` keinen hat. Stiller
// Verlust ist die teuerste Fehlerklasse des Projekts: Der Text liegt danach in
// keiner Sicherungs- und keiner Konfliktkopie mehr.
//
// Die Stichprobe ist deterministisch (Lehmer-Rang, kein PRNG, keine Uhr), der
// Lauf ist also exakt reproduzierbar. Dieser Spec sucht ihn und gibt seine
// vollstaendige Konfiguration aus.

import { laufN, alsN, stichprobe } from './lauf-n';
import type { Szenario, Editfall } from './lauf';
import { guidQuelleAus } from './guid-quelle';
import { parkenMit } from './politiken';

const MODUS = (process.env.SPIKE_MODUS as 'kopie' | 'ohne') ?? 'kopie';
const S = Number(process.env.SPIKE_STICHPROBE ?? 48);
const SZENARIEN: Szenario[] = ['geteilt', 'alltag'];
const EDITFAELLE: Editfall[] = ['nurA', 'nurB', 'beide'];

jest.setTimeout(3600000);

describe('Stiller Fall', () => {
  afterAll(() => guidQuelleAus());

  it('F-finde-stillen-verlust', async () => {
    const treffer: string[] = [];
    const perms = stichprobe(9, S);
    for (const verfahren of ['korrigieren', 'ersetzen'] as const) {
      for (const szenario of SZENARIEN) {
        for (const editfall of EDITFAELLE) {
          for (const [pi, reihenfolge] of perms.entries()) {
            for (const aWinnt of [true, false]) {
              const e = await laufN(
                {
                  szenario,
                  editfall,
                  reihenfolge,
                  aWinnt,
                  konfliktModus: MODUS,
                  sperreBis: 0,
                  externEdit: true,
                  uhrModus: 'alle',
                  geraete: 3,
                  notizen: 1,
                },
                alsN(parkenMit(4, verfahren))
              );
              if (e.stillVerloren.length > 0) {
                treffer.push(
                  `${verfahren} | ${szenario} / ${editfall} / perm#${pi} [${reihenfolge.join(
                    ','
                  )}] / aWinnt=${aWinnt}\n` +
                    `      still verloren: ${JSON.stringify(e.stillVerloren)}\n` +
                    `      verlust gesamt: ${JSON.stringify(e.verlust)}\n` +
                    `      doppel: ${JSON.stringify(e.doppel)} | parkungen ${e.parkungen} | ` +
                    `nachtraege ${e.nachtraege} (aufl ${e.aufloesungen} / frist ${e.fristNachtraege})`
                );
              }
            }
          }
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log(
      `\n===== STILLER VERLUST | N=3 / M=1 / externer Schreiber | Stichprobe ${S} =====\n` +
        (treffer.length === 0 ? '  (kein Lauf gefunden)' : treffer.map((t) => `  ${t}`).join('\n')) +
        '\n'
    );
    expect(true).toBe(true);
  });
});
