// `basis-naechster` in den Zellen `alltag`/`rollout` und auf DERSELBEN ZEILE.
//
// Beide Aufbauten stammen aus den Auftraegen B und C derselben Session; hier
// laeuft nur der dritte Schalterstand mit. Auch das ist die Strukturprobe aus
// `zzRF9`: zwei Geraete, `mehrfach` per Bau 0, also muessen `basis-signatur` und
// `basis-naechster` zusammenfallen. Die Zellen unterscheiden sich vom
// `geteilt`-Fall darin, WANN die Schranke ueberhaupt gefragt wird — und genau
// deshalb sind sie kein blosser Wiederholungslauf.
//
// Zellbasis: volle 720 Zustellordnungen je Zelle. Nichts gekuerzt.

import { permutationen } from './lauf-rueckfall';
import type { SweepSchranke } from '../src/sync-handler';
import type { DiffModus } from '../src/crdt-manager';
import { messe, zeile } from './bilanz';

jest.setTimeout(7200000);

const PERMS = permutationen(6);

const STAENDE: Array<[DiffModus, SweepSchranke]> = [
  ['roh', 'aus'],
  ['semantisch', 'basis-signatur'],
  ['semantisch', 'basis-naechster'],
];

describe('basis-naechster in den uebrigen Aufbauten', () => {
  it('misst die Zellen alltag und rollout', async () => {
    const zeilen: string[] = [];
    for (const zelle of ['geteilt', 'alltag', 'rollout'] as const) {
      for (const [diffModus, schranke] of STAENDE) {
        const z = await messe(
          {
            lage: 'neustart',
            aWinnt: true,
            konfliktModus: 'ueberschreiben',
            schranke,
            diffModus,
            zelle,
            sperreBis: zelle === 'rollout' ? 4 : 0,
          },
          PERMS
        );
        const s = zeile(`${zelle} | ${diffModus}/${schranke}`, z);
        zeilen.push(s);
        // eslint-disable-next-line no-console
        console.log(s);
      }
    }
    // eslint-disable-next-line no-console
    console.log('\n===== ZELLEN =====\n' + zeilen.join('\n'));
    expect(zeilen).toHaveLength(9);
  });

  it('misst die gemeinsame Zeile', async () => {
    const zeilen: string[] = [];
    for (const konfliktModus of ['ueberschreiben', 'kopie'] as const) {
      for (const [diffModus, schranke] of STAENDE) {
        const z = await messe(
          {
            lage: 'neustart',
            aWinnt: true,
            konfliktModus,
            schranke,
            diffModus,
            editArt: 'gleiche-zeile',
          },
          PERMS
        );
        const s = zeile(`${konfliktModus} | gleiche-zeile | ${diffModus}/${schranke}`, z);
        zeilen.push(s);
        // eslint-disable-next-line no-console
        console.log(s);
      }
    }
    // eslint-disable-next-line no-console
    console.log('\n===== GLEICHE ZEILE =====\n' + zeilen.join('\n'));
    expect(zeilen).toHaveLength(6);
  });
});
