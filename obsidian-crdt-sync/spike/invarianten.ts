// Die Messgroessen. Verlust und Verdopplung werden GETRENNT gezaehlt und BEIDE
// Seiten geprueft — beides sind Lehren aus den Vorarbeiten (eine einseitige
// Pruefung sah einen belegten Verlust nicht, und ein Kategorie-Kurzschluss
// verdeckte Erhalt-Verletzungen hinter „Divergenz").

// Zaehlt Vorkommen von `token`, aber nur dort, wo KEINE Ziffer folgt — sonst
// zaehlte `T1` auch in `T10`.
export function occ(text: string, token: string): number {
  let n = 0;
  let i = 0;
  for (;;) {
    const k = text.indexOf(token, i);
    if (k < 0) break;
    const danach = text[k + token.length];
    if (danach === undefined || !/[0-9]/.test(danach)) n++;
    i = k + token.length;
  }
  return n;
}

export interface Befund {
  divergenz: boolean; // A.md !== B.md
  verlust: string[]; // Tokens, die auf MINDESTENS EINER Seite 0x vorkommen
  doppel: string[]; // Tokens, die auf MINDESTENS EINER Seite >1x vorkommen
  sauber: boolean;
}

export function bewerte(aText: string, bText: string, tokens: string[]): Befund {
  return bewerteN([aText, bText], tokens);
}

// Dieselbe Bewertung fuer BELIEBIG VIELE Geraete — mit dreien gibt es drei Paare,
// und „auf mindestens einer Seite" ist dann eine Aussage ueber drei Texte. Mit
// zwei Texten ist es ziffernweise `bewerte` von oben; es gibt bewusst nur EINE
// Implementierung, damit die Zahlen der Zwei-Geraete-Laeufe unberuehrt bleiben.
export function bewerteN(texte: string[], tokens: string[]): Befund {
  const verlust: string[] = [];
  const doppel: string[] = [];
  for (const t of tokens) {
    const zahlen = texte.map((x) => occ(x, t));
    if (zahlen.some((z) => z === 0)) verlust.push(t);
    if (zahlen.some((z) => z > 1)) doppel.push(t);
  }
  const divergenz = texte.some((x) => x !== texte[0]);
  return {
    divergenz,
    verlust,
    doppel,
    sauber: !divergenz && verlust.length === 0 && doppel.length === 0,
  };
}

export interface Bilanz {
  n: number;
  divergenz: number;
  verlust: number;
  doppel: number;
  sauber: number;
  verlustSeeds: number[];
  doppelSeeds: number[];
}

export function bilanziere(laeufe: Array<{ seed: number; befund: Befund }>): Bilanz {
  const b: Bilanz = {
    n: laeufe.length,
    divergenz: 0,
    verlust: 0,
    doppel: 0,
    sauber: 0,
    verlustSeeds: [],
    doppelSeeds: [],
  };
  for (const { seed, befund } of laeufe) {
    if (befund.divergenz) b.divergenz++;
    if (befund.verlust.length > 0) {
      b.verlust++;
      b.verlustSeeds.push(seed);
    }
    if (befund.doppel.length > 0) {
      b.doppel++;
      b.doppelSeeds.push(seed);
    }
    if (befund.sauber) b.sauber++;
  }
  return b;
}

// mulberry32 — kleiner, deterministischer PRNG. Gleicher Seed => gleiche Op-Folge
// in ALLEN Varianten (die Zahl der Ziehungen haengt nicht an der Variante).
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
