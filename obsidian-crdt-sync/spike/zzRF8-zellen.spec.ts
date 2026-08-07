// AUFTRAG C — DIE ZELLEN `rollout` UND `alltag`.
//
// Dieser Treiber fuhr bisher ausschliesslich `geteilt`: beide Geraete etabliert
// UND die umkaempfte Note mit gemeinsamer Historie. Der frueher gefallene
// Geschwister-Abgleich (`geschwister-abgleich-widerlegt-2026-08-04.md`) erzeugte
// neuen STILLEN Verlust genau dort, wo `geteilt` sauber blieb: in `rollout`
// (1,8 %) und `alltag` (2,4 %). Ein Instrument ohne diese beiden Zellen kann diese
// Schadensklasse strukturell nicht sehen.
//
// UEBERNOMMEN, NICHT NEU GEBAUT: Die Zellbasis stammt aus `spike/lauf.ts` auf
// `mess/verdopplung` (dort `Szenario`, Zeilen 31-36 und 113-141) — derselbe
// Aufbau, dieselbe Sperre fuer B's `.qollab/` im Rollout. Neu ist allein, dass sie
// jetzt am Treiber MIT Start-Sweep haengt; `lauf.ts` kennt den Sweep nicht und
// koennte die Sweep-Schranke deshalb gar nicht messen.
//
// `sperreBis = 4` im Rollout ist der Wert, mit dem die Geschwister-Messung gefahren
// wurde (`zz7-geschwister.spec.ts:82`).
//
// ACHTUNG BEIM LESEN: In `rollout` und `alltag` hat die Note keine gemeinsame
// Historie. `ensureDoc` kann dort ADOPTIEREN — und die Schranke wird nur bei
// `!adopted` befragt. Eine Null in der Spalte GREIFT ist dort deshalb kein Beleg
// fuer „harmlos", sondern fuer „nie gefragt". Beides ist ein Ergebnis, aber nicht
// dasselbe.

import { permutationen } from './lauf-rueckfall';
import type { SweepSchranke } from '../src/sync-handler';
import type { DiffModus } from '../src/crdt-manager';
import { messe, zeile } from './bilanz';

jest.setTimeout(7200000);

const PERMS = permutationen(6);

const STAENDE: Array<[DiffModus, SweepSchranke]> = [
  ['roh', 'aus'],
  ['semantisch', 'aus'],
  ['semantisch', 'basis-signatur'],
  // GEGENPROBE je Zelle: greift die Schranke hier ueberhaupt, wenn man sie
  // pauschal greifen laesst? Bleibt auch `basis-immer` bei null, ist die Zelle
  // ueber den Kandidaten stumm — und keine Null der Zeile darueber traegt.
  ['semantisch', 'basis-immer'],
];

describe('Auftrag C — Zellbasis rollout und alltag', () => {
  it('misst geteilt, alltag und rollout in denselben Schalterstaenden', async () => {
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
    console.log('\n===== AUFTRAG C (Zellbasis) =====\n' + zeilen.join('\n'));
    expect(zeilen).toHaveLength(12);
  });

  // Dieselben drei Zellen im anderen Konfliktmodus. `kopie` ist der OneDrive-Fall
  // (die verdraengte Fassung ueberlebt als Konfliktkopie) — genau der Modus, in dem
  // die Geschwister-Messung ihre Zahlen erhoben hat. Ohne ihn waere der Vergleich
  // mit `geschwister-abgleich-widerlegt` ein Vergleich ueber zwei Modi hinweg.
  it('misst dieselben Zellen im Konfliktmodus kopie', async () => {
    const zeilen: string[] = [];
    for (const zelle of ['geteilt', 'alltag', 'rollout'] as const) {
      for (const [diffModus, schranke] of [STAENDE[0], STAENDE[2]]) {
        const z = await messe(
          {
            lage: 'neustart',
            aWinnt: true,
            konfliktModus: 'kopie',
            schranke,
            diffModus,
            zelle,
            sperreBis: zelle === 'rollout' ? 4 : 0,
          },
          PERMS
        );
        const s = zeile(`kopie | ${zelle} | ${diffModus}/${schranke}`, z);
        zeilen.push(s);
        // eslint-disable-next-line no-console
        console.log(s);
      }
    }
    // eslint-disable-next-line no-console
    console.log('\n===== AUFTRAG C (Modus kopie) =====\n' + zeilen.join('\n'));
    expect(zeilen).toHaveLength(6);
  });
});
