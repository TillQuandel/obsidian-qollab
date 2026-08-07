// `basis-naechster` UEBER DIE VOLLEN VIER LAGEN — zwei Geraete.
//
// DIE SORGE, die diesen Lauf ausloest: `exakt` ist daran gefallen, dass es
// zuschlaegt, wenn die fremde Hilfsdatei noch die VERALTETE ist und damit
// woertlich den gemeinsamen Vorfahren traegt — es verwechselte „Text steht in
// einer fremden Revision" mit „Text kam von fremd". Eine ABSTANDSREGEL hat
// strukturell dieselbe Angriffsflaeche: der zurueckgespielte Stand IST der
// gemeinsame Vorfahre und liegt einer veralteten Fremd-Revision besonders nah.
// Waehlt `basis-naechster` dort die veraltete Revision als Basis, wird die
// Ruecknahme nie als Delta erfasst — derselbe Schaden, andere Tuer.
//
// DIE ENTSCHEIDENDE ZAHL steht in der Lage `neustart-rueckspielung`:
// „Eingriff durch" MUSS bei 711/720 bleiben. Faellt sie darunter, ist die Regel
// gefallen, egal wie gut die Drei-Geraete-Zahl aussieht.
//
// ZUGLEICH EINE STRUKTURPROBE: Mit ZWEI Geraeten gibt es nur einen fremden
// Sibling, `mehrfach` ist per Bau 0, und `basis-naechster` steigt in
// `fremdErklaert` vor jeder Abstandsrechnung mit `treffer[0]` aus. Die beiden
// Staende MUESSEN hier also Zeile fuer Zeile zusammenfallen. Tun sie es nicht,
// hat die Regel einen Nebeneffekt, den niemand kennt — und das waere der
// wichtigste Befund dieses Laufs, nicht eine Randnotiz.
//
// Zellbasis: die VOLLSTAENDIGE Aufzaehlung der 720 Zustellordnungen, beide
// Konfliktmodi, alle vier Lagen. Nichts gekuerzt.

import { permutationen, type Lage } from './lauf-rueckfall';
import type { SweepSchranke } from '../src/sync-handler';
import type { DiffModus } from '../src/crdt-manager';
import { messe, zeile } from './bilanz';

jest.setTimeout(7200000);

const PERMS = permutationen(6);

const STAENDE: Array<[DiffModus, SweepSchranke]> = [
  ['roh', 'aus'], // Bestand — die Kalibrierung jeder Zelle
  ['semantisch', 'basis-signatur'], // der produktive Stand
  ['semantisch', 'basis-naechster'], // der Kandidat
];

const LAGEN: Lage[] = [
  'neustart',
  'neustart-offline-edit',
  'neustart-rueckspielung',
  'neustart-offline-loeschung',
];

describe('basis-naechster ueber vier Lagen (zwei Geraete)', () => {
  it('misst alle vier Lagen in beiden Konfliktmodi', async () => {
    const zeilen: string[] = [];
    for (const konfliktModus of ['ueberschreiben', 'kopie'] as const) {
      for (const lage of LAGEN) {
        for (const [diffModus, schranke] of STAENDE) {
          const z = await messe(
            { lage, aWinnt: true, konfliktModus, schranke, diffModus },
            PERMS
          );
          const s = zeile(`${konfliktModus.slice(0, 6)} | ${lage} | ${diffModus}/${schranke}`, z);
          zeilen.push(s);
          // eslint-disable-next-line no-console
          console.log(s);
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log('\n===== VIER LAGEN, ZWEI GERAETE =====\n' + zeilen.join('\n'));
    expect(zeilen).toHaveLength(24);
  });
});
