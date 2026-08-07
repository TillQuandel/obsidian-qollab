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
  grundtextWeg: number; // K.O., lockeres Mass (`occ`, Teilstring)
  ganzWeg: number; // K.O., STRENGES Mass (ganze Zeile)
  ganzDoppel: number; // strenge Verdopplung einer GRUNDZEILE
  diffGeaendert: number;
  parkungen: number;
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
  grundtextWeg: 0,
  ganzWeg: 0,
  ganzDoppel: 0,
  diffGeaendert: 0,
  parkungen: 0,
});

// Faehrt dieselbe Konfiguration ueber jede uebergebene Zustellordnung.
export async function messe(
  basis: Omit<Konfig, 'reihenfolge'>,
  ordnungen: number[][]
): Promise<Zellwerte> {
  const z = leer();
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
    if (!e.grundtextDa) z.grundtextWeg++;
    if (!e.grundtextGanzDa) z.ganzWeg++;
    if (e.ganzDoppelt.length > 0) z.ganzDoppel++;
    z.diffGeaendert += e.diffGeaendert;
    z.parkungen += e.parkungen;
  }
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
    `diff-geaendert ${z.diffGeaendert}`
  );
}
