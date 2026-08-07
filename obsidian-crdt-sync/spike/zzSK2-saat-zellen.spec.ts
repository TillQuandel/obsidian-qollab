// DIE SAAT-KENNUNG IN DEN ERSTKONTAKT-ZELLEN.
//
// Gemessen wird `zufall` gegen `saat` in den Zellen `alltag` und `rollout` — den
// beiden Zellen, in denen die umkaempfte Notiz KEINE gemeinsame Historie hat und
// beide Geraete sie unabhaengig praegen. Beide Konfliktmodi, beide Staende
// (`roh/aus` = Bestand, `semantisch/basis-signatur` = produktiv).
//
// GESCHNITTEN UEBER DIE UMGEBUNG, damit die Zellen parallel laufen koennen:
//   SPIKE_SK_SAAT = bestand | gleich | abweichend   (siehe `SaatLage`)
//   SPIKE_SK_LAGE = neustart | laufend-loeschung
// Ohne beides laeuft `bestand`/`neustart`.
//
// WELCHE LAGE WOFUER:
//   `neustart`          — Verdopplung, stiller Verlust, Divergenz, Grundtext weg.
//                         Dieselbe Lage, in der die Kalibrierungszahlen stehen.
//   `laufend-loeschung` — die WIEDERBELEBUNG geloeschter Zeilen samt kausaler
//                         Zerlegung. A laeuft die ganze Zustellphase ueber und
//                         loescht erst danach; nur so ist „kausal danach" von
//                         „nebenlaeufig" ueberhaupt trennbar.
//
// Zellbasis: die VOLLSTAENDIGEN 720 Zustellordnungen je Zelle, nichts gekuerzt.
// `sperreBis = 4` im Rollout wie in `zzRF8-zellen.spec.ts:57`.
//
// WAS NICHT VERGLEICHBAR IST, ausdruecklich: die drei Saatlagen haben
// VERSCHIEDENE Zellbasen. 'gleich' und 'abweichend' erfassen die Notiz vorab,
// 'bestand' nicht; 'abweichend' gibt B ausserdem eine Zeile mehr. Gepaart sind
// deshalb nur `zufall` gegen `saat` INNERHALB einer Saatlage — quer ueber die
// Saatlagen ist keine Spalte gepaart.

import { permutationen, type Lage, type SaatLage, type Zelle } from './lauf-rueckfall';
import type { Kennung } from './saat-kennung';
import type { SweepSchranke } from '../src/sync-handler';
import type { DiffModus } from '../src/crdt-manager';
import { messe, zeile } from './bilanz';

jest.setTimeout(7200000);

const PERMS = permutationen(6);

const SAAT_LAGE = (process.env.SPIKE_SK_SAAT ?? 'bestand') as SaatLage;
const LAGE = (process.env.SPIKE_SK_LAGE ?? 'neustart') as Lage;

const STAENDE: Array<[DiffModus, SweepSchranke]> = [
  ['roh', 'aus'],
  ['semantisch', 'basis-signatur'],
];
const ZELLEN: Zelle[] = ['alltag', 'rollout'];
const MODI: Array<'ueberschreiben' | 'kopie'> = ['ueberschreiben', 'kopie'];
const KENNUNGEN: Kennung[] = ['zufall', 'saat'];

describe(`Saat-Kennung — Zellen alltag/rollout [${SAAT_LAGE} | ${LAGE}]`, () => {
  it('misst zufall gegen saat', async () => {
    const zeilen: string[] = [];
    const werte: Array<{ name: string; z: Awaited<ReturnType<typeof messe>> }> = [];
    for (const zelle of ZELLEN) {
      for (const konfliktModus of MODI) {
        for (const [diffModus, schranke] of STAENDE) {
          for (const kennung of KENNUNGEN) {
            const z = await messe(
              {
                lage: LAGE,
                aWinnt: true,
                konfliktModus,
                schranke,
                diffModus,
                zelle,
                sperreBis: zelle === 'rollout' ? 4 : 0,
                kennung,
                saatLage: SAAT_LAGE,
              },
              PERMS
            );
            const name = `${zelle} | ${konfliktModus} | ${diffModus}/${schranke} | ${kennung}`;
            const s = zeile(name.padEnd(58), z);
            zeilen.push(s);
            werte.push({ name, z });
            // eslint-disable-next-line no-console
            console.log(s);
          }
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log(
      `\n===== SAAT · ${SAAT_LAGE} · ${LAGE} =====\n` + zeilen.join('\n') + '\n===== ENDE =====\n'
    );

    expect(werte).toHaveLength(16);
    expect(werte.every((x) => x.z.n === 720)).toBe(true);
    // GEGENPROBE, in jeder Zelle mitgefuehrt: mit 'zufall' wird nie eine
    // Saat-Kennung gepraegt; mit 'saat' wird ueberhaupt gepraegt. Ob beide
    // Geraete DIESELBE treffen, steht in der Spalte SAAT GLEICH und ist der
    // eigentliche Messwert — kein `expect`, weil genau das offen ist.
    for (const { name, z } of werte) {
      if (name.endsWith('zufall')) {
        expect([name, z.saatPraegungen]).toEqual([name, 0]);
      } else {
        expect([name, z.saatPraegungen > 0]).toEqual([name, true]);
      }
    }
  });
});
