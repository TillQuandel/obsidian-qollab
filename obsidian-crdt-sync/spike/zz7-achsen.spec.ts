// TEIL 7 — die drei Achsen, die das Werkzeug bisher nicht abbildete.
//
//   K  Kalibrierung: `laufN` bei N=2 / M=1 muss ZAHLENGLEICH zu `lauf` sein.
//      Ausserdem: `uhrModus 'alle'` darf bei einer einzigen umkaempften Notiz
//      nichts aendern — sonst ist die Uhr selbst ein Stoerfaktor und Achse B
//      nicht mehr auf die zweite Notiz zurueckzufuehren.
//   A  drei Geraete statt zwei.
//   B  drei umkaempfte Notizen gleichzeitig, Frist-Uhr ueber ALLE Pfade.
//   C  Geraet B ist die ganze Zustellphase weg und kommt danach mit allem
//      auf einmal zurueck.
//
// Jede Achse misst IMMER auch die Basiszelle (N=2, M=1, kein Ausfall) mit
// DERSELBEN Stichprobe. Sonst waere der Vergleich „neue Achse gegen alte Zahl"
// ein Vergleich zweier verschiedener Stichproben.

import { lauf, permutationen, type Szenario, type Editfall } from './lauf';
import { laufN, alsN, stichprobe, type KonfigN, type FabrikN } from './lauf-n';
import { guidQuelleAus } from './guid-quelle';
import { heute, parken } from './politiken';

const MODUS = (process.env.SPIKE_MODUS as 'kopie' | 'ohne') ?? 'kopie';
const S = Number(process.env.SPIKE_STICHPROBE ?? 60);
// Nur fuer die Gegenprobe: Laenge der Ruhephase. Bleibt eine gemessene
// Divergenz auch bei dreifacher Ruhephase stehen, ist sie keine unfertige
// Zustellung, sondern ein echter Endzustand.
const RUNDEN = Number(process.env.SPIKE_RUNDEN ?? 8);
const SZENARIEN: Szenario[] = ['geteilt', 'rollout', 'alltag'];
const EDITFAELLE: Editfall[] = ['nurA', 'nurB', 'beide'];

const varianten: Array<[string, FabrikN]> = [
  ['heute', alsN(heute)],
  ['parken-4', alsN(parken(4))],
];

jest.setTimeout(3600000);

interface Zelle {
  n: number;
  div: number;
  verlust: number;
  still: number;
  doppel: number;
  sauber: number;
  entkopp: number;
  park: number;
  nachtr: number;
  aufl: number;
  frist: number;
  eeeFehlt: number;
  eeeWeg: number;
}
const leer = (): Zelle => ({
  n: 0,
  div: 0,
  verlust: 0,
  still: 0,
  doppel: 0,
  sauber: 0,
  entkopp: 0,
  park: 0,
  nachtr: 0,
  aufl: 0,
  frist: 0,
  eeeFehlt: 0,
  eeeWeg: 0,
});

function p(x: number, n: number): string {
  return `${String(x).padStart(4)} (${((100 * x) / n).toFixed(1).padStart(5)}%)`;
}

function zeile(name: string, z: Zelle, externEdit: boolean): string {
  return (
    `${name.padEnd(26)} n=${String(z.n).padStart(4)} | DIV ${p(z.div, z.n)} | VERLUST ${p(
      z.verlust,
      z.n
    )} | still ${p(z.still, z.n)} | DOPPEL ${p(z.doppel, z.n)} | sauber ${p(
      z.sauber,
      z.n
    )} | entkopp ${p(z.entkopp, z.n)}` +
    (externEdit ? ` | EEE-fehlt ${p(z.eeeFehlt, z.n)} EEE-weg ${p(z.eeeWeg, z.n)}` : '') +
    ` | park ${z.park} nachtr ${z.nachtr} (aufl ${z.aufl} / frist ${z.frist})`
  );
}

// Ein Messblock: eine Konfiguration, eine Variante, ueber alle Editfaelle,
// Zustellreihenfolgen der Stichprobe und beide Tie-Break-Richtungen.
async function miss(
  konfig: Partial<KonfigN>,
  ereignisse: number,
  fabrik: FabrikN,
  szenario: Szenario,
  externEdit: boolean,
  proben: number
): Promise<Zelle> {
  const z = leer();
  const perms = stichprobe(ereignisse, proben);
  for (const editfall of EDITFAELLE) {
    for (const reihenfolge of perms) {
      for (const aWinnt of [true, false]) {
        const e = await laufN(
          {
            szenario,
            editfall,
            reihenfolge,
            aWinnt,
            konfliktModus: MODUS,
            sperreBis: szenario === 'rollout' ? 4 : 0,
            externEdit,
            uhrModus: 'alle',
            runden: RUNDEN,
            ...konfig,
          },
          fabrik
        );
        z.n++;
        if (e.divergenz) z.div++;
        if (e.verlust.length > 0) z.verlust++;
        if (e.stillVerloren.length > 0) z.still++;
        if (e.doppel.length > 0) z.doppel++;
        if (e.sauber) z.sauber++;
        if (e.entkoppelt) z.entkopp++;
        z.park += e.parkungen;
        z.nachtr += e.nachtraege;
        z.aufl += e.aufloesungen;
        z.frist += e.fristNachtraege;
        if (externEdit && e.verlust.some((t) => t.startsWith('EEE'))) z.eeeFehlt++;
        if (externEdit && e.stillVerloren.some((t) => t.startsWith('EEE'))) z.eeeWeg++;
      }
    }
  }
  return z;
}

