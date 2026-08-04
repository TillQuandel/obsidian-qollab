// TEIL 9 — WOHER kommt die Verdopplung? Der Detektor aus Task 18, nachgebaut und
// auf den heutigen Stand (`fix/erstkontakt-parken`) angesetzt.
//
// Reihenfolge ist Absicht:
//   V  VALIDIERUNG gegen bekannte Fehler. Faellt sie, gilt keine Zahl darunter.
//   D  Zuordnung: welche Codestelle GEBIERT die Duplikate, in drei Lastzellen.
//   N  Kandidat 1 aus dem Folgeprompt: haengt die Verdopplung am Nachtrag?
//      Kreuztabelle Lauf-fuer-Lauf, nicht Summenkorrelation.

import * as Y from 'yjs';
import { CrdtManager } from '../src/crdt-manager';
import { laufN, alsN, stichprobe, type KonfigN } from './lauf-n';
import type { Szenario, Editfall } from './lauf';
import { guidQuelleAus } from './guid-quelle';
import { parken, heute } from './politiken';
import {
  detektorAn,
  detektorAus,
  detektorInstallieren,
  durchlaeufe,
  zaehlerZuruecksetzen,
  verdichte,
  type Ereignis,
} from './detektor';
import { occ } from './invarianten';

detektorInstallieren();

const MODUS = (process.env.SPIKE_MODUS as 'kopie' | 'ohne') ?? 'kopie';
const S = Number(process.env.SPIKE_DET_STICHPROBE ?? 12);
const SZENARIEN: Szenario[] = ['geteilt', 'rollout', 'alltag'];
const EDITFAELLE: Editfall[] = ['nurA', 'nurB', 'beide'];

function tokenListe(m: number): string[] {
  const basis = ['AAA', 'BBB', 'CCC', 'DDD', 'EEE'];
  if (m === 1) return basis;
  // `occ` zaehlt ein Token nur, wenn KEINE Ziffer folgt — 'AAA' und 'AAA1' sind
  // damit sauber getrennt und koennen gemeinsam in der Liste stehen.
  return basis.flatMap((b) => Array.from({ length: m }, (_, i) => `${b}${i + 1}`));
}

jest.setTimeout(3600000);

