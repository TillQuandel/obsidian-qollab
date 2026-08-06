// DIE MESSUNG zum fremdbestimmten Rueckfall der `.md`.
//
// Drei Lagen, dieselbe Zellbasis: die VOLLSTAENDIGE Aufzaehlung der 720
// Zustellreihenfolgen. Kein Teilsatz, kein Seed-Wuerfel.
//
//   'laufend'             — Obsidian laeuft, DAS TOR (main.ts:326-334) greift.
//   'neustart'            — Obsidian war zu, danach der Start-Sweep OHNE Tor.
//   'neustart-ohne-sweep' — MUTATIONSPROBE: derselbe Neustart, Sweep ausgelassen.
//
// Zwei Konfliktmodi des Datei-Sync:
//   'kopie'          — OneDrive: die verdraengte Fassung wird zur Konfliktkopie.
//   'ueberschreiben' — kein Netz: sie ist ersatzlos weg.
//
// Gezaehlt wird der STILLE Verlust: ein Textbaustein, der am Ende in keiner der
// beiden `.md` steht UND in keiner Konfliktkopie und in keiner Sicherung des
// Plugins. Nur das ist „still weg"; liegt er in einer Kopie, ist er Handarbeit,
// aber sichtbar.

import { laufRueckfall, permutationen, type Lage } from './lauf-rueckfall';
import type { SweepSchranke } from '../src/sync-handler';

jest.setTimeout(3600000);

// DER MESSSCHALTER, aus der Umgebung. Ohne ihn laeuft der Bestand — genau die
// Kalibrierung. `SPIKE_SCHRANKE=exakt|deckung|signatur` schaltet je eine Variante.
const SCHRANKE = (process.env.SPIKE_SCHRANKE as SweepSchranke | undefined) ?? 'aus';

interface Zelle {
  n: number;
  ueberschrieben: number; // Teilmenge, in der der Rueckfall wirklich eintrat
  stillVerloren: number;
  stillVerlorenBedingt: number; // nur innerhalb `ueberschrieben`
  inKopie: number;
  divergenz: number;
  doppel: number;
  sauber: number;
  sweepAngesehen: number;
  schranke: number; // AKTIVITAETSPROBE
  beweisDa: number; // GEGENPROBE: fremder Nachweis lag zum Sweep-Zeitpunkt vor
  beweisDaUeber: number; // dito, aber nur in den ueberschriebenen Laeufen
}

async function messeZelle(
  lage: Lage,
  konfliktModus: 'kopie' | 'ueberschreiben'
): Promise<Zelle> {
  const z: Zelle = {
    n: 0,
    ueberschrieben: 0,
    stillVerloren: 0,
    stillVerlorenBedingt: 0,
    inKopie: 0,
    divergenz: 0,
    doppel: 0,
    sauber: 0,
    sweepAngesehen: 0,
    schranke: 0,
    beweisDa: 0,
    beweisDaUeber: 0,
  };
  for (const reihenfolge of permutationen(6)) {
    const e = await laufRueckfall({
      lage,
      reihenfolge,
      aWinnt: true,
      konfliktModus,
      schranke: SCHRANKE,
    });
    z.n++;
    const still = e.stillVerloren.length > 0;
    if (e.aUeberschrieben) z.ueberschrieben++;
    if (still) z.stillVerloren++;
    if (still && e.aUeberschrieben) z.stillVerlorenBedingt++;
    if (e.inKopie.length > 0) z.inKopie++;
    if (e.befund.divergenz) z.divergenz++;
    if (e.befund.doppel.length > 0) z.doppel++;
    if (e.befund.sauber) z.sauber++;
    if (e.sweepAngesehen) z.sweepAngesehen++;
    z.schranke += e.schranke;
    if (e.beweisDa) z.beweisDa++;
    if (e.beweisDa && e.aUeberschrieben) z.beweisDaUeber++;
  }
  return z;
}

const proz = (x: number, n: number): string =>
  n === 0 ? '   —  ' : `${((x / n) * 100).toFixed(1).padStart(5)} %`;

describe('Rueckfall der .md hinter den Merge-Zustand', () => {
  it('misst drei Lagen ueber die vollstaendige Zustellordnung', async () => {
    const zeilen: string[] = [];
    for (const konfliktModus of ['kopie', 'ueberschreiben'] as const) {
      for (const lage of ['laufend', 'neustart', 'neustart-ohne-sweep'] as const) {
        const z = await messeZelle(lage, konfliktModus);
        const zeile =
          `${konfliktModus.padEnd(14)} | ${lage.padEnd(20)} | n=${z.n} | ` +
          `ueberschrieben ${String(z.ueberschrieben).padStart(3)} | ` +
          `STILL VERLOREN ${String(z.stillVerloren).padStart(3)} (${proz(z.stillVerloren, z.n)} von n, ` +
          `${proz(z.stillVerlorenBedingt, z.ueberschrieben)} der ueberschriebenen) | ` +
          `in Kopie ${String(z.inKopie).padStart(3)} | ` +
          `divergent ${String(z.divergenz).padStart(3)} | ` +
          `doppelt ${String(z.doppel).padStart(3)} | ` +
          `sauber ${String(z.sauber).padStart(3)} | ` +
          `Sweep sah ${z.sweepAngesehen} | ` +
          `Beweis da ${z.beweisDa} (davon ueberschrieben ${z.beweisDaUeber}) | ` +
          `greift ${z.schranke}`;
        zeilen.push(zeile);
        // eslint-disable-next-line no-console
        console.log(zeile);
      }
    }
    // eslint-disable-next-line no-console
    console.log(`\n===== ERGEBNIS (Schranke: ${SCHRANKE}) =====\n` + zeilen.join('\n'));
    expect(zeilen).toHaveLength(6);
  });
});