// Eine Achse: Basiszelle gegen neue Zelle, `heute` gegen `parken-4`,
// alle drei Szenarien, mit und ohne externen Schreiber.
async function achse(
  titel: string,
  zellen: Array<[string, Partial<KonfigN>, number]>
): Promise<void> {
  for (const szenario of SZENARIEN) {
    for (const externEdit of [false, true]) {
      const zeilen: string[] = [];
      for (const [zname, konfig, ereignisse] of zellen) {
        for (const [vname, fabrik] of varianten) {
          const z = await miss(konfig, ereignisse, fabrik, szenario, externEdit, S);
          zeilen.push(zeile(`${zname} / ${vname}`, z, externEdit));
        }
      }
      // eslint-disable-next-line no-console
      console.log(
        `\n===== ${titel} | ${szenario} / ${MODUS} / externer Editor ${
          externEdit ? 'JA' : 'nein'
        } | Stichprobe ${S} Reihenfolgen =====\n${zeilen.join('\n')}\n`
      );
    }
  }
}

describe(`Achsen (${MODUS}, Stichprobe ${S})`, () => {
  afterAll(() => guidQuelleAus());

  it('K-kalibrierung', async () => {
    const PERMS = permutationen(6);
    const SCHRITT = Number(process.env.SPIKE_PERM_SCHRITT ?? 6);
    const zeilen: string[] = [];
    let abweichungen = 0;
    for (const [vname, fab2] of [
      ['heute', heute],
      ['parken-4', parken(4)],
    ] as const) {
      const alt = leer();
      const neuEine = leer();
      const neuAlle = leer();
      for (const editfall of EDITFAELLE) {
        for (let pi = 0; pi < PERMS.length; pi += SCHRITT) {
          for (const aWinnt of [true, false]) {
            const gemein = {
              szenario: 'geteilt' as Szenario,
              editfall,
              reihenfolge: PERMS[pi],
              aWinnt,
              konfliktModus: MODUS,
              sperreBis: 0,
              externEdit: false,
            };
            const e0 = await lauf(gemein, fab2);
            const e1 = await laufN({ ...gemein, uhrModus: 'eine' }, alsN(fab2));
            const e2 = await laufN({ ...gemein, uhrModus: 'alle' }, alsN(fab2));
            for (const [z, e] of [
              [alt, { ...e0.befund, stillVerloren: e0.stillVerloren, entkoppelt: e0.entkoppelt, parkungen: e0.parkungen, nachtraege: e0.nachtraege }],
              [neuEine, e1],
              [neuAlle, e2],
            ] as Array<[Zelle, any]>) {
              z.n++;
              if (e.divergenz) z.div++;
              if (e.verlust.length > 0) z.verlust++;
              if (e.stillVerloren.length > 0) z.still++;
              if (e.doppel.length > 0) z.doppel++;
              if (e.sauber) z.sauber++;
              if (e.entkoppelt) z.entkopp++;
              z.park += e.parkungen;
              z.nachtr += e.nachtraege;
            }
          }
        }
      }
      for (const [n, z] of [
        ['lauf.ts (Bestand)', alt],
        ['laufN uhr=eine', neuEine],
        ['laufN uhr=alle', neuAlle],
      ] as Array<[string, Zelle]>) {
        zeilen.push(zeile(`${vname} / ${n}`, z, false));
      }
      for (const feld of ['div', 'verlust', 'still', 'doppel', 'sauber', 'entkopp', 'park', 'nachtr'] as Array<keyof Zelle>) {
        if (alt[feld] !== neuEine[feld] || alt[feld] !== neuAlle[feld]) abweichungen++;
      }
    }
    // eslint-disable-next-line no-console
    console.log(`\n===== KALIBRIERUNG geteilt / ${MODUS} =====\n${zeilen.join('\n')}\n`);
    expect(abweichungen).toBe(0);
  });

  it('A-drei-geraete', async () => {
    await achse('ACHSE A — Geraetezahl', [
      ['N=2 (Basis)', { geraete: 2, notizen: 1 }, 6],
      ['N=3', { geraete: 3, notizen: 1 }, 9],
    ]);
    expect(true).toBe(true);
  });

  it('B-drei-notizen', async () => {
    await achse('ACHSE B — umkaempfte Notizen', [
      ['M=1 (Basis)', { geraete: 2, notizen: 1 }, 6],
      ['M=3', { geraete: 2, notizen: 3 }, 10],
    ]);
    expect(true).toBe(true);
  });

  it('C-langer-ausfall', async () => {
    await achse('ACHSE C — langer Ausfall von B', [
      ['ohne Ausfall (Basis)', { geraete: 2, notizen: 1 }, 6],
      ['B offline (Zustellphase)', { geraete: 2, notizen: 1, offline: [1] }, 6],
    ]);
    expect(true).toBe(true);
  });
});
