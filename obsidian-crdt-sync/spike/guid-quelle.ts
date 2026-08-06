// Deterministische Inkarnations-Kennungen.
//
// `generateGuid` (state-file.ts) zieht aus `crypto.getRandomValues`. Der Spike
// ersetzt genau diese Quelle — kein Eingriff in `src/`, und die Kennungen bleiben
// echte 16-Byte-Werte, die durch den unveraenderten Encoder laufen.
//
// Zweck: gleicher Seed => gleiche Kennungsfolge => gleicher Tie-Break-Ausgang in
// ALLEN Varianten. Ohne das waere jede gepaarte Messung wertlos.

const echt = (globalThis as any).crypto?.getRandomValues?.bind((globalThis as any).crypto);

let queue: string[] = [];
let zaehler = 0;

// Feste Folge von Hex-Kennungen (32 Zeichen). Danach wird deterministisch
// weitergezaehlt.
export function setzeGuidFolge(hex: string[]): void {
  queue = [...hex];
  zaehler = 0;
}

export function guidQuelleAn(): void {
  (globalThis as any).crypto.getRandomValues = (arr: Uint8Array) => {
    const hex =
      queue.length > 0
        ? queue.shift()!
        : (zaehler++).toString(16).padStart(2, '0').repeat(16).slice(0, 32);
    for (let i = 0; i < arr.length; i++) {
      arr[i] = i < 16 ? parseInt(hex.slice(i * 2, i * 2 + 2), 16) : 0;
    }
    return arr;
  };
}

export function guidQuelleAus(): void {
  if (echt) (globalThis as any).crypto.getRandomValues = echt;
}
