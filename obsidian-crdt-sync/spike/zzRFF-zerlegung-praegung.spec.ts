// DIE ZERLEGUNG — TEIL 3: die Gegenrichtung der Praegung (`aWinnt: false`).
//
// WARUM DIESE ZELLE NOETIG IST. In `zzRFE` (Lage `laufend-loeschung`) steht in
// den Zellen OHNE gemeinsame Historie (`alltag`, `rollout`) „kausal danach 0" —
// und zwar in allen 720 Ordnungen, obwohl A in der Haelfte davon B's Hilfsdatei
// gezogen und gepollt hat. Der Grund ist die Inkarnations-Entscheidung: mit
// `aWinnt: true` gewinnt A's GUID, A adoptiert B also NIE und B's Ops kommen
// nie in A's Doc. Die Null waere damit kein Befund ueber die Kausalitaet,
// sondern ein Artefakt der Praegerichtung.
//
// Diese Datei dreht sie um. Adoptiert A dagegen B's Inkarnation, MUSS „kausal
// danach" von null weggehen — tut es das nicht, misst der Zaehler in diesen
// Zellen etwas anderes als das, was er messen soll.
//
// Zellbasis: volle 720 Zustellordnungen je Zelle, nichts gekuerzt.

import { permutationen } from './lauf-rueckfall';
import type { SweepSchranke } from '../src/sync-handler';
import type { DiffModus } from '../src/crdt-manager';
import { messe, zeile, kausalzeile } from './bilanz';

jest.setTimeout(7200000);

const PERMS = permutationen(6);

const STAENDE: Array<[DiffModus, SweepSchranke]> = [
  ['roh', 'aus'],
  ['semantisch', 'basis-signatur'],
];

describe('Zerlegung der Wiederbelebungen — Gegenrichtung der Praegung', () => {
  it('misst beide Loeschungs-Lagen mit aWinnt=false', async () => {
    const zeilen: string[] = [];
    for (const lage of ['laufend-loeschung', 'neustart-offline-loeschung'] as const) {
      for (const zelle of ['geteilt', 'alltag', 'rollout'] as const) {
        for (const [diffModus, schranke] of STAENDE) {
          const z = await messe(
            {
              lage,
              aWinnt: false,
              konfliktModus: 'ueberschreiben',
              schranke,
              diffModus,
              zelle,
              sperreBis: zelle === 'rollout' ? 4 : 0,
            },
            PERMS
          );
          const name = `aWinnt=false | ${lage} | ${zelle} | ${diffModus}/${schranke}`;
          zeilen.push(`${name.padEnd(64)} ${kausalzeile(z)}`);
          // eslint-disable-next-line no-console
          console.log(zeile(name, z));
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log('\n===== ZERLEGUNG aWinnt=false =====\n' + zeilen.join('\n'));
    expect(zeilen).toHaveLength(12);
  });
});
