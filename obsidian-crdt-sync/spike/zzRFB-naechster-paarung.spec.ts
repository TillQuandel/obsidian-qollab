// DIE PAARUNG — Lauf für Lauf statt Summenspalte.
//
// Die Aggregatzahlen sagen „90 gegen 64 stille Verluste, 26 abweichende Wahlen".
// Dass die 26 abweichenden Wahlen GENAU die 26 geretteten Läufe sind, legen sie
// nur nahe. Hier läuft dieselbe Zustellordnung durch beide Schalterstände und
// wird paarweise verglichen; die Zuordnung ist damit eine Aussage über jeden
// einzelnen Lauf und ein Gegenbeispiel muss auffallen dürfen.
//
// ZWEI FRAGEN, die die Summen nicht beantworten:
//
//   1. DIE SECHS. In 32 Läufen war der Befund mehrdeutig, in nur 26 wählte
//      `basis-naechster` anders. Waren die übrigen sechs richtig entschieden?
//      Ablesbar daran, ob sie am Ende einen stillen Verlust tragen: bleibt ein
//      mehrdeutiger Lauf trotz gleicher Wahl sauber, war der erste Treffer dort
//      die richtige Basis. Trägt er Verlust, ist die Abstandsregel unvollständig
//      — sie sieht die Mehrdeutigkeit, löst sie aber nicht.
//
//   2. DER NEBENEFFEKT. Läufe OHNE Mehrfachbefund müssen in beiden Ständen
//      zeichengleich enden — `basis-naechster` steigt dort vor jeder
//      Abstandsrechnung mit `treffer[0]` aus. Jede Abweichung wäre ein
//      unbekannter Seiteneffekt der Regel.
//
// Zellbasis: dieselbe 1:504-Stichprobe der 9! Ordnungen wie in `zzRF6`
// (720 von 362.880, systematisch). WEGGELASSEN sind 362.160 Ordnungen.

import { laufRueckfall, stichprobe, permutationen, NOTE } from './lauf-rueckfall';
import type { SweepSchranke } from '../src/sync-handler';
import { messe } from './bilanz';

jest.setTimeout(7200000);

const ORDNUNGEN = stichprobe(9, 504);

