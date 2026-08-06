// LOESEN ECHTE MARKDOWN-PRAEFIXE DENSELBEN ZERREISSEFFEKT AUS?
//
// Belegt ist bisher nur der Laborfall: `zeile-2`/`zeile-3` teilen `zeile-` (sechs
// Zeichen), `p06z02`/`p06z03` teilen `p06z0` (fuenf). `diff_main` schlaegt dann
// nicht `"zeile-2\n"` heraus, sondern `"2\nzeile-"` — UEBER die Zeilengrenze —,
// und eine fremde Einfuegung, die genau dort verankert ist, landet beim Merge
// mitten in der Nachbarzeile.
//
// Ob das eine Laborkuriositaet ist oder Alltag, entscheidet sich an ECHTEM
// Markdown: Aufzaehlungen (`- `), Ueberschriften (`## `), eingerueckte Listen
// (`  - `), Checkboxen (`- [ ] `), Zitatzeilen (`> `). Alle fuenf geben zwei
// aufeinanderfolgenden Zeilen ein gemeinsames Praefix, ohne dass der Nutzer davon
// etwas ahnt.
//
// AUFBAU: dieselbe Notizform wie `NOTIZ_KLEIN` — nur die drei mittleren Zeilen
// tragen das jeweilige Praefix. Geloescht wird die MITTLERE, B fuegt seine Zeile
// unmittelbar dahinter ein. Damit steht der fremde Anker an genau der Stelle, an
// der der Schaden im Bestand entsteht.
//
// GEGENPROBEN, ohne die keine Zahl hier traegt:
//   - Laenge 0 (`mmm…`/`nnn…`) und die nummerierte Liste (`1. `/`2. `/`3. `, die
//     sich schon im ERSTEN Zeichen unterscheidet) muessen 0 zeigen. Tun sie das
//     nicht, misst der Aufbau etwas anderes als die Nachbarschaft.
//   - Die Laengenreihe 0…6 mit synthetischem Praefix beantwortet „ab welcher
//     gemeinsamen Praefixlaenge" unabhaengig von der Markdown-Form.
//
// ZELLBASIS: die VOLLSTAENDIGEN 720 Zustellordnungen je Zelle, Modus
// `ueberschreiben`, `aWinnt=true` — wie in `zzRF2-grundtext`.

import { laufRueckfall, permutationen, NOTIZ_KLEIN, type Notiz } from './lauf-rueckfall';
import type { SweepSchranke } from '../src/sync-handler';
import type { DiffModus } from '../src/crdt-manager';
import { diff_match_patch } from 'diff-match-patch';

jest.setTimeout(3600000);

const SCHRANKE = (process.env.SPIKE_SCHRANKE as SweepSchranke | undefined) ?? 'aus';
const DIFF = (process.env.SPIKE_DIFF as DiffModus | undefined) ?? 'roh';

// Drei Zeilen mit demselben Praefix, dazwischen `kopf` und `fuss` als Rand —
// exakt die Form von `NOTIZ_KLEIN`, nur mit anderen Zeilentexten. `posA`, `posB`
// und die geloeschte Zeile liegen deshalb an denselben Indizes wie dort: A setzt
// AAA hinter `kopf`, B setzt BBB zwischen die zweite und die dritte Zeile, und
// geloescht wird die zweite.
function notizMitPraefix(praefix: string, worte = ['apfel', 'birne', 'kirsche']): Notiz {
  const zeilen = worte.map((w) => `${praefix}${w}`);
  const basis = `kopf\n${zeilen.join('\n')}\nfuss\n`;
  return {
    basis,
    gemeinsam: basis.replace('fuss\n', 'gemeinsam\nfuss\n'),
    posA: 1,
    posB: 3,
    posOffline: 1,
    geloescht: [zeilen[1]],
  };
}

// Dieselbe Form, aber jede Zeile bekommt ihr EIGENES Praefix — fuer die
// nummerierte Liste, in der sich schon das erste Zeichen unterscheidet.
function notizMitPraefixen(praefixe: string[], worte: string[]): Notiz {
  const zeilen = praefixe.map((p, i) => `${p}${worte[i]}`);
  const basis = `kopf\n${zeilen.join('\n')}\nfuss\n`;
  return {
    basis,
    gemeinsam: basis.replace('fuss\n', 'gemeinsam\nfuss\n'),
    posA: 1,
    posB: 3,
    posOffline: 1,
    geloescht: [zeilen[1]],
  };
}

