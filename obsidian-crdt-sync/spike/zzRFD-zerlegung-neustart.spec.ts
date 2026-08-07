// DIE ZERLEGUNG — TEIL 1: die geschlossene App (`neustart-offline-loeschung`).
//
// DIE FRAGE: „In 47,4 % der Laeufe mit einer Loeschung kehrt eine geloeschte
// Zeile zurueck" wird bisher pauschal als Fehler gefuehrt. Nach Shapiro et al.
// 2018 ist Add-wins der Standard — „a concurrent add and remove of the same
// element, the add wins". Eine NEBENLAEUFIGE fremde Einfuegung gewinnt also
// legitim gegen eine Loeschung; nur eine Loeschung, die den fremden Stand
// bereits KANNTE (kausal danach), haette bestehen bleiben muessen.
//
// Diese Datei misst die Aufteilung in der Lage, in der die bekannten Zahlen
// stehen. **Sie ist zugleich die Kalibrierung**: der erste Test pinnt die
// veroeffentlichten Werte aus `herkunft-2026-08-07.md` (§6b, Zeile
// „ueberschr. | offline-loeschung | roh/aus"). Trifft er sie nicht, ist der
// Aufbau kaputt und keine Zahl weiter unten sagt etwas aus.
//
// WAS IN DIESER LAGE PER BAU FESTSTEHT: A ist waehrend der ganzen Zustellphase
// GESCHLOSSEN. Es kann B's Ops nicht eingespielt haben, bevor der Nutzer die
// Zeile aus der `.md` entfernt. Jede Loeschung hier ist NEBENLAEUFIG — und das
// ist kein Messergebnis, sondern eine Eigenschaft der Lage. Genau deshalb
// braucht die Zerlegung die zweite Lage (`zzRFE`), in der beide Faelle
// vorkommen.

import { permutationen } from './lauf-rueckfall';
import type { SweepSchranke } from '../src/sync-handler';
import type { DiffModus } from '../src/crdt-manager';
import { messe, zeile, kausalzeile } from './bilanz';

jest.setTimeout(7200000);

const PERMS = permutationen(6);
const LAGE = 'neustart-offline-loeschung' as const;

// Bestand (der Stand, aus dem die 47,4 % stammen) und der seit `88ef6fe`
// produktive Stand. Beide, weil die Frage „wie gross ist das Problem heute"
// nur am zweiten zu beantworten ist und die Kalibrierung nur am ersten.
const STAENDE: Array<[DiffModus, SweepSchranke]> = [
  ['roh', 'aus'],
  ['semantisch', 'basis-signatur'],
];

describe('Zerlegung der Wiederbelebungen — geschlossene App', () => {
  it('KALIBRIERUNG: trifft die veroeffentlichten Zahlen ziffernweise', async () => {
    const z = await messe(
      {
        lage: LAGE,
        aWinnt: true,
        konfliktModus: 'ueberschreiben',
        schranke: 'aus',
        diffModus: 'roh',
      },
      PERMS
    );
    // eslint-disable-next-line no-console
    console.log('\n===== KALIBRIERUNG =====\n' + zeile(`${LAGE} roh/aus`, z));

    // herkunft-2026-08-07.md §6b, Zeile „ueberschr. | offline-loeschung | roh/aus"
    expect(z.n).toBe(720);
    expect(z.stillVerloren).toBe(240);
    expect(z.inKopie).toBe(0);
    expect(z.divergenz).toBe(0);
    expect(z.doppel).toBe(258);
    expect(z.grundtextWeg).toBe(296);
    expect(z.ganzWeg).toBe(296);
    expect(z.eingriffDurch).toBe(720);
    expect(z.schranke).toBe(0);
  });

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
  });
});
