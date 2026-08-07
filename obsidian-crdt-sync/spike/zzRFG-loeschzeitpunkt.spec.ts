// DIE ZERLEGUNG — TEIL 4: WANN wird geloescht?
//
// DER EINWAND GEGEN TEIL 2 UND 3. Dort steht die Loeschung NACH der ganzen
// Zustellphase. Danach kann keine veraltete fremde `.md` mehr eintreffen — und
// genau dieser Weg ist der einzige, auf dem eine KAUSAL NACHGELAGERTE Loeschung
// ueberhaupt wiederbelebt werden koennte:
//
//   A spielt B's Ops ein (kausal)  ->  A loescht die Zeile  ->  B's VERALTETE
//   `.md` trifft ein, traegt die Zeile noch  ->  Tor parkt sie  ->  Frist laeuft
//   ab  ->  `tickParked` loest per `unionMerge(p.text, doc)` auf  ->  Vereinigen
//   kann nichts loeschen  ->  DIE ZEILE IST ZURUECK.
//
// „0 fehlerhafte Wiederbelebungen" waere ohne diese Datei eine Aussage ueber
// genau EINE Anordnung, nicht ueber den Raum. Der Schalter `loeschungNach`
// verschiebt den Eingriff durch die Zustellphase: 0 = vor allen Ereignissen,
// 6 = nach allen (der Bestand von `zzRFE`).
//
// Zwei Praegerichtungen, weil die Kausalitaet an ihnen haengt:
//   `geteilt` + aWinnt=true  — gemeinsame Historie, A adoptiert nichts.
//   `alltag`  + aWinnt=false — keine gemeinsame Historie, A adoptiert B's
//                              Inkarnation; erst dadurch kann in dieser Zelle
//                              ueberhaupt eine kausale Beziehung entstehen.
//
// Zellbasis: volle 720 Zustellordnungen je Zelle, nichts gekuerzt.

import { permutationen } from './lauf-rueckfall';
import type { SweepSchranke } from '../src/sync-handler';
import type { DiffModus } from '../src/crdt-manager';
import { messe, kausalzeile } from './bilanz';

jest.setTimeout(7200000);

const PERMS = permutationen(6);

const STAENDE: Array<[DiffModus, SweepSchranke]> = [
  ['roh', 'aus'],
  ['semantisch', 'basis-signatur'],
];

// Zelle, Praegerichtung, Sperre.
const ZELLEN: Array<['geteilt' | 'alltag', boolean]> = [
  ['geteilt', true],
  ['alltag', false],
];

describe('Zerlegung der Wiederbelebungen — Zeitpunkt der Loeschung', () => {
  it('verschiebt die Loeschung durch die ganze Zustellphase', async () => {
    const zeilen: string[] = [];
    let fehlerhaftGesamt = 0;
    let kausalGesamt = 0;
    for (const [zelle, aWinnt] of ZELLEN) {
      for (const [diffModus, schranke] of STAENDE) {
        for (let loeschungNach = 0; loeschungNach <= 6; loeschungNach++) {
          const z = await messe(
            {
              lage: 'laufend-loeschung',
              aWinnt,
              konfliktModus: 'ueberschreiben',
              schranke,
              diffModus,
              zelle,
              loeschungNach,
            },
            PERMS
          );
          const name =
            `${zelle}/aWinnt=${aWinnt} | ${diffModus}/${schranke} | ` +
            `nach ${loeschungNach}`;
          const s = `${name.padEnd(56)} ${kausalzeile(z)}`;
          zeilen.push(s);
          fehlerhaftGesamt += z.wiederKausal;
          kausalGesamt += z.kannteFremd;
          // eslint-disable-next-line no-console
          console.log(s);
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log(
      '\n===== ZEITPUNKT DER LOESCHUNG =====\n' +
        zeilen.join('\n') +
        `\n\nSUMME ueber ${zeilen.length} Zellen a 720: kausal nachgelagerte Loeschungen ` +
        `${kausalGesamt}, davon wiederbelebt (FEHLERHAFT) ${fehlerhaftGesamt}`
    );
    expect(zeilen).toHaveLength(28);
    // AKTIVITAETSPROBE: In diesem Raum MUESSEN kausal nachgelagerte Loeschungen
    // vorkommen — sonst misst der Lauf die eine interessante Haelfte gar nicht.
    expect(kausalGesamt).toBeGreaterThan(0);
    // ANTI-BLINDHEITS-RIEGEL, und der wichtigste `expect` dieser Datei. In den
    // uebrigen Messungen steht in der Spalte FEHLERHAFT durchgaengig null. Eine
    // Null ist erst dann ein Befund, wenn dasselbe Instrument anderswo eine Zahl
    // ungleich null liefert — sonst ist sie von „der Zaehler ist blind" nicht zu
    // unterscheiden. Hier tut er es (gemessen: `geteilt`/`roh`/`aus`, Loeschung
    // nach 2 Ereignissen). Faellt diese Zeile auf null, ist jede andere Null
    // dieser Sitzung wertlos.
    expect(fehlerhaftGesamt).toBeGreaterThan(0);
  });
});
