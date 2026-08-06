// HALTEN DIE ZAHLEN BEI REALISTISCHER NOTIZGROESSE?
//
// Alle bisherigen Zahlen dieses Messapparats stammen von einer Notiz mit SECHS
// Zeilen. `text-merge.ts:36-49` sagt ausdruecklich, dass `threeWayMerge` Hunks ab
// etwa 500 Zeichen Kontextverschiebung STILL verwirft — bei sechs Zeilen ist jede
// Verschiebung kleiner als das. Ob „still verloren 60" und „doppelt 78" der
// Basis-Korrektur an der Winzigkeit der Notiz haengen, war offen.
//
// Diese Datei faehrt dieselben zwei Lagen mit derselben Zellbasis, einmal mit der
// kleinen und einmal mit einer realistisch grossen Notiz (105 Textzeilen, rund
// 5,7 kB, Absaetze verschiedener Laenge, Edits MITTENDRIN). Die kleine Notiz
// laeuft mit, damit die Kalibrierung im selben Instrument steht und nicht aus
// einem anderen Lauf zitiert werden muss.
//
// ZELLBASIS: `SPIKE_SCHRITT=k` nimmt jede k-te Zustellordnung (Default 1 = alle
// 720). Jede Kuerzung steht in der Ausgabe — eine stillschweigende waere der
// schlimmere Fehler.

import {
  laufRueckfall,
  permutationen,
  notizGross,
  NOTIZ_KLEIN,
  type Lage,
  type Notiz,
} from './lauf-rueckfall';
import type { SweepSchranke } from '../src/sync-handler';

jest.setTimeout(7200000);

const SCHRANKE = (process.env.SPIKE_SCHRANKE as SweepSchranke | undefined) ?? 'aus';
const SCHRITT = Math.max(1, Number(process.env.SPIKE_SCHRITT ?? 1));
// Nur diese Lagen messen (Komma-Liste), damit sich lange Laeufe aufteilen lassen.
const LAGEN = (process.env.SPIKE_LAGEN ?? 'neustart,neustart-offline-loeschung')
  .split(',')
  .map((s) => s.trim()) as Lage[];
const NOTIZEN = (process.env.SPIKE_NOTIZEN ?? 'klein,gross').split(',').map((s) => s.trim());

interface Zelle {
  n: number;
  ueberschrieben: number;
  stillVerloren: number;
  inKopie: number;
  divergenz: number;
  doppel: number;
  sauber: number;
  sweepAngesehen: number;
  schranke: number;
  beweisDa: number;
  eingriffDurch: number;
  grundtextWeg: number; // altes Mass (`occ`)
  ganzWeg: number; // strenges Mass: Grundzeile nicht mehr als GANZE Zeile da
}

async function messeZelle(lage: Lage, notiz: Notiz | undefined): Promise<Zelle> {
  const z: Zelle = {
    n: 0,
    ueberschrieben: 0,
    stillVerloren: 0,
    inKopie: 0,
    divergenz: 0,
    doppel: 0,
    sauber: 0,
    sweepAngesehen: 0,
    schranke: 0,
    beweisDa: 0,
    eingriffDurch: 0,
    grundtextWeg: 0,
    ganzWeg: 0,
  };
  const alle = permutationen(6);
  for (let i = 0; i < alle.length; i += SCHRITT) {
    const e = await laufRueckfall({
      lage,
      reihenfolge: alle[i],
      aWinnt: true,
      konfliktModus: 'ueberschreiben',
      schranke: SCHRANKE,
      notiz,
    });
    z.n++;
    if (e.aUeberschrieben) z.ueberschrieben++;
    if (e.stillVerloren.length > 0) z.stillVerloren++;
    if (e.inKopie.length > 0) z.inKopie++;
    if (e.befund.divergenz) z.divergenz++;
    if (e.befund.doppel.length > 0) z.doppel++;
    if (e.befund.sauber) z.sauber++;
    if (e.sweepAngesehen) z.sweepAngesehen++;
    z.schranke += e.schranke;
    if (e.beweisDa) z.beweisDa++;
    if (e.eingriffDurch) z.eingriffDurch++;
    if (!e.grundtextDa) z.grundtextWeg++;
    if (!e.grundtextGanzDa) z.ganzWeg++;
  }
  return z;
}

describe('Rueckfall bei realistischer Notizgroesse', () => {
  it('misst klein gegen gross', async () => {
    const gross = notizGross();
    const nah = notizGross(true);
    // eslint-disable-next-line no-console
    console.log(
      `Grosse Notiz: ${gross.basis.split('\n').length - 1} Zeilen, ` +
        `${gross.basis.length} Zeichen, Edit A bei Zeile ${gross.posA}, ` +
        `B bei ${gross.posB} (nah: ${nah.posB}), geloescht ${JSON.stringify(gross.geloescht)}`
    );
    // eslint-disable-next-line no-console
    console.log(
      `Zellbasis: jede ${SCHRITT}. der 720 Zustellordnungen ` +
        `(= ${Math.ceil(720 / SCHRITT)} je Zelle), Modus ueberschreiben, aWinnt=true`
    );

    const zeilen: string[] = [];
    for (const welche of NOTIZEN) {
      const notiz =
        welche === 'gross' ? gross : welche === 'gross-nah' ? notizGross(true) : NOTIZ_KLEIN;
      for (const lage of LAGEN) {
        const t0 = Date.now();
        const z = await messeZelle(lage, notiz);
        const zeile =
          `${welche.padEnd(6)} | ${lage.padEnd(27)} | n=${String(z.n).padStart(3)} | ` +
          `ueberschrieben ${String(z.ueberschrieben).padStart(3)} | ` +
          `STILL VERLOREN ${String(z.stillVerloren).padStart(3)} | ` +
          `in Kopie ${String(z.inKopie).padStart(3)} | ` +
          `DOPPELT ${String(z.doppel).padStart(3)} | ` +
          `divergent ${String(z.divergenz).padStart(3)} | ` +
          `sauber ${String(z.sauber).padStart(3)} | ` +
          `EINGRIFF DURCH ${String(z.eingriffDurch).padStart(3)} | ` +
          `GRUNDTEXT WEG ${String(z.grundtextWeg).padStart(3)} ` +
          `(ganz ${String(z.ganzWeg).padStart(3)}) | ` +
          `Sweep sah ${String(z.sweepAngesehen).padStart(3)} | ` +
          `Beweis da ${String(z.beweisDa).padStart(3)} | ` +
          `greift ${String(z.schranke).padStart(3)} | ` +
          `${((Date.now() - t0) / 1000).toFixed(0)} s`;
        zeilen.push(zeile);
        // eslint-disable-next-line no-console
        console.log(zeile);
      }
    }
    // eslint-disable-next-line no-console
    console.log(
      `\n===== GROSSE NOTIZ (Schranke: ${SCHRANKE}, Schritt: ${SCHRITT}) =====\n` +
        zeilen.join('\n')
    );
    expect(zeilen.length).toBe(NOTIZEN.length * LAGEN.length);
  });
});