// Die gemeinsame Praefixlaenge der GELOESCHTEN Zeile und ihrer NACHFOLGERIN —
// gerechnet, nicht behauptet. Genau diese Laenge bestimmt, wie weit der Delete
// ueber die Zeilengrenze hinausreicht.
function lcp(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

interface Zelle {
  n: number;
  weg: number; // altes Mass (`occ`)
  ganzWeg: number; // strenges Mass
  loeschungDurch: number;
  doppel: number;
  ganzDoppel: number; // strenges Mass: Grundzeile steht MEHRFACH da
  divergenz: number;
  stillVerloren: number;
  diffGeaendert: number;
}

async function messe(notiz: Notiz): Promise<Zelle> {
  const z: Zelle = {
    n: 0,
    weg: 0,
    ganzWeg: 0,
    loeschungDurch: 0,
    doppel: 0,
    ganzDoppel: 0,
    divergenz: 0,
    stillVerloren: 0,
    diffGeaendert: 0,
  };
  for (const reihenfolge of permutationen(6)) {
    const e = await laufRueckfall({
      lage: 'neustart-offline-loeschung',
      reihenfolge,
      aWinnt: true,
      konfliktModus: 'ueberschreiben',
      schranke: SCHRANKE,
      diffModus: DIFF,
      notiz,
    });
    z.n++;
    if (!e.grundtextDa) z.weg++;
    if (!e.grundtextGanzDa) z.ganzWeg++;
    if (e.eingriffDurch) z.loeschungDurch++;
    if (e.befund.doppel.length > 0) z.doppel++;
    if (e.ganzDoppelt.length > 0) z.ganzDoppel++;
    if (e.befund.divergenz) z.divergenz++;
    if (e.stillVerloren.length > 0) z.stillVerloren++;
    z.diffGeaendert += e.diffGeaendert;
  }
  return z;
}

// Der ROHE Zeichen-Diff der Loeschung, ohne Harness: reicht das geloeschte Stueck
// ueber die Zeilengrenze? Das ist die Vorhersage, die die Harness-Zahl daneben
// bestaetigen oder widerlegen muss.
function delStueck(notiz: Notiz): string {
  const dmp = new diff_match_patch();
  const vorher = notiz.gemeinsam;
  const nachher = vorher
    .split('\n')
    .filter((z) => !notiz.geloescht.includes(z))
    .join('\n');
  const d = dmp.diff_main(vorher, nachher);
  if (DIFF === 'semantisch') dmp.diff_cleanupSemantic(d);
  return d
    .filter(([op]) => op === -1)
    .map(([, t]) => t)
    .join('|');
}

function zeile(name: string, notiz: Notiz, z: Zelle): string {
  const g = notiz.geloescht[0];
  const zeilen = notiz.basis.split('\n');
  const nachfolger = zeilen[zeilen.indexOf(g) + 1];
  return (
    `${name.padEnd(22)} | Praefix ${String(lcp(g, nachfolger)).padStart(2)} | ` +
    `n=${z.n} | GRUNDTEXT WEG ${String(z.weg).padStart(3)} ` +
    `(ganz ${String(z.ganzWeg).padStart(3)}) | ` +
    `LOESCHUNG DURCH ${String(z.loeschungDurch).padStart(3)} | ` +
    `doppelt ${String(z.doppel).padStart(3)} ` +
    `(ganz ${String(z.ganzDoppel).padStart(3)}) | ` +
    `divergent ${String(z.divergenz).padStart(3)} | ` +
    `still verloren ${String(z.stillVerloren).padStart(3)} | ` +
    `diff-geaendert ${String(z.diffGeaendert).padStart(5)} | ` +
    `DEL ${JSON.stringify(delStueck(notiz))}`
  );
}

describe('Zerreisst der Zeichen-Diff auch an echten Markdown-Praefixen', () => {
  it('misst fuenf Markdown-Formen', async () => {
    const faelle: Array<[string, Notiz]> = [
      ['Bestand zeile-N', NOTIZ_KLEIN],
      ['Aufzaehlung "- "', notizMitPraefix('- ')],
      ['Ueberschrift "## "', notizMitPraefix('## ')],
      ['eingerueckt "  - "', notizMitPraefix('  - ')],
      ['Checkbox "- [ ] "', notizMitPraefix('- [ ] ')],
      ['Zitat "> "', notizMitPraefix('> ')],
      // GEGENPROBE aus echtem Markdown: nummerierte Liste. Die Zeilen
      // unterscheiden sich im ERSTEN Zeichen — gemeinsames Praefix 0.
      [
        'nummeriert "1. "',
        notizMitPraefixen(['1. ', '2. ', '3. '], ['apfel', 'birne', 'kirsche']),
      ],
    ];
    const raus: string[] = [];
    for (const [name, notiz] of faelle) {
      const z = await messe(notiz);
      const s = zeile(name, notiz, z);
      raus.push(s);
      // eslint-disable-next-line no-console
      console.log(s);
    }
    // eslint-disable-next-line no-console
    console.log(
      `\n===== MARKDOWN-PRAEFIXE (Schranke: ${SCHRANKE}, Diff: ${DIFF}) =====\n` +
        raus.join('\n')
    );
    expect(raus).toHaveLength(faelle.length);
  });

  it('faehrt die Praefixlaenge von 0 bis 6 durch', async () => {
    const raus: string[] = [];
    for (let len = 0; len <= 6; len++) {
      const p = 'x'.repeat(len);
      // Die Woerter unterscheiden sich ab dem ERSTEN Zeichen nach dem Praefix —
      // damit ist die gemeinsame Laenge exakt `len` und nicht mehr.
      const notiz = notizMitPraefix(p, ['aaa-eins', 'mmm-zwei', 'nnn-drei']);
      const z = await messe(notiz);
      const s = zeile(`Laenge ${len}`, notiz, z);
      raus.push(s);
      // eslint-disable-next-line no-console
      console.log(s);
    }
    // eslint-disable-next-line no-console
    console.log(
      `\n===== PRAEFIXLAENGE (Schranke: ${SCHRANKE}, Diff: ${DIFF}) =====\n` + raus.join('\n')
    );
    expect(raus).toHaveLength(7);
  });
});