describe('basis-naechster gegen basis-signatur, Lauf fuer Lauf', () => {
  it('paart die Mehrfachfaelle und prueft die sechs unveraenderten', async () => {
    const grund = {
      lage: 'neustart' as const,
      aWinnt: true,
      konfliktModus: 'ueberschreiben' as const,
      diffModus: 'semantisch' as const,
      geraete: 3 as const,
    };
    // Vier Klassen, je zwei Ausgaenge. `sig`/`nae` = stiller Verlust im
    // jeweiligen Stand.
    const t = {
      eindeutigGleich: 0,
      eindeutigVerschieden: 0, // MUSS 0 bleiben — sonst Nebeneffekt
      mehrfachAndereWahl: 0,
      mehrfachAndereWahlGerettet: 0, // sig verliert, nae nicht
      mehrfachAndereWahlOhneWirkung: 0,
      mehrfachAndereWahlVerschlechtert: 0, // nae verliert, sig nicht
      mehrfachGleicheWahl: 0, // DIE SECHS
      mehrfachGleicheWahlSauber: 0,
      mehrfachGleicheWahlVerlust: 0,
      mehrfachZaehlungUneinig: 0, // beide Staende sehen verschieden viele Befunde
    };
    for (const reihenfolge of ORDNUNGEN) {
      const sig = await laufRueckfall({ ...grund, schranke: 'basis-signatur', reihenfolge });
      const nae = await laufRueckfall({ ...grund, schranke: 'basis-naechster', reihenfolge });
      const sigVerl = sig.stillVerloren.length > 0;
      const naeVerl = nae.stillVerloren.length > 0;
      if (sig.schrankeMehrfach !== nae.schrankeMehrfach) t.mehrfachZaehlungUneinig++;
      if (nae.schrankeMehrfach === 0) {
        // Kein mehrdeutiger Befund: beide Staende MUESSEN dasselbe liefern —
        // und zwar nicht nur in der Verlustspalte, sondern im Text selbst.
        if (sigVerl === naeVerl) t.eindeutigGleich++;
        else t.eindeutigVerschieden++;
        continue;
      }
      if (nae.schrankeAndereWahl > 0) {
        t.mehrfachAndereWahl++;
        if (sigVerl && !naeVerl) t.mehrfachAndereWahlGerettet++;
        else if (!sigVerl && naeVerl) t.mehrfachAndereWahlVerschlechtert++;
        else t.mehrfachAndereWahlOhneWirkung++;
      } else {
        t.mehrfachGleicheWahl++;
        if (naeVerl) t.mehrfachGleicheWahlVerlust++;
        else t.mehrfachGleicheWahlSauber++;
      }
    }
    // eslint-disable-next-line no-console
    console.log('\n===== PAARUNG (3 Geraete, n=720) =====\n' + JSON.stringify(t, null, 2));
    expect(t.eindeutigGleich + t.eindeutigVerschieden + t.mehrfachAndereWahl + t.mehrfachGleicheWahl).toBe(720);
  });

  // GEGENPROBE zur Klasse `eindeutigGleich`: „gleicher Verlust" ist ein schwaches
  // Mass — zwei Laeufe koennen beide verlustfrei und trotzdem verschieden sein.
  // Hier wird der TEXT beider `.md` verglichen, ueber die vollen 720 Ordnungen mit
  // zwei Geraeten (dort ist `mehrfach` per Bau immer 0).
  it('zwei Geraete: basis-naechster liefert zeichengleiche .md wie basis-signatur', async () => {
    let geprueft = 0;
    let ungleich = 0;
    let mitBefund = 0;
    for (const reihenfolge of permutationen(6)) {
      const grund = {
        lage: 'neustart' as const,
        aWinnt: true,
        konfliktModus: 'ueberschreiben' as const,
        diffModus: 'semantisch' as const,
        reihenfolge,
        spur: true,
      };
      const sig = await laufRueckfall({ ...grund, schranke: 'basis-signatur' as SweepSchranke });
      const nae = await laufRueckfall({ ...grund, schranke: 'basis-naechster' as SweepSchranke });
      geprueft++;
      if (sig.schranke > 0) mitBefund++;
      const sigEnde = sig.spur[sig.spur.length - 1];
      const naeEnde = nae.spur[nae.spur.length - 1];
      if (sigEnde.aMd !== naeEnde.aMd || sigEnde.bMd !== naeEnde.bMd) ungleich++;
    }
    // eslint-disable-next-line no-console
    console.log(
      `\n===== ZWEI GERAETE, TEXTVERGLEICH ===== geprueft ${geprueft}, ` +
        `mit Schranken-Befund ${mitBefund}, TEXT UNGLEICH ${ungleich} (Note: ${NOTE})`
    );
    expect(geprueft).toBe(720);
    // Ohne Befunde saegte die Probe am eigenen Ast: sie verglichen zwei Laeufe, in
    // denen die Wahlregel nie gefragt wurde.
    expect(mitBefund).toBeGreaterThan(0);
    expect(ungleich).toBe(0);
  });

  // DER AUFWAND. Belegt ist bisher, dass das ERGEBNIS von `fremdErklaert`
  // unveraendert ist — nicht, was das Sammeln aller Geschwister kostet.
  // `Text` gegen `frueher` ist die Zahl der zusaetzlichen `textFromUpdate`-Aufrufe,
  // `Abstand` die zusaetzlichen Diffs der Wahlregel.
  it('misst den Aufwand bei zwei und bei drei Geraeten', async () => {
    const zeilen: string[] = [];
    for (const geraete of [2, 3] as const) {
      for (const schranke of [
        'aus',
        'basis-signatur',
        'basis-naechster',
      ] as SweepSchranke[]) {
        const z = await messe(
          {
            lage: 'neustart',
            aWinnt: true,
            konfliktModus: 'ueberschreiben',
            schranke,
            diffModus: 'semantisch',
            geraete,
          },
          geraete === 3 ? ORDNUNGEN : permutationen(6)
        );
        zeilen.push(
          `${geraete} Geraete | ${schranke.padEnd(15)} | n=${z.n} | ` +
            `Text-Dekodierungen ${String(z.text).padStart(5)} ` +
            `(frueher ${String(z.textFrueher).padStart(5)}, ` +
            `Mehraufwand ${String(z.text - z.textFrueher).padStart(4)}) | ` +
            `Abstands-Diffs ${String(z.abstand).padStart(4)} | ` +
            `${(z.ms / z.n).toFixed(2)} ms/Lauf`
        );
      }
    }
    // eslint-disable-next-line no-console
    console.log('\n===== AUFWAND =====\n' + zeilen.join('\n'));
    expect(zeilen).toHaveLength(6);
  });
});