describe(`Detektor (${MODUS})`, () => {
  afterAll(() => guidQuelleAus());

  // ---- V: das Instrument gegen bekannte Fehler ----------------------------
  it('V-validierung', () => {
    // V1 — BEKANNTER FEHLER, bekannte Stelle: zwei Docs materialisieren
    // denselben Text unabhaengig. Yjs dedupliziert nach Item-ID, nicht nach
    // Inhalt; `applyUpdate` MUSS hier als Geburtsort erscheinen.
    const a = new CrdtManager();
    const b = new CrdtManager();
    a.setContent('n.md', 'kopf\nSEED\n');
    b.setContent('n.md', 'kopf\nSEED\n');
    detektorAn(['SEED']);
    zaehlerZuruecksetzen();
    a.applyUpdate('n.md', b.encodeState('n.md'));
    const v1 = detektorAus();
    expect(occ(a.getContent('n.md'), 'SEED')).toBe(2); // der Fehler ist echt
    const g1 = v1.filter((e) => e.art === 'geburt');
    expect(g1.length).toBe(1);
    expect(g1[0].funktion).toBe('applyUpdate');

    // V2 — NEGATIVKONTROLLE: derselbe Aufruf, aber das Duplikat steht bereits
    // beim Absender. Der Detektor darf das NICHT als Geburt melden, sonst
    // meldet er jede Weiterreichung als Quelle.
    const c = new CrdtManager();
    const d = new CrdtManager();
    d.setContent('n.md', 'kopf\nSEED\nSEED\n');
    detektorAn(['SEED']);
    c.applyUpdate('n.md', d.encodeState('n.md'));
    const v2 = detektorAus();
    expect(occ(c.getContent('n.md'), 'SEED')).toBe(2);
    expect(v2.filter((e) => e.art === 'geburt').length).toBe(0);
    expect(v2.filter((e) => e.art === 'traeger').length).toBe(1);

    // V3 — die zweite bekannte Quelle: `unionMerge` bei UMSORTIERTEN Zeilen
    // (K1 aus Task 18). Ohne gemeinsamen Vorfahren ist Umsortieren nicht von
    // Loeschen+Einfuegen zu unterscheiden.
    const { unionMerge } = require('../src/text-merge');
    detektorAn(['SEED']);
    const r3 = unionMerge('SEED\nx\ny\n', 'x\ny\nSEED\n');
    const v3 = detektorAus();
    if (occ(r3, 'SEED') > 1) {
      expect(v3.filter((e) => e.art === 'geburt' && e.funktion === 'unionMerge').length).toBe(1);
    }

    // V4 — DECKUNG am direkten Aufruf. Sagt nur, dass das Modulobjekt
    // beschreibbar ist — NICHT, dass `sync-handler` den Patch sieht.
    expect(durchlaeufe.applyUpdate).toBeGreaterThan(0);
    expect(durchlaeufe.setContent).toBeGreaterThan(0);
    expect(durchlaeufe.unionMerge).toBeGreaterThan(0);
  });

  // V5 — DIE EIGENTLICHE DECKUNGSPRUEFUNG: greift die Umhuellung im ECHTEN
  // Treiber? `sync-handler` importiert `unionMerge` als ES-Import; ob die
  // Zuweisung auf das Modulobjekt dort ankommt, entscheidet sich erst im Lauf.
  // Steht danach ein Zaehler auf 0, ist diese Funktion blind und keine ihrer
  // Zahlen gilt — genau der Fehler, an dem am 2026-08-03 vier von sieben
  // Instrumenten gescheitert sind.
  it('V5-deckung-im-treiber', async () => {
    zaehlerZuruecksetzen();
    detektorAn(['AAA', 'BBB']);
    for (const aWinnt of [true, false]) {
      await laufN(
        {
          szenario: 'geteilt',
          editfall: 'beide',
          reihenfolge: [0, 1, 2, 3, 4, 5],
          aWinnt,
          konfliktModus: MODUS,
          sperreBis: 0,
          externEdit: false,
          uhrModus: 'alle',
          geraete: 2,
          notizen: 1,
        },
        alsN(parken(4))
      );
    }
    detektorAus();
    // eslint-disable-next-line no-console
    console.log(`\n===== V5 DECKUNG im Treiber =====\n  ${JSON.stringify(durchlaeufe)}\n`);
    expect(durchlaeufe.applyUpdate).toBeGreaterThan(0);
    expect(durchlaeufe.setContent).toBeGreaterThan(0);
    expect(durchlaeufe.unionMerge).toBeGreaterThan(0);
    expect(durchlaeufe.threeWayMerge).toBeGreaterThan(0);
  });

  // ---- D + N: Zuordnung und Nachtrag-Kreuztabelle -------------------------
  it('D-zuordnung', async () => {
    const zellen: Array<[string, Partial<KonfigN>, number]> = [
      ['N=2 / M=1', { geraete: 2, notizen: 1 }, 6],
      ['N=3 / M=1', { geraete: 3, notizen: 1 }, 9],
      ['N=2 / M=3', { geraete: 2, notizen: 3 }, 10],
    ];
    const varianten = [
      ['parken-4', alsN(parken(4))],
      ['heute', alsN(heute)],
    ] as const;

    for (const [vname, fabrik] of varianten) {
      for (const [zname, konfig, ereigniszahl] of zellen) {
        const gesamt: Ereignis[] = [];
        // Kreuztabelle fuer Kandidat 1, Lauf fuer Lauf.
        const kreuz = { dopMitFrist: 0, dopOhneFrist: 0, okMitFrist: 0, okOhneFrist: 0 };
        let n = 0;
        let doppelLaeufe = 0;
        let verlustLaeufe = 0;
        let divLaeufe = 0;
        const tk = tokenListe(konfig.notizen ?? 1);
        const perms = stichprobe(ereigniszahl, S);
        for (const szenario of SZENARIEN) {
          for (const editfall of EDITFAELLE) {
            for (const reihenfolge of perms) {
              for (const aWinnt of [true, false]) {
                detektorAn(tk);
                const e = await laufN(
                  {
                    szenario,
                    editfall,
                    reihenfolge,
                    aWinnt,
                    konfliktModus: MODUS,
                    sperreBis: szenario === 'rollout' ? 4 : 0,
                    externEdit: false,
                    uhrModus: 'alle',
                    ...konfig,
                  },
                  fabrik
                );
                const ev = detektorAus();
                n++;
                const hatDoppel = e.doppel.length > 0;
                if (hatDoppel) {
                  doppelLaeufe++;
                  gesamt.push(...ev);
                }
                if (e.verlust.length > 0) verlustLaeufe++;
                if (e.divergenz) divLaeufe++;
                const mitFrist = e.fristNachtraege > 0;
                if (hatDoppel && mitFrist) kreuz.dopMitFrist++;
                else if (hatDoppel) kreuz.dopOhneFrist++;
                else if (mitFrist) kreuz.okMitFrist++;
                else kreuz.okOhneFrist++;
              }
            }
          }
        }
        const v = verdichte(gesamt.filter((x) => x.art === 'geburt'));
        const zeilen = [...v.entries()]
          .sort((x, y) => y[1].geburt - x[1].geburt)
          .map(([k, w]) => `    ${String(w.geburt).padStart(5)}  ${k}`);
        const traeger = gesamt.filter((x) => x.art === 'traeger').length;
        // eslint-disable-next-line no-console
        console.log(
          `\n===== ${vname} | ${zname} | ${MODUS} | n=${n} (${S} Reihenfolgen x 3 Szenarien x 3 Editfaelle x 2 Tie-Break) =====\n` +
            `  DOPPEL ${doppelLaeufe} (${((100 * doppelLaeufe) / n).toFixed(1)}%)  ` +
            `VERLUST ${verlustLaeufe} (${((100 * verlustLaeufe) / n).toFixed(1)}%)  ` +
            `DIV ${divLaeufe} (${((100 * divLaeufe) / n).toFixed(1)}%)\n` +
            `  GEBURTSORTE (nur Laeufe mit Verdopplung; Traeger-Ereignisse: ${traeger}):\n` +
            (zeilen.length > 0 ? zeilen.join('\n') : '    (keine)') +
            `\n  KANDIDAT 1 — Frist-Nachtrag x Verdopplung:\n` +
            `    DOPPEL & Frist-Nachtrag : ${kreuz.dopMitFrist}\n` +
            `    DOPPEL ohne Nachtrag    : ${kreuz.dopOhneFrist}\n` +
            `    sauber & Frist-Nachtrag : ${kreuz.okMitFrist}\n` +
            `    sauber ohne Nachtrag    : ${kreuz.okOhneFrist}\n`
        );
      }
    }
    expect(true).toBe(true);
  });
});
