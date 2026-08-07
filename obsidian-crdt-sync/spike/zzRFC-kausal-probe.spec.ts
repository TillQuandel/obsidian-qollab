// DIE GEGENPROBE ZUR KAUSALITAETS-ZUORDNUNG.
//
// Die Zerlegung der zurueckkehrenden Loeschungen in „legitimes Add-wins" und
// „Fehler" steht und faellt mit EINER Frage: sieht der Zaehler ueberhaupt beide
// Faelle? In diesem Projekt waren nachweislich sechs Messinstrumente blind; ein
// Zaehler, der immer `false` liefert, wuerde die ganze Rate als legitim
// ausweisen und niemand saehe es an der Zahl.
//
// Deshalb hier ZWEI konstruierte Laeufe, die sich in NICHTS unterscheiden ausser
// der Zustellordnung:
//
//   [1,3,0,2,4,5] — Ereignis 1 (B laedt hoch) liegt VOR Ereignis 3 (A zieht die
//                   Hilfsdateien und pollt). A hat B's Ops eingespielt, BEVOR es
//                   loescht: die Loeschung liegt KAUSAL DANACH.
//   [3,1,0,2,4,5] — dieselben Ereignisse, 3 vor 1. A zieht ins Leere; B laedt
//                   erst danach hoch. A hat B's Ops NIE eingespielt: die
//                   Loeschung ist NEBENLAEUFIG.
//
// Zusaetzlich die Trennschaerfe gegen den Text: In der nebenlaeufigen Ordnung
// KANN A's Doc den fremden Baustein trotzdem tragen — ueber den Parkplatz, der
// per `unionMerge` aufloest, oder ueber einen Diff aus der ueberschriebenen
// `.md`. Das ist Textkenntnis ohne kausale Kenntnis. Ein Zaehler, der den
// Unterschied nicht macht, zaehlt genau falsch herum.

import { laufRueckfall, permutationen, type Konfig } from './lauf-rueckfall';

jest.setTimeout(3600000);

const KAUSAL = [1, 3, 0, 2, 4, 5];
const NEBEN = [3, 1, 0, 2, 4, 5];

const basis: Omit<Konfig, 'reihenfolge' | 'lage'> = {
  aWinnt: true,
  konfliktModus: 'ueberschreiben',
  schranke: 'aus',
  diffModus: 'roh',
};

function zeig(name: string, e: Awaited<ReturnType<typeof laufRueckfall>>): string {
  return (
    `${name.padEnd(30)} kannteFremd=${String(e.kannteFremd).padEnd(5)} ` +
    `sahFremdMd=${String(e.sahFremdMd).padEnd(5)} fremdImDoc=${String(e.fremdImDoc).padEnd(5)} ` +
    `Loeschung kam durch=${String(e.eingriffDurch).padEnd(5)} ` +
    `A: ${JSON.stringify(e.spur[e.spur.length - 1]?.aMd ?? '')}`
  );
}

