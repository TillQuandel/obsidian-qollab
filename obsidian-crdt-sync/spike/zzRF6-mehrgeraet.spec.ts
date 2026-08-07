// AUFTRAG A — MEHRERE FREMDE GERAETE.
//
// `fremdErklaert` (sync-handler.ts) sammelt die erklaerenden Geschwister und gibt
// den ERSTEN zurueck. Mit genau einem fremden Geraet ist das keine Wahl; ab zwei
// ist es eine willkuerliche. Im bisherigen Harness gab es nur B — der Fall kam nie
// vor, und „die Wahl des ersten ist unschaedlich" war nie gemessen, sondern
// unbeobachtbar.
//
// AUFBAU: drei Geraete A, B, C. A ist waehrend der Zustellung geschlossen (Lage
// `neustart`), B und C bearbeiten die Note an je eigener Stelle. Nach dem Start
// liegen auf A's Platte ZWEI fremde Hilfsdateien; beide koennen den vorgefundenen
// Text erklaeren, oder nur eine, oder keine.
//
// DIE ZELLBASIS IST GEKUERZT — und zwar ausdruecklich:
//   Zwei Geraete = 6 Ereignisse = 720 Zustellordnungen, vollstaendig aufgezaehlt.
//   Drei Geraete = 9 Ereignisse = 362.880 Ordnungen. Gefahren wird davon JEDE
//   504-te (`stichprobe(9, 504)`), also genau 720 — dieselbe Zellgroesse wie
//   bisher. Die Stichprobe ist systematisch, nicht zufaellig: ueber den ersten
//   Ereignisplatz exakt gleichverteilt (80 je Platz), ueber die ersten beiden
//   ebenfalls (10 je Paar). WEGGELASSEN sind damit 362.160 Ordnungen — 99,8 %.
//   Wer eine Rate aus dieser Zelle liest, liest sie aus einer 1:504-Stichprobe.
//
// GEMESSEN WIRD in fuenf Schalterstaenden:
//   roh / aus                   — der Bestand, auch in dieser Zelle zuerst.
//   semantisch / aus            — nur der Diff-Fix, ohne Schranke.
//   semantisch / basis-signatur — der PRODUKTIVE Stand seit 88ef6fe.
//   semantisch / basis-naechster— die Alternative: unter mehreren Treffern gewinnt
//                                 der, dessen Text dem vorgefundenen am naechsten
//                                 liegt. NEUER Schalterstand, der bestehende
//                                 bleibt unberuehrt.
//   semantisch / basis-immer    — MUTATIONS-/GEGENPROBE: jeder fremde Sibling
//                                 erklaert. Sie erzeugt die Mehrdeutigkeit
//                                 maximal und belegt damit, dass die Zaehlung
//                                 „mehrfach" ueberhaupt etwas sehen kann.

import { stichprobe, permutationen } from './lauf-rueckfall';
import type { SweepSchranke } from '../src/sync-handler';
import type { DiffModus } from '../src/crdt-manager';
import { messe, zeile } from './bilanz';

jest.setTimeout(7200000);

// Jede 504-te der 9! Ordnungen -> genau 720.
const ORDNUNGEN3 = stichprobe(9, 504);
const ORDNUNGEN2 = permutationen(6);

const STAENDE: Array<[DiffModus, SweepSchranke]> = [
  ['roh', 'aus'],
  ['semantisch', 'aus'],
  ['semantisch', 'basis-signatur'],
  ['semantisch', 'basis-naechster'],
  ['semantisch', 'basis-immer'],
];

describe('Auftrag A — drei Geraete', () => {
  it('misst die Wahl unter mehreren erklaerenden Geschwistern', async () => {
    const zeilen: string[] = [];
    // ZUERST die Gegenrechnung mit ZWEI Geraeten ueber dieselbe Lage. Sie ist die
    // Bruecke zu den veroeffentlichten Zahlen: dieselbe Zelle, dieselbe Lage, nur
    // ohne C. Ohne sie waere jede Bewegung in der Drei-Geraete-Zelle nicht dem
    // dritten Geraet zuzuschreiben, sondern koennte am geaenderten Treiber liegen.
    for (const [diffModus, schranke] of [
      STAENDE[0],
      STAENDE[2],
    ] as Array<[DiffModus, SweepSchranke]>) {
      const z = await messe(
        {
          lage: 'neustart',
          aWinnt: true,
          konfliktModus: 'ueberschreiben',
          schranke,
          diffModus,
          geraete: 2,
        },
        ORDNUNGEN2
      );
      zeilen.push(zeile(`2 Geraete | ${diffModus}/${schranke}`, z));
    }
    for (const [diffModus, schranke] of STAENDE) {
      const z = await messe(
        {
          lage: 'neustart',
          aWinnt: true,
          konfliktModus: 'ueberschreiben',
          schranke,
          diffModus,
          geraete: 3,
        },
        ORDNUNGEN3
      );
      const s = zeile(`3 Geraete | ${diffModus}/${schranke}`, z);
      zeilen.push(s);
      // eslint-disable-next-line no-console
      console.log(s);
    }
    // eslint-disable-next-line no-console
    console.log('\n===== AUFTRAG A (3 Geraete, 1:504-Stichprobe) =====\n' + zeilen.join('\n'));
    expect(zeilen).toHaveLength(7);
  });
});
