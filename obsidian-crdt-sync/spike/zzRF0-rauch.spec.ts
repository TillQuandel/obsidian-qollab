// Rauchtest: laeuft das Szenario ueberhaupt den Weg, den es messen soll?
// Kein Messergebnis — nur die Diagnose, damit eine Zahl aus `zzRF-rueckfall`
// nicht aus einem Aufbau stammt, der am Gate endet.
//
// Bewusst Reihenfolgen, in denen B ZUERST hochlaedt (Ereignis 1 vor Ereignis 0):
// nur dann ueberschreibt der Sync-Dienst A's lokal geaenderte `.md` — der Fall,
// um den es geht. Laedt A zuerst hoch, ist sein Edit ohnehin in Sicherheit.

import { laufRueckfall, permutationen } from './lauf-rueckfall';

jest.setTimeout(600000);

it('Diagnose: der Rueckfall passiert und der Sweep sieht ihn', async () => {
  const perms = permutationen(6).filter((p) => p.indexOf(1) < p.indexOf(0)).slice(0, 4);
  for (const konfliktModus of ['kopie', 'ueberschreiben'] as const) {
    for (const lage of ['laufend', 'neustart'] as const) {
      for (const reihenfolge of perms) {
        const e = await laufRueckfall({ lage, reihenfolge, aWinnt: true, konfliktModus });
        // eslint-disable-next-line no-console
        console.log(
          `${konfliktModus.padEnd(14)} ${lage.padEnd(9)} [${reihenfolge.join('')}] ` +
            `sweepSah=${e.sweepAngesehen} park=${e.parkungen} ` +
            `verlust=[${e.befund.verlust}] still=[${e.stillVerloren}] kopie=[${e.inKopie}] ` +
            `doppel=[${e.befund.doppel}] div=${e.befund.divergenz}`
        );
      }
    }
  }
  expect(true).toBe(true);
});
