// WO GEHT DER GRUNDTEXT VERLOREN?
//
// Die Messung `zzRF-rueckfall` meldet in der Lage 'neustart-offline-loeschung'
// `GRUNDTEXT WEG` in einem Teil der Laeufe — und zwar schon bei ausgeschaltetem
// Schalter. Die absichtlich geloeschte Zeile ist dabei ausgenommen; es geht also
// um eine ANDERE Zeile, die niemand angefasst hat. Das trifft das
// K.o.-Kriterium des Produkts.
//
// Diese Datei misst nichts Neues — sie VERORTET denselben Befund:
//   1. WELCHE Zeile fehlt, und auf welchem Geraet.
//   2. In WELCHEM Schritt sie zuerst fehlt (Zustellung, Eingriff, Neustart,
//      Sweep, erster Poll, Ruhephase).
//   3. VARIATION: haengt die Rate an der geloeschten Zeile und ihrer Nachbar-
//      schaft, oder ist sie ein allgemeiner Verlustweg?
//   4. GEGENPROBE: bleibt der Verlust ohne den Sweep?
//
// Zellbasis wie in `zzRF-rueckfall`: die VOLLSTAENDIGEN 720 Zustellordnungen.

import {
  laufRueckfall,
  permutationen,
  NOTIZ_KLEIN,
  type Notiz,
  type Konfig,
} from './lauf-rueckfall';
import type { SweepSchranke } from '../src/sync-handler';
import * as Y from 'yjs';
import { diff_match_patch } from 'diff-match-patch';

jest.setTimeout(3600000);

const SCHRANKE = (process.env.SPIKE_SCHRANKE as SweepSchranke | undefined) ?? 'aus';
const LAGE = 'neustart-offline-loeschung' as const;

interface Verortung {
  n: number;
  weg: number; // Laeufe mit fehlender Grundzeile am Ende (`occ`, das alte Mass)
  ganzWeg: number; // dito, aber „steht nicht mehr als GANZE Zeile da"
  // DER PREIS. Ohne diese Spalte liest sich jede Null bei `weg` als Gewinn — auch
  // dann, wenn sie nur dadurch entsteht, dass die Loeschung des Nutzers gar nicht
  // erst ankommt.
  eingriffDurch: number;
  nurA: number;
  nurB: number;
  beide: number;
  // Welche Zeile fehlt am Ende, wie oft — Schluessel `Zeile@Geraet`.
  zeilen: Map<string, number>;
  // In welchem Schritt fehlt zum ERSTEN Mal eine Grundzeile (strenges Mass).
  ersterSchritt: Map<string, number>;
  // Auf welchem Geraet fehlte sie in genau diesem ersten Schritt.
  erstesGeraet: Map<string, number>;
  // KREUZTABELLE: gegen welche Eigenschaft der Zustellordnung laeuft der
  // Verlust? Ohne sie waere „296 von 720" eine Zahl ohne Bedingung.
  kreuz: Map<string, number>;
  // Die ersten paar Ordnungen mit Befund — zum Nachfahren im Einzelfall.
  beispiele: string[];
}

function leer(): Verortung {
  return {
    n: 0,
    weg: 0,
    ganzWeg: 0,
    eingriffDurch: 0,
    nurA: 0,
    nurB: 0,
    beide: 0,
    zeilen: new Map(),
    ersterSchritt: new Map(),
    erstesGeraet: new Map(),
    kreuz: new Map(),
    beispiele: [],
  };
}

function zaehl(m: Map<string, number>, k: string): void {
  m.set(k, (m.get(k) ?? 0) + 1);
}

function tafel(m: Map<string, number>): string {
  return [...m.entries()]
    .sort((x, y) => y[1] - x[1])
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
}

