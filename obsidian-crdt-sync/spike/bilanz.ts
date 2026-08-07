// Die Aggregation eines Zellenlaufs — EINE Fassung fuer alle neuen Messungen.
//
// `zzRF-rueckfall.spec.ts` traegt seine eigene, aeltere Kopie davon. Sie bleibt
// bewusst unangetastet: sie ist das Instrument, gegen dessen Zahlen hier
// kalibriert wird, und ein Umbau daran hiesse, die Referenz mitzubewegen. Trifft
// diese Fassung die bekannten Zahlen nicht (`zzRF5-kalibrierung`), ist der Fehler
// hier und nicht dort.

import { laufRueckfall, type Konfig } from './lauf-rueckfall';

export interface Zellwerte {
  n: number;
  ueberschrieben: number; // Teilmenge, in der der Rueckfall wirklich eintrat
  stillVerloren: number;
  inKopie: number;
  divergenz: number;
  doppel: number;
  sauber: number;
  sweepAngesehen: number;
  schranke: number; // AKTIVITAETSPROBE: wie oft hat die Schranke gegriffen?
  mehrfach: number; // MEHRDEUTIGKEIT: mehr als ein erklaerender Sibling
  treffer: number; // Summe aller erklaerenden Siblings ueber alle Befunde
  andereWahl: number; // nur 'basis-naechster': Wahl weicht vom ersten Treffer ab
  beweisDa: number;
  eingriffDurch: number;
  // DIE KAUSALITAETS-ZERLEGUNG. Nur in den Loeschungs-Lagen belegt (`loeschLauf`
  // sagt, wie viele Laeufe der Zelle ueberhaupt eine Loeschung enthielten).
  loeschLauf: number;
  kannteFremd: number; // Loeschung lag KAUSAL NACH dem fremden Stand
  sahFremdMd: number; // Diagnose: der fremde Baustein stand in A's `.md`
  fremdImDoc: number; // Diagnose: der fremde Baustein stand in A's Doc
  wieder: number; // die geloeschte Zeile ist am Ende ZURUECK
  wiederKausal: number; // ... obwohl die Loeschung den fremden Stand kannte: FEHLER
  wiederNebenlaeufig: number; // ... bei nebenlaeufiger Loeschung: legitimes Add-wins
  // DIESELBE ZERLEGUNG UNTER DER SCHWAECHEREN DEFINITION von „kannte den fremden
  // Stand": nicht kausal, sondern nur „stand beim Loeschen in der `.md`" bzw.
  // „stand im Doc". Beide sind der naheliegende Einwand gegen die Zerlegung
  // oben — wer sie so liest, bekommt eine andere Zahl, und die gehoert daneben.
  wiederSahMd: number;
  wiederImDoc: number;
  grundtextWeg: number; // K.O., lockeres Mass (`occ`, Teilstring)
  ganzWeg: number; // K.O., STRENGES Mass (ganze Zeile)
  ganzDoppel: number; // strenge Verdopplung einer GRUNDZEILE
  diffGeaendert: number;
  parkungen: number;
  // AUFWAND: dekodierte Geschwister-Texte gegen die Zahl beim fruehen Ausstieg,
  // die Abstands-Diffs der Wahlregel, und die reine Laufzeit der Zelle.
  text: number;
  textFrueher: number;
  abstand: number;
  ms: number;
}

const leer = (): Zellwerte => ({
  n: 0,
  ueberschrieben: 0,
  stillVerloren: 0,
  inKopie: 0,
  divergenz: 0,
  doppel: 0,
  sauber: 0,
  sweepAngesehen: 0,
  schranke: 0,
  mehrfach: 0,
  treffer: 0,
  andereWahl: 0,
  beweisDa: 0,
  eingriffDurch: 0,
  loeschLauf: 0,
  kannteFremd: 0,
  sahFremdMd: 0,
  fremdImDoc: 0,
  wieder: 0,
  wiederKausal: 0,
  wiederNebenlaeufig: 0,
  wiederSahMd: 0,
  wiederImDoc: 0,
  grundtextWeg: 0,
  ganzWeg: 0,
  ganzDoppel: 0,
  diffGeaendert: 0,
  parkungen: 0,
  text: 0,
  textFrueher: 0,
  abstand: 0,
  ms: 0,
});

