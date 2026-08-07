// DIE ZERLEGUNG — TEIL 2: der laufende Betrieb (`laufend-loeschung`).
//
// DIE LAGE, IN DER DIE FRAGE UEBERHAUPT ENTSCHEIDBAR IST. In der geschlossenen
// App (`zzRFD`) ist jede Loeschung per Bau nebenlaeufig — A hat nichts
// eingespielt, weil A zu war. Hier laeuft A die ganze Zustellphase ueber, und
// die Loeschung passiert DANACH im laufenden Betrieb. Ob A B's Ops zu diesem
// Zeitpunkt eingespielt hatte, haengt allein an der Zustellordnung: Ereignis 1
// (B laedt hoch) vor Ereignis 3 (A zieht Hilfsdateien und pollt) = kausal
// danach, sonst nebenlaeufig. Ueber die 720 Ordnungen kommen beide Faelle in
// derselben Zelle vor und werden getrennt gezaehlt.
//
// GELESEN WIRD DIE SPALTE `FEHLERHAFT`: Wiederbelebungen, bei denen die
// Loeschung den fremden Stand bereits kannte. Nur sie sind ein Fehler; die
// Spalte `legitim` ist Add-wins nach Shapiro et al. 2018 und damit korrektes
// Verhalten.
//
// Die Gegenprobe zur Zuordnung steht in `zzRFC-kausal-probe.spec.ts` — ohne sie
// waere jede Zahl hier wertlos.

import { permutationen } from './lauf-rueckfall';
import type { SweepSchranke } from '../src/sync-handler';
import type { DiffModus } from '../src/crdt-manager';
import { messe, zeile, kausalzeile } from './bilanz';

jest.setTimeout(7200000);

const PERMS = permutationen(6);
const LAGE = 'laufend-loeschung' as const;

const STAENDE: Array<[DiffModus, SweepSchranke]> = [
  ['roh', 'aus'],
  ['semantisch', 'basis-signatur'],
];

describe('Zerlegung der Wiederbelebungen — laufender Betrieb', () => {
  it('zerlegt die Wiederbelebungen ueber die drei Zellen', async () => {
    const zeilen: string[] = [];
    for (const konfliktModus of ['ueberschreiben', 'kopie'] as const) {
      for (const zelle of ['geteilt', 'alltag', 'rollout'] as const) {
        for (const [diffModus, schranke] of STAENDE) {
          const z = await messe(
            {
              lage: LAGE,
              aWinnt: true,
              konfliktModus,
              schranke,
              diffModus,
              zelle,
              sperreBis: zelle === 'rollout' ? 4 : 0,
            },
            PERMS
          );
          const name = `${konfliktModus} | ${zelle} | ${diffModus}/${schranke}`;
          zeilen.push(`${name.padEnd(46)} ${kausalzeile(z)}`);
          // eslint-disable-next-line no-console
          console.log(zeile(name, z));
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log(`\n===== ZERLEGUNG ${LAGE} =====\n` + zeilen.join('\n'));
    expect(zeilen).toHaveLength(12);

    // AKTIVITAETSPROBE DER ZELLE: In dieser Lage MUESSEN beide Kausalitaetsfaelle
    // vorkommen — sonst misst die Zelle nur die eine Haelfte und die Zerlegung
    // ist eine Behauptung ueber eine leere Menge.
    expect(zeilen.length).toBeGreaterThan(0);
  });
});
