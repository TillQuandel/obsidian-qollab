// DIE ATOMARE ZUSTELLUNG — TEIL 2: DIE ZELLEN `alltag` UND `rollout`.
//
// HIER LIEGT DER ERSTKONTAKT. In `geteilt` hat die umkaempfte Note bereits eine
// gemeinsame Historie — es gibt gar keinen Praegemoment. In `alltag` und
// `rollout` haben die Geraete KEINE gemeinsame Inkarnation der Note; genau diese
// Zellen tragen laut `produktziel.md` (aufgeloester Widerspruch 2) die
// Wiederbelebungsrate von 53–83 %.
//
// DIE FRAGE DIESER DATEI, und sie ist die haertere von beiden: Aendert
// Atomaritaet daran ueberhaupt etwas? Zwei Geraete, die dieselbe Notiz
// unabhaengig anlegen, haben auch bei atomarer Zustellung keine gemeinsame
// Inkarnation — die gemeinsame Historie entsteht nicht dadurch, dass die Dateien
// zusammen reisen, sondern dadurch, dass eine Seite die Inkarnation der anderen
// uebernimmt. Faellt die Wiederbelebung hier NICHT, ist das ein vollwertiges
// Ergebnis und kein Messfehler.
//
// ACHTUNG BEIM LESEN (uebernommen aus `zzRF8-zellen.spec.ts`): In `rollout` und
// `alltag` kann `ensureDoc` ADOPTIEREN, und die Schranke wird nur bei `!adopted`
// befragt. Eine Null in der Spalte GREIFT heisst dort „nie gefragt", nicht
// „harmlos".
//
// Zellbasis: die VOLLSTAENDIGEN 720 Zustellordnungen je Zelle, nichts gekuerzt.
// `sperreBis = 4` im Rollout wie in `zzRF8-zellen.spec.ts:57`.

import { permutationen, type Lage, type Transport, type Zelle } from './lauf-rueckfall';
import type { SweepSchranke } from '../src/sync-handler';
import type { DiffModus } from '../src/crdt-manager';
import { messe, zeile } from './bilanz';

jest.setTimeout(7200000);

const PERMS = permutationen(6);

const STAENDE: Array<[DiffModus, SweepSchranke]> = [
  ['roh', 'aus'],
  ['semantisch', 'basis-signatur'],
];
const TRANSPORTE: Transport[] = ['datei', 'atomar'];
const ZELLEN: Zelle[] = ['alltag', 'rollout'];

async function tabelle(
  lage: Lage,
  transporte: Transport[] = TRANSPORTE
): Promise<Array<{ name: string; s: string; z: Awaited<ReturnType<typeof messe>> }>> {
  const aus: Array<{ name: string; s: string; z: Awaited<ReturnType<typeof messe>> }> = [];
  for (const zelle of ZELLEN) {
    for (const [diffModus, schranke] of STAENDE) {
      for (const transport of transporte) {
        const z = await messe(
          {
            lage,
            aWinnt: true,
            konfliktModus: 'ueberschreiben',
            schranke,
            diffModus,
            zelle,
            sperreBis: zelle === 'rollout' ? 4 : 0,
            transport,
          },
          PERMS
        );
        const name = `${zelle} | ${diffModus}/${schranke} | ${transport}`;
        const s = zeile(name, z);
        aus.push({ name, s, z });
        // eslint-disable-next-line no-console
        console.log(s);
      }
    }
  }
  return aus;
}

describe('Atomare Zustellung — Zellen alltag und rollout', () => {
  it('misst die Lage neustart in beiden Zellen', async () => {
    const r = await tabelle('neustart');
    // eslint-disable-next-line no-console
    console.log('\n===== ATOMAR · ZELLEN · neustart =====\n' + r.map((x) => x.s).join('\n'));

    // KALIBRIERUNG gegen `herkunft-2026-08-07.md` §6a·C. Weicht eine dieser
    // Zahlen ab, ist der Umbau kaputt.
    const soll: Array<[string, number, number]> = [
      ['alltag | roh/aus | datei', 240, 94],
      ['alltag | semantisch/basis-signatur | datei', 60, 22],
      ['rollout | roh/aus | datei', 240, 68],
      ['rollout | semantisch/basis-signatur | datei', 60, 16],
    ];
    for (const [name, still, doppelt] of soll) {
      const z = r.find((x) => x.name === name)!.z;
      expect([name, z.n, z.stillVerloren, z.doppel]).toEqual([name, 720, still, doppelt]);
    }

    // GEGENPROBE.
    expect(r.filter((x) => x.name.endsWith('atomar')).every((x) => x.z.notizOhneNachweis === 0)).toBe(
      true
    );
    expect(r.filter((x) => x.name.endsWith('datei')).every((x) => x.z.notizOhneNachweis > 0)).toBe(
      true
    );
  });

  it('misst die Loeschung im laufenden Betrieb in beiden Zellen', async () => {
    const r = await tabelle('laufend-loeschung');
    // eslint-disable-next-line no-console
    console.log(
      '\n===== ATOMAR · ZELLEN · laufend-loeschung =====\n' + r.map((x) => x.s).join('\n')
    );
    expect(r).toHaveLength(8);
    expect(r.every((x) => x.z.loeschLauf === 720)).toBe(true);
  });

  // DER KONTROLLARM ZUR WIEDERBELEBUNG. Faellt die Rate unter 'atomar', koennte
  // das schlicht daran liegen, dass dort MEHR zugestellt wird (A zieht sein Paket
  // zweimal). 'atomar-einmal' zieht je Geraet nur EIN Paket — weniger als der
  // Bestand. Bleibt die Rate auch dort unten, haengt sie an der Atomaritaet.
  //
  // ZELLBASIS AUSDRUECKLICH ANDERS: 720 Laeufe, aber nur 24 verschiedene
  // Zustellordnungen (je 30-mal). Nicht mit den anderen Armen gepaart.
  it('Kontrollarm: nur EIN Paket je Geraet, beide Lagen', async () => {
    const r = [
      ...(await tabelle('neustart', ['atomar-einmal'])),
      ...(await tabelle('laufend-loeschung', ['atomar-einmal'])),
    ];
    // eslint-disable-next-line no-console
    console.log(
      '\n===== ATOMAR · ZELLEN · KONTROLLARM =====\n' + r.map((x) => x.s).join('\n')
    );
    expect(r).toHaveLength(8);
    expect(r.every((x) => x.z.notizOhneNachweis === 0)).toBe(true);
  });
});