async function verorte(zusatz: Partial<Konfig>, notiz?: Notiz): Promise<Verortung> {
  const v = leer();
  for (const reihenfolge of permutationen(6)) {
    const e = await laufRueckfall({
      lage: LAGE,
      reihenfolge,
      aWinnt: true,
      konfliktModus: 'ueberschreiben',
      schranke: SCHRANKE,
      spur: true,
      notiz,
      ...zusatz,
    });
    v.n++;
    zaehl(
      v.kreuz,
      `${e.grundtextGanzDa ? 'heil' : 'WEG'}+${e.beweisDa ? 'beweis' : 'ohne'}` +
        `+${e.aUeberschrieben ? 'ueberschr' : 'unberuehrt'}`
    );
    if (e.eingriffDurch) v.eingriffDurch++;
    if (!e.grundtextGanzDa) v.ganzWeg++;
    if (e.grundtextDa) continue;
    v.weg++;
    if (e.fehltA.length > 0 && e.fehltB.length > 0) v.beide++;
    else if (e.fehltA.length > 0) v.nurA++;
    else v.nurB++;
    for (const z of e.fehltA) zaehl(v.zeilen, `${kurz(z)}@A`);
    for (const z of e.fehltB) zaehl(v.zeilen, `${kurz(z)}@B`);
    // Der erste Schritt wird am STRENGEN Mass abgelesen: die Zeile ist dort
    // bereits zerstoert, auch wenn `occ` sie noch findet.
    const erster = e.spur.find((s) => s.ganzA.length > 0 || s.ganzB.length > 0);
    zaehl(v.ersterSchritt, erster === undefined ? '(keiner)' : erster.schritt);
    zaehl(
      v.erstesGeraet,
      erster === undefined
        ? '(keiner)'
        : erster.ganzA.length > 0 && erster.ganzB.length > 0
          ? 'beide'
          : erster.ganzA.length > 0
            ? 'A'
            : 'B'
    );
    if (v.beispiele.length < 6) v.beispiele.push(reihenfolge.join(''));
  }
  return v;
}

// Lange Zeilen der grossen Notiz auf ihre Kennung kuerzen — sonst ist die Tafel
// nicht lesbar.
function kurz(z: string): string {
  return z.length <= 12 ? z : z.slice(0, 6) + '…';
}

function zeile(name: string, v: Verortung): string {
  return (
    `${name.padEnd(30)} | n=${v.n} | WEG ${String(v.weg).padStart(3)} ` +
    `(${((v.weg / v.n) * 100).toFixed(1).padStart(5)} %) | ` +
    `GANZ WEG ${String(v.ganzWeg).padStart(3)} | ` +
    `LOESCHUNG KAM DURCH ${String(v.eingriffDurch).padStart(3)} | ` +
    `nur A ${String(v.nurA).padStart(3)} | nur B ${String(v.nurB).padStart(3)} | ` +
    `beide ${String(v.beide).padStart(3)} | ZEILEN ${tafel(v.zeilen)} | ` +
    `ERSTER SCHRITT ${tafel(v.ersterSchritt)} | ERST AUF ${tafel(v.erstesGeraet)} | ` +
    `KREUZ ${tafel(v.kreuz)}`
  );
}