// Faehrt dieselbe Konfiguration ueber jede uebergebene Zustellordnung.
export async function messe(
  basis: Omit<Konfig, 'reihenfolge'>,
  ordnungen: number[][]
): Promise<Zellwerte> {
  const z = leer();
  const start = Date.now();
  for (const reihenfolge of ordnungen) {
    const e = await laufRueckfall({ ...basis, reihenfolge });
    z.n++;
    if (e.aUeberschrieben) z.ueberschrieben++;
    if (e.stillVerloren.length > 0) z.stillVerloren++;
    if (e.inKopie.length > 0) z.inKopie++;
    if (e.befund.divergenz) z.divergenz++;
    if (e.befund.doppel.length > 0) z.doppel++;
    if (e.befund.sauber) z.sauber++;
    if (e.sweepAngesehen) z.sweepAngesehen++;
    z.schranke += e.schranke;
    z.mehrfach += e.schrankeMehrfach;
    z.treffer += e.schrankeTreffer;
    z.andereWahl += e.schrankeAndereWahl;
    if (e.beweisDa) z.beweisDa++;
    if (e.eingriffDurch) z.eingriffDurch++;
    if (e.loeschLage) {
      z.loeschLauf++;
      if (e.kannteFremd) z.kannteFremd++;
      if (e.sahFremdMd) z.sahFremdMd++;
      if (e.fremdImDoc) z.fremdImDoc++;
      // `eingriffDurch` heisst in der Loeschungs-Lage „die Zeile ist nirgends
      // mehr". Der Gegenfall ist die Wiederbelebung — und nur der wird zerlegt.
      if (!e.eingriffDurch) {
        z.wieder++;
        if (e.kannteFremd) z.wiederKausal++;
        else z.wiederNebenlaeufig++;
        if (e.sahFremdMd) z.wiederSahMd++;
        if (e.fremdImDoc) z.wiederImDoc++;
      }
    }
    if (!e.grundtextDa) z.grundtextWeg++;
    if (!e.grundtextGanzDa) z.ganzWeg++;
    if (e.ganzDoppelt.length > 0) z.ganzDoppel++;
    z.diffGeaendert += e.diffGeaendert;
    z.parkungen += e.parkungen;
    z.text += e.schrankeText;
    z.textFrueher += e.schrankeTextFrueher;
    z.abstand += e.schrankeAbstand;
  }
  z.ms = Date.now() - start;
  return z;
}

const z3 = (x: number): string => String(x).padStart(3);

export function zeile(name: string, z: Zellwerte): string {
  return (
    `${name.padEnd(34)} n=${z.n} | ` +
    `ueberschr ${z3(z.ueberschrieben)} | ` +
    `STILL VERL ${z3(z.stillVerloren)} | ` +
    `in Kopie ${z3(z.inKopie)} | ` +
    `divergent ${z3(z.divergenz)} | ` +
    `doppelt ${z3(z.doppel)} (ganz ${z3(z.ganzDoppel)}) | ` +
    `GRUNDTEXT WEG ${z3(z.grundtextWeg)} (ganz ${z3(z.ganzWeg)}) | ` +
    `sauber ${z3(z.sauber)} | ` +
    `Sweep sah ${z3(z.sweepAngesehen)} | Beweis da ${z3(z.beweisDa)} | ` +
    `GREIFT ${z3(z.schranke)} (mehrfach ${z3(z.mehrfach)}, Treffer ${z3(z.treffer)}, ` +
    `andere Wahl ${z3(z.andereWahl)}) | ` +
    `Eingriff durch ${z3(z.eingriffDurch)} | park ${z3(z.parkungen)} | ` +
    `diff-geaendert ${z.diffGeaendert} | ` +
    `Aufwand: Text ${z.text} (frueher ${z.textFrueher}), Abstand ${z.abstand}, ` +
    `${(z.ms / Math.max(1, z.n)).toFixed(1)} ms/Lauf` +
    (z.loeschLauf > 0 ? ' | ' + kausalzeile(z) : '')
  );
}

// Die Zerlegung als eigene Zeile — sie steht nur, wo ueberhaupt geloescht wurde.
export function kausalzeile(z: Zellwerte): string {
  const p = (x: number, von: number): string =>
    von === 0 ? '  0,0 %' : `${((x / von) * 100).toFixed(1).padStart(5)} %`;
  return (
    `Loeschlaeufe ${z.loeschLauf} | kausal danach ${z3(z.kannteFremd)} ` +
    `(sah .md ${z3(z.sahFremdMd)}, im Doc ${z3(z.fremdImDoc)}) | ` +
    `WIEDER ${z3(z.wieder)} (${p(z.wieder, z.loeschLauf)}) = ` +
    `FEHLERHAFT ${z3(z.wiederKausal)} + legitim ${z3(z.wiederNebenlaeufig)} | ` +
    `schwaechere Definition: davon sah .md ${z3(z.wiederSahMd)}, im Doc ${z3(z.wiederImDoc)}`
  );
}
