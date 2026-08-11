// WARUM DIESE DATEI: Die Frage „wie viel der Verdopplung entsteht in
// `unionMerge`?" laesst sich am Endzustand nicht beantworten — die Metrik in
// `spike/schnitt/harness.mjs:176` zaehlt erst, was am Ende dasteht. Gebraucht
// wird eine Zaehlung AM ORT: bei jedem Aufruf von `unionMerge` bzw.
// `threeWayMerge` messen, wie viele Zeilen im Ergebnis oefter stehen als in
// BEIDEN Eingaben.
//
// Der Produktivcode bleibt unangetastet (`src/` wird nicht editiert): diese
// Datei importiert `src/text-merge` und reicht alles durch; nur die beiden
// Merge-Funktionen bekommen eine Zaehlhuelle. `bauen.mjs` haengt sie per
// esbuild-Plugin an die Stelle, an der `sync-handler.ts` sein `./text-merge`
// aufloest — der gebuendelte Produktivcode ruft danach die Huelle statt des
// Originals, ohne dass eine Zeile in `src/` anders lautet.
//
// MESSGROESSE `neuDup`: je Zeile max(0, n_aus - max(n_other, n_local)). Also
// genau die Vorkommen, die im Ergebnis stehen und in KEINER Eingabe so oft
// vorkamen — das, was die Vereinigung selbst erzeugt hat. `dupDelta` ist die
// Zunahme der Zeilen-Mehrfachnennungen gegenueber dem lokalen Stand; sie ist
// naeher an der Endzustands-Metrik, zaehlt aber Weiterreichen mit.
import * as echt from '../../src/text-merge';

export { vergleichsfassung, insertedTexts } from '../../src/text-merge';

type Zaehlwerk = {
  unionRuf: number;
  unionUnveraendert: number;
  unionNeuDup: number;
  unionDupDelta: number;
  unionZeilenPlus: number;
  dreiRuf: number;
  dreiUnveraendert: number;
  dreiNeuDup: number;
  dreiDupDelta: number;
};

const leer = (): Zaehlwerk => ({
  unionRuf: 0,
  unionUnveraendert: 0,
  unionNeuDup: 0,
  unionDupDelta: 0,
  unionZeilenPlus: 0,
  dreiRuf: 0,
  dreiUnveraendert: 0,
  dreiNeuDup: 0,
  dreiDupDelta: 0,
});

const g = globalThis as unknown as { __qzaehl?: Zaehlwerk; __qzaehlReset?: () => void };
if (!g.__qzaehl) g.__qzaehl = leer();
g.__qzaehlReset = () => {
  g.__qzaehl = leer();
};

// Ausgabe am Prozessende, damit der bestehende Treiber `spike/schnitt/mehrfach.mjs`
// unveraendert bleibt: er wird nur mit SPIKE_BUNDLE auf diesen Bau gezeigt, die
// Zaehlzeile haengt sich selbst an. Die Summen laufen ueber ALLE Seeds der Zelle.
if (typeof process !== 'undefined' && process.env?.QZAEHL_PRINT === '1') {
  process.on('exit', () => {
    const z = g.__qzaehl!;
    console.log(
      `## zaehl union: ruf=${z.unionRuf} unveraendert=${z.unionUnveraendert}` +
        ` neuDup=${z.unionNeuDup} dupDelta=${z.unionDupDelta} zeilenPlus=${z.unionZeilenPlus}` +
        ` | dreiwege: ruf=${z.dreiRuf} unveraendert=${z.dreiUnveraendert}` +
        ` neuDup=${z.dreiNeuDup} dupDelta=${z.dreiDupDelta}`
    );
  });
}

// Zeilen -> Vorkommenszahl. Leerzeilen bleiben draussen, genau wie in der
// Endzustands-Metrik (`harness.mjs:188`), sonst zaehlt der Abschluss-Umbruch mit.
function zaehle(text: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const roh of text.split('\n')) {
    const z = roh.endsWith('\r') ? roh.slice(0, -1) : roh;
    if (z.length === 0) continue;
    m.set(z, (m.get(z) ?? 0) + 1);
  }
  return m;
}

// Mehrfachnennungen insgesamt: Summe (n - 1) ueber alle Zeilen mit n > 1.
function mehrfach(m: Map<string, number>): number {
  let s = 0;
  for (const n of m.values()) if (n > 1) s += n - 1;
  return s;
}

function ueberschuss(aus: Map<string, number>, a: Map<string, number>, b: Map<string, number>): number {
  let s = 0;
  for (const [z, n] of aus) {
    const grenze = Math.max(a.get(z) ?? 0, b.get(z) ?? 0);
    if (n > grenze) s += n - grenze;
  }
  return s;
}

// GEGENPROBE (QZAEHL_UNION=dedup): dieselbe Vereinigung, aber ohne die
// Vorkommen, die sie SELBST erzeugt hat — jede Zeile darf hoechstens so oft
// stehen, wie sie in `other` oder `local` schon stand. Das ist keine
// Fix-Kandidatur, sondern der Differenzarm: faellt die Endzustands-Verdopplung
// dadurch, stammt sie aus dieser Funktion; faellt sie nicht, stammt sie
// woanders her.
function entdopple(aus: string, mO: Map<string, number>, mL: Map<string, number>): string {
  const lauf = new Map<string, number>();
  const raus: string[] = [];
  for (const roh of aus.split('\n')) {
    const z = roh.endsWith('\r') ? roh.slice(0, -1) : roh;
    if (z.length === 0) {
      raus.push(roh);
      continue;
    }
    const n = (lauf.get(z) ?? 0) + 1;
    const grenze = Math.max(mO.get(z) ?? 0, mL.get(z) ?? 0);
    if (n > grenze) continue;
    lauf.set(z, n);
    raus.push(roh);
  }
  return raus.join('\n');
}

const unionArm = typeof process !== 'undefined' ? process.env?.QZAEHL_UNION ?? 'bestand' : 'bestand';

export function unionMerge(other: string, local: string): string {
  let erg = echt.unionMerge(other, local);
  const z = g.__qzaehl!;
  z.unionRuf++;
  if (unionArm === 'dedup' && erg !== local) {
    erg = entdopple(erg, zaehle(other), zaehle(local));
  }
  if (erg === local) {
    z.unionUnveraendert++;
    return erg;
  }
  const mO = zaehle(other);
  const mL = zaehle(local);
  const mA = zaehle(erg);
  z.unionNeuDup += ueberschuss(mA, mO, mL);
  z.unionDupDelta += mehrfach(mA) - mehrfach(mL);
  let plus = 0;
  for (const n of mA.values()) plus += n;
  for (const n of mL.values()) plus -= n;
  z.unionZeilenPlus += plus;
  return erg;
}

export function threeWayMerge(base: string, local: string, other: string): string {
  const erg = echt.threeWayMerge(base, local, other);
  const z = g.__qzaehl!;
  z.dreiRuf++;
  if (erg === local) {
    z.dreiUnveraendert++;
    return erg;
  }
  const mB = zaehle(base);
  const mL = zaehle(local);
  const mO = zaehle(other);
  const mA = zaehle(erg);
  // Bei drei Eingaben ist die Grenze das Maximum ueber alle drei.
  const mMax = new Map<string, number>();
  for (const m of [mB, mL, mO]) for (const [k, v] of m) mMax.set(k, Math.max(mMax.get(k) ?? 0, v));
  z.dreiNeuDup += ueberschuss(mA, mMax, mMax);
  z.dreiDupDelta += mehrfach(mA) - mehrfach(mL);
  return erg;
}
