// DER HARTE RIEGEL VOR JEDER SAAT-MESSUNG.
//
// Mit `kennung: 'zufall'` und `saatLage: 'bestand'` MUSS der umgebaute Treiber
// die bekannten Zahlen aus `herkunft-2026-08-07.md` §6a·C ziffernweise
// reproduzieren. Trifft er sie nicht, ist der Umbau kaputt und jede Zahl
// darunter wertlos.
//
// Zellbasis: die VOLLSTAENDIGEN 720 Zustellordnungen je Zelle, nichts gekuerzt.
// Lage `neustart`, Modus `ueberschreiben`, zwei Geraete, kleine Notiz,
// `sperreBis = 4` im Rollout wie in `zzRF8-zellen.spec.ts:57`.

import { permutationen, type Zelle } from './lauf-rueckfall';
import type { SweepSchranke } from '../src/sync-handler';
import type { DiffModus } from '../src/crdt-manager';
import { messe, zeile } from './bilanz';

jest.setTimeout(7200000);

const PERMS = permutationen(6);

const STAENDE: Array<[DiffModus, SweepSchranke]> = [
  ['roh', 'aus'],
  ['semantisch', 'basis-signatur'],
];
const ZELLEN: Zelle[] = ['alltag', 'rollout'];

describe('Saat-Kennung — Kalibrierung des umgebauten Treibers', () => {
  it('reproduziert alltag und rollout ziffernweise', async () => {
    const gemessen = new Map<string, Awaited<ReturnType<typeof messe>>>();
    for (const zelle of ZELLEN) {
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
            kennung: 'zufall',
            saatLage: 'bestand',
          },
          PERMS
        );
        const name = `${zelle} | ${diffModus}/${schranke}`;
        gemessen.set(name, z);
        // eslint-disable-next-line no-console
        console.log(zeile(name, z));
      }
    }

    // KALIBRIERUNG gegen `herkunft-2026-08-07.md` §6a·C.
    const soll: Array<[string, number, number]> = [
      ['alltag | roh/aus', 240, 94],
      ['alltag | semantisch/basis-signatur', 60, 22],
      ['rollout | roh/aus', 240, 68],
      ['rollout | semantisch/basis-signatur', 60, 16],
    ];
    for (const [name, still, doppelt] of soll) {
      const z = gemessen.get(name)!;
      expect([name, z.n, z.stillVerloren, z.doppel]).toEqual([name, 720, still, doppelt]);
      // Die drei Nullen der Aktenlage gehoeren mit in den Riegel — ohne sie
      // koennte der Umbau sie kaputtmachen, ohne dass es auffaellt.
      expect([name, z.divergenz, z.ganzWeg]).toEqual([name, 0, 0]);
      // Und die Gegenprobe: mit 'zufall' wird keine Saat-Kennung gepraegt.
      expect([name, z.saatPraegungen, z.saatGleich]).toEqual([name, 0, 0]);
    }
  });
});
