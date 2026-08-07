// AUFTRAG B — BEIDE GERAETE AENDERN DIESELBE ZEILE.
//
// Alle bisherigen Messungen setzen A's und B's Baustein an VERSCHIEDENE Stellen.
// Das war Absicht: bei konkurrierenden Einfuegungen an derselben Position
// entscheidet Yjs nach clientID, und die ist im Treiber zwar deterministisch
// gesetzt, aber inhaltlich willkuerlich. Der schwierigere Fall blieb damit
// ungemessen.
//
// HIER: A macht aus `zeile-2` ein `zeile-2 AAA`, B aus derselben Zeile ein
// `zeile-2 BBB`. Beide Einfuegungen haengen am selben Anker, der Tie-Break
// entscheidet — und zwar in jeder der 720 Zustellordnungen ueber dieselbe,
// deterministisch gezogene clientID-Folge wie im Bestand.
//
// ZWEI MASSE MUESSEN AUSEINANDERGEHALTEN WERDEN:
//   Das STRENGE Grundtext-Mass nimmt `zeile-2` in dieser Lage AUS. Als ganze Zeile
//   ist sie nach dem Eingriff auf beiden Geraeten weg — auf Wunsch des Nutzers.
//   Sie mitzufuehren hiesse, jeden Lauf als K.o. zu melden.
//   Das lockere Mass (`occ`) behaelt sie: „steckt der Grundtext noch drin" ist
//   dort genau die richtige Frage, und ein Ausfall in der Spalte GRUNDTEXT WEG ist
//   in dieser Lage ein echter Befund.
//
// GEMESSEN WIRD gegen die getrennte Fassung derselben Lage — Zeile fuer Zeile, in
// denselben Schalterstaenden. Ohne diese Gegenrechnung waere nicht zu sagen, ob
// eine Zahl an der gemeinsamen Zeile haengt oder am Schalter.

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
];

describe('Auftrag B — dieselbe Zeile', () => {
  it('misst die Lage, in der A und B dieselbe Grundzeile aendern', async () => {
    const zeilen: string[] = [];
    for (const konfliktModus of ['ueberschreiben', 'kopie'] as const) {
      for (const editArt of ['getrennt', 'gleiche-zeile'] as const) {
        for (const [diffModus, schranke] of STAENDE) {
          const z = await messe(
            {
              lage: 'neustart',
              aWinnt: true,
              konfliktModus,
              schranke,
              diffModus,
              editArt,
            },
            PERMS
          );
          const s = zeile(`${konfliktModus} | ${editArt} | ${diffModus}/${schranke}`, z);
          zeilen.push(s);
          // eslint-disable-next-line no-console
          console.log(s);
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log('\n===== AUFTRAG B (dieselbe Zeile) =====\n' + zeilen.join('\n'));
    expect(zeilen).toHaveLength(12);
  });
});
