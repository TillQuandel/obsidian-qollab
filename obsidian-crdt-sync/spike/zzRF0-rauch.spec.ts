// Rauchtest: laeuft das Szenario ueberhaupt den Weg, den es messen soll?
// Kein Messergebnis — nur die Diagnose, damit eine Zahl aus `zzRF-rueckfall`
// nicht aus einem Aufbau stammt, der am Gate endet.
//
// Bewusst Reihenfolgen, in denen B ZUERST hochlaedt (Ereignis 1 vor Ereignis 0):
// nur dann ueberschreibt der Sync-Dienst A's lokal geaenderte `.md` — der Fall,
// um den es geht. Laedt A zuerst hoch, ist sein Edit ohnehin in Sicherheit.

import { laufRueckfall, permutationen } from './lauf-rueckfall';
import type { SweepSchranke } from '../src/sync-handler';

jest.setTimeout(600000);

const SCHRANKE = (process.env.SPIKE_SCHRANKE as SweepSchranke | undefined) ?? 'aus';

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

// Dieselbe Diagnose fuer die beiden FALSCH-POSITIV-Lagen — und zugleich die
// Probe auf die Zuordnung, die die Aggregatzahlen nur nahelegen: greift die
// Schranke genau dann, wenn KEIN frischer fremder Nachweis vorliegt (`beweis=false`,
// B's Hilfsdatei auf A's Platte ist noch die alte und traegt woertlich den
// gemeinsamen Stand)? Ueber die Summenspalte allein waere das geraten.
//
// Hier laufen ALLE 720 Reihenfolgen: die Paarung ist eine Aussage ueber jeden
// einzelnen Lauf, und ein Gegenbeispiel muss auffallen duerfen. Ausgegeben wird
// nur die Kreuztabelle.
it('Diagnose: greift die Schranke im Gleichtakt mit dem fremden Nachweis?', async () => {
  for (const lage of [
    'neustart-offline-edit',
    'neustart-rueckspielung',
    'neustart-offline-loeschung',
  ] as const) {
    const tafel = { 'beweis+greift': 0, 'beweis+still': 0, 'ohne+greift': 0, 'ohne+still': 0 };
    for (const reihenfolge of permutationen(6)) {
      const e = await laufRueckfall({
        lage,
        reihenfolge,
        aWinnt: true,
        konfliktModus: 'ueberschreiben',
        schranke: SCHRANKE,
      });
      const schluessel = `${e.beweisDa ? 'beweis' : 'ohne'}+${e.schranke > 0 ? 'greift' : 'still'}`;
      tafel[schluessel as keyof typeof tafel]++;
    }
    // eslint-disable-next-line no-console
    console.log(`${lage.padEnd(27)} (Schranke: ${SCHRANKE}) ${JSON.stringify(tafel)}`);
  }
  expect(true).toBe(true);
});