describe('Grundtext-Verlust in der Loeschungs-Lage', () => {
  // A1 + A2: welche Zeile, welches Geraet, welcher Schritt.
  it('verortet den Grundtext-Verlust', async () => {
    const raus: string[] = [];
    for (const konfliktModus of ['kopie', 'ueberschreiben'] as const) {
      const v = await verorte({ konfliktModus });
      raus.push(zeile(konfliktModus, v));
      // eslint-disable-next-line no-console
      console.log(`Beispiel-Ordnungen (${konfliktModus}): ${v.beispiele.join(' ')}`);
    }
    // eslint-disable-next-line no-console
    console.log(`\n===== VERORTUNG (Schranke: ${SCHRANKE}) =====\n` + raus.join('\n'));
    expect(raus).toHaveLength(2);
  });

  // A4: haengt es an der Nachbarschaft der geloeschten Zeile?
  it('variiert die geloeschte Zeile', async () => {
    const varianten: Array<[string, string[]]> = [
      ['zeile-2 (Bestand)', ['zeile-2']],
      ['zeile-1', ['zeile-1']],
      ['zeile-3', ['zeile-3']],
      ['kopf (Rand)', ['kopf']],
      ['fuss (Rand)', ['fuss']],
      ['zeile-1 + zeile-3', ['zeile-1', 'zeile-3']],
      ['zeile-1 + zeile-2', ['zeile-1', 'zeile-2']],
    ];
    const raus: string[] = [];
    for (const [name, geloescht] of varianten) {
      const v = await verorte({}, { ...NOTIZ_KLEIN, geloescht });
      raus.push(zeile(name, v));
      // eslint-disable-next-line no-console
      console.log(zeile(name, v));
    }
    // eslint-disable-next-line no-console
    console.log(`\n===== VARIATION (Schranke: ${SCHRANKE}) =====\n` + raus.join('\n'));
    expect(raus).toHaveLength(varianten.length);
  });

  // A5: bleibt der Verlust ohne den Sweep?
  it('laesst den Sweep aus', async () => {
    const raus: string[] = [];
    for (const ohneSweep of [false, true]) {
      for (const konfliktModus of ['kopie', 'ueberschreiben'] as const) {
        const v = await verorte({ ohneSweep, konfliktModus });
        raus.push(zeile(`${konfliktModus} ohneSweep=${ohneSweep}`, v));
      }
    }
    // eslint-disable-next-line no-console
    console.log(`\n===== OHNE SWEEP (Schranke: ${SCHRANKE}) =====\n` + raus.join('\n'));
    expect(raus).toHaveLength(4);
  });

  // A3-Hilfe: EINE Ordnung, alle Zwischenstaende im Klartext. Ohne den Einzelfall
  // ist die Aggregatzahl oben nur ein Alarm ohne Adresse.
  it('zeigt einen Einzelfall im Klartext', async () => {
    const roh = process.env.SPIKE_PERM ?? '';
    const perms =
      roh === ''
        ? permutationen(6).slice(0, 1)
        : roh.split(',').map((s) => s.trim().split('').map(Number));
    for (const reihenfolge of perms) {
      const e = await laufRueckfall({
        lage: LAGE,
        reihenfolge,
        aWinnt: true,
        konfliktModus: 'ueberschreiben',
        schranke: SCHRANKE,
        spur: true,
      });
      // eslint-disable-next-line no-console
      console.log(
        `\n##### [${reihenfolge.join('')}] grundtextDa=${e.grundtextDa} ` +
          `fehltA=[${e.fehltA}] fehltB=[${e.fehltB}] ` +
          `sweepSah=${e.sweepAngesehen} beweisDa=${e.beweisDa} greift=${e.schranke}`
      );
      for (const s of e.spur) {
        // eslint-disable-next-line no-console
        console.log(
          `  ${s.schritt.padEnd(14)} fehltA=[${s.fehltA}] fehltB=[${s.fehltB}] ` +
            `ganzA=[${s.ganzA}] ganzB=[${s.ganzB}]\n` +
            `     A: ${JSON.stringify(s.aMd)}\n     B: ${JSON.stringify(s.bMd)}`
        );
      }
    }
    expect(perms.length).toBeGreaterThan(0);
  });

  // A3: DER MECHANISMUS IM KLEINEN, ohne Harness, ohne Sweep, ohne Sidecars.
  //
  // Behauptung: `CrdtManager.setContent` (crdt-manager.ts:211-231) diffed
  // ZEICHENweise (`diff_main`, ohne `diff_cleanupSemantic`, ohne Zeilenmodus).
  // Eine geloeschte Zeile wird dabei NICHT als „Zeile weg" erfasst, sondern als
  // Loeschung eines Stuecks, das ueber die Zeilengrenze reicht — hier
  // `"2\nzeile-"` statt `"zeile-2\n"`. Eine nebenlaeufige fremde Einfuegung, die
  // genau in diesem Stueck verankert ist, taucht beim Merge INNERHALB des
  // uebrig gebliebenen Zeilenrests wieder auf.
  //
  // Zwei Gegenproben halten die Behauptung auf: (1) liegt die fremde Einfuegung
  // ausserhalb des geloeschten Stuecks, bleibt alles heil — es ist also die
  // Nachbarschaft und nicht die Loeschung an sich; (2) mit
  // `diff_cleanupSemantic` faellt die Loeschung auf die Zeilengrenze und der
  // Schaden bleibt aus — es ist also der Diff und nicht Yjs.
  it('belegt den Mechanismus im Kleinen', async () => {
    const START = 'kopf\nAAA\nzeile-1\nzeile-2\nzeile-3\ngemeinsam\nfuss\n';
    const OHNE2 = 'kopf\nAAA\nzeile-1\nzeile-3\ngemeinsam\nfuss\n';

    const dmp = new diff_match_patch();
    const roh = dmp.diff_main(START, OHNE2);
    // eslint-disable-next-line no-console
    console.log(`Zeichen-Diff der Loeschung: ${JSON.stringify(roh)}`);
    const sauber = dmp.diff_main(START, OHNE2);
    dmp.diff_cleanupSemantic(sauber);
    // eslint-disable-next-line no-console
    console.log(`... nach diff_cleanupSemantic: ${JSON.stringify(sauber)}`);

    // (0) Der Schadensfall: B fuegt BBB unmittelbar VOR `zeile-3` ein.
    const schaden = spiel('kopf\nAAA\nzeile-1\nzeile-2\nBBB\nzeile-3\ngemeinsam\nfuss\n');
    // (1) Gegenprobe Nachbarschaft: B fuegt BBB ans ENDE, weit weg.
    const fern = spiel('kopf\nAAA\nzeile-1\nzeile-2\nzeile-3\ngemeinsam\nfuss\nBBB\n');
    // eslint-disable-next-line no-console
    console.log(`Einfuegung an der Loeschstelle: ${JSON.stringify(schaden)}`);
    // eslint-disable-next-line no-console
    console.log(`Einfuegung weit entfernt:      ${JSON.stringify(fern)}`);

    expect(schaden).toBe('kopf\nAAA\nzeile-1\nzeile-BBB\n3\ngemeinsam\nfuss\n');
    expect(fern).toContain('zeile-3\n');

    // (2) Gegenprobe Verfahren: derselbe Ablauf, aber die Loeschung wird ueber
    // einen semantisch bereinigten Diff in den Doc gebracht.
    const gesaeubert = spiel('kopf\nAAA\nzeile-1\nzeile-2\nBBB\nzeile-3\ngemeinsam\nfuss\n', true);
    // eslint-disable-next-line no-console
    console.log(`mit diff_cleanupSemantic:      ${JSON.stringify(gesaeubert)}`);
    expect(gesaeubert).toContain('zeile-3\n');

    // Der Diff des Bestands enthaelt genau das zeilenuebergreifende Stueck.
    expect(roh.some(([op, t]) => op === -1 && t === '2\nzeile-')).toBe(true);

    // EIN Spielzug: A und B teilen `START`, B fuegt ein, A loescht `zeile-2`,
    // danach mergen beide. Rueckgabe ist A's Text.
    function spiel(bText: string, semantisch = false): string {
      const docA = new Y.Doc();
      const docB = new Y.Doc();
      setze(docA, START);
      Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
      setze(docB, bText);
      setze(docA, OHNE2, semantisch);
      Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));
      return docA.getText('content').toString();
    }

    // Genau die Schleife aus crdt-manager.ts:217-230. Nachgebaut statt
    // aufgerufen, damit die Gegenprobe (2) EINE Zeile daran aendern kann.
    function setze(doc: Y.Doc, inhalt: string, semantisch = false): void {
      const text = doc.getText('content');
      const jetzt = text.toString();
      if (jetzt === inhalt) return;
      const diffs = dmp.diff_main(jetzt, inhalt);
      if (semantisch) dmp.diff_cleanupSemantic(diffs);
      doc.transact(() => {
        let pos = 0;
        for (const [op, data] of diffs) {
          if (op === 0) pos += data.length;
          else if (op === 1) {
            text.insert(pos, data);
            pos += data.length;
          } else text.delete(pos, data.length);
        }
      });
    }
  });
});
