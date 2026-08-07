// DIE KALIBRIERUNG DES ERWEITERTEN TREIBERS.
//
// `lauf-rueckfall.ts` hat drei neue Schalter bekommen (Zellbasis, Editart, drittes
// Geraet) und `bilanz.ts` ist eine ZWEITE Aggregation neben der in
// `zzRF-rueckfall.spec.ts`. Beides kann die alten Zahlen still verschieben. Dieser
// Lauf ist der Riegel davor: Er faehrt den Bestandsaufbau — zwei Geraete, Zelle
// `geteilt`, getrennte Edits, volle 720 Zustellordnungen — und PINNT die
// veroeffentlichten Zahlen aus `herkunft-2026-08-07.md` als `expect`.
//
// Trifft er sie nicht, ist der Aufbau kaputt und keine Zahl der drei
// Folgemessungen (`zzRF6`, `zzRF7`, `zzRF8`) sagt etwas aus.
//
// Sollwerte (Lage `neustart`, Modus `ueberschreiben`, n = 720):
//   roh / aus            -> still verloren 240, doppelt 256, divergent 0, greift   0
//   roh / basis-signatur -> still verloren  60, doppelt  76, divergent 0, greift 180
//   Beweis da 360 in beiden (Eigenschaft der Zustellordnung, nicht des Eingriffs).

import { permutationen, permutationNr } from './lauf-rueckfall';
import { messe, zeile } from './bilanz';

jest.setTimeout(3600000);

const PERMS = permutationen(6);

describe('Kalibrierung des erweiterten Rueckfall-Treibers', () => {
  // Vorprobe ohne Laufzeitkosten: die gekuerzte Zellbasis der Mehrgeraete-Messung
  // steht und faellt damit, dass `permutationNr` dieselbe Ordnung aufzaehlt wie
  // `permutationen`. Ohne diese Zeile waere die Stichprobe eine Behauptung.
  it('permutationNr zaehlt dieselbe Ordnung auf wie permutationen', () => {
    for (let i = 0; i < PERMS.length; i++) {
      expect(permutationNr(6, i)).toEqual(PERMS[i]);
    }
  });

  it('reproduziert den Bestand der Zelle geteilt ziffernweise', async () => {
    const bestand = await messe(
      {
        lage: 'neustart',
        aWinnt: true,
        konfliktModus: 'ueberschreiben',
        schranke: 'aus',
        diffModus: 'roh',
      },
      PERMS
    );
    const kandidat = await messe(
      {
        lage: 'neustart',
        aWinnt: true,
        konfliktModus: 'ueberschreiben',
        schranke: 'basis-signatur',
        diffModus: 'roh',
      },
      PERMS
    );
    // eslint-disable-next-line no-console
    console.log(
      '\n===== KALIBRIERUNG =====\n' +
        zeile('roh / aus', bestand) +
        '\n' +
        zeile('roh / basis-signatur', kandidat)
    );

    expect(bestand.n).toBe(720);
    expect(bestand.stillVerloren).toBe(240);
    expect(bestand.doppel).toBe(256);
    expect(bestand.divergenz).toBe(0);
    expect(bestand.schranke).toBe(0);
    expect(bestand.beweisDa).toBe(360);

    expect(kandidat.stillVerloren).toBe(60);
    expect(kandidat.doppel).toBe(76);
    expect(kandidat.divergenz).toBe(0);
    expect(kandidat.schranke).toBe(180);
    expect(kandidat.beweisDa).toBe(360);
    // Bei genau EINEM fremden Geraet kann es keine zweite Basis geben — die
    // Mehrdeutigkeit muss hier per Bau null sein. Ist sie es nicht, zaehlt die
    // neue Probe etwas anderes als das, was sie zaehlen soll.
    expect(kandidat.mehrfach).toBe(0);
    expect(kandidat.treffer).toBe(180);
  });
});