describe('Kausalitaets-Zuordnung der Loeschung', () => {
  it('ordnet zwei konstruierte Laeufe VERSCHIEDEN ein', async () => {
    const kausal = await laufRueckfall({
      ...basis,
      lage: 'laufend-loeschung',
      reihenfolge: KAUSAL,
      spur: true,
    });
    const neben = await laufRueckfall({
      ...basis,
      lage: 'laufend-loeschung',
      reihenfolge: NEBEN,
      spur: true,
    });
    // eslint-disable-next-line no-console
    console.log(
      '\n===== GEGENPROBE =====\n' +
        zeig(`[${KAUSAL.join('')}] erwartet kausal`, kausal) +
        '\n' +
        zeig(`[${NEBEN.join('')}] erwartet nebenlaeufig`, neben)
    );

    // DER KERN: der Zaehler unterscheidet die beiden.
    expect(kausal.kannteFremd).toBe(true);
    expect(neben.kannteFremd).toBe(false);
    expect(kausal.loeschLage).toBe(true);
    expect(neben.loeschLage).toBe(true);
  });

  it('bleibt in der geschlossenen App per Bau nebenlaeufig', async () => {
    // A ist waehrend der ganzen Zustellung ZU und spielt nichts ein — beide
    // Ordnungen muessen nebenlaeufig sein. Waere der Zaehler an die Ordnung
    // statt an den Zustandsvektor gehaengt, stuende hier `true`.
    for (const reihenfolge of [KAUSAL, NEBEN]) {
      const e = await laufRueckfall({
        ...basis,
        lage: 'neustart-offline-loeschung',
        reihenfolge,
        spur: true,
      });
      // eslint-disable-next-line no-console
      console.log(zeig(`[${reihenfolge.join('')}] neustart-offline-loeschung`, e));
      expect(e.kannteFremd).toBe(false);
      expect(e.loeschLage).toBe(true);
    }
  });

  it('meldet ausserhalb der Loeschungs-Lagen keine Zerlegung', async () => {
    const e = await laufRueckfall({ ...basis, lage: 'neustart', reihenfolge: KAUSAL });
    expect(e.loeschLage).toBe(false);
  });

  // Die Vorprobe fuer die grosse Zelle: Deckt sich die Zuordnung mit der
  // STRUKTURELLEN Erwartung „Ereignis 1 vor Ereignis 3"? Sie ist eine
  // unabhaengige Herleitung derselben Groesse — die eine liest den
  // Zustandsvektor, die andere die Zustellordnung. Weichen sie ab, ist eine von
  // beiden falsch, und das muss vor der Zerlegung geklaert sein.
  it('deckt sich mit der Zustellordnung ueber alle 720 Ordnungen', async () => {
    let gleich = 0;
    let anders = 0;
    let kausal = 0;
    for (const reihenfolge of permutationen(6)) {
      const e = await laufRueckfall({ ...basis, lage: 'laufend-loeschung', reihenfolge });
      const erwartet = reihenfolge.indexOf(1) < reihenfolge.indexOf(3);
      if (e.kannteFremd) kausal++;
      if (e.kannteFremd === erwartet) gleich++;
      else anders++;
    }
    // eslint-disable-next-line no-console
    console.log(
      `\n===== ORDNUNGSPROBE =====\nkausal ${kausal}/720, ` +
        `deckungsgleich mit „1 vor 3" ${gleich}, abweichend ${anders}`
    );
    expect(kausal).toBe(360);
    expect(anders).toBe(0);
  });

  // DER POSITIVE NACHWEIS, dass die Klasse FEHLERHAFT nicht leer ist.
  //
  // In fast allen gemessenen Zellen steht dort null. Eine Null ist erst dann ein
  // Befund, wenn DASSELBE Instrument anderswo eine Zahl ungleich null liefert —
  // sonst ist sie von „der Zaehler ist blind" nicht zu unterscheiden. Diese
  // Zelle liefert sie: Loeschung nach ZWEI Zustellereignissen, Zelle `geteilt`,
  // Bestand `roh/aus`. Dann kann NACH der Loeschung noch eine veraltete fremde
  // `.md` eintreffen, die die Zeile weiter traegt — das Tor parkt sie, die Frist
  // laeuft ab, `tickParked` loest per `unionMerge` auf, und Vereinigen kann
  // nichts loeschen.
  it('findet die fehlerhaften Wiederbelebungen und zeigt eine im Klartext', async () => {
    const fehlerhaft: string[] = [];
    let ersteSpur: Awaited<ReturnType<typeof laufRueckfall>> | undefined;
    let kausal = 0;
    for (const reihenfolge of permutationen(6)) {
      const e = await laufRueckfall({
        ...basis,
        lage: 'laufend-loeschung',
        reihenfolge,
        loeschungNach: 2,
        spur: fehlerhaft.length === 0,
      });
      if (e.kannteFremd) kausal++;
      if (e.kannteFremd && !e.eingriffDurch) {
        fehlerhaft.push(reihenfolge.join(''));
        if (ersteSpur === undefined && e.spur.length > 0) ersteSpur = e;
      }
    }
    // eslint-disable-next-line no-console
    console.log(
      `\n===== FEHLERHAFTE WIEDERBELEBUNGEN =====\n` +
        `kausal nachgelagerte Loeschungen ${kausal}/720, davon wiederbelebt ` +
        `${fehlerhaft.length}: ${fehlerhaft.join(' ')}`
    );
    if (ersteSpur) {
      for (const s of ersteSpur.spur) {
        // eslint-disable-next-line no-console
        console.log(`  ${s.schritt.padEnd(16)} A: ${JSON.stringify(s.aMd)}`);
      }
    }
    // Beide Zahlen sind der Riegel: die Zelle MUSS kausal nachgelagerte
    // Loeschungen enthalten UND darunter fehlerhafte Wiederbelebungen.
    expect(kausal).toBe(24);
    expect(fehlerhaft).toHaveLength(6);
  });
});
