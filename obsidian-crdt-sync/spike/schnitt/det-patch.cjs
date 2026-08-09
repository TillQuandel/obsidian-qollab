// UEBERHOLT seit 2026-08-09 — nicht mehr benutzen. `bilanz-n.mjs` hat jetzt
// `SPIKE_DET=<seed>`, das BEIDE Quellen festlegt (clientID ueber
// `lib0/webcrypto` aus `zufall-quelle.ts`, GUID ueber `globalThis.crypto`).
// Diese Datei deckt nur die GUID-Quelle ab und laesst die clientID streuen; sie
// bleibt ausschliesslich als Beleg der Gegenprobe vom 2026-08-09 liegen, auf die
// sich `grundtext-n-2026-08-09.md` beruft.
//
// Preload, das die EINZIGE Zufallsquelle des Messaufbaus stillegt.
//
// Befund 2026-08-09: `bilanz-n.mjs` liefert bei identischem Aufruf
// unterschiedliche Zahlen. Der Apparat selbst enthaelt keinen Zufall (kein
// `Math.random`, kein `Date.now`) — die Streuung stammt aus dem GEMESSENEN
// Produktivcode: `generateGuid` in `state-file.ts` zieht `crypto.getRandomValues`.
// Jeder Lauf bekommt also andere Inkarnations-GUIDs, und die entscheiden mit,
// welche Kette bei einem Erstkontakt gewinnt.
//
// Aufruf:  node --require ./det-patch.cjs bilanz-n.mjs S0real 3 40 800 900
//          DET_SEED=<zahl> waehlt die Folge; gleicher Seed = gleiche Folge.
//
// Zweck ist die GEGENPROBE, nicht die Messung: Bleibt die Zahl mit festem Seed
// ueber Wiederholungen stehen und aendert sie sich mit dem Seed, ist die
// Streuungsursache belegt. Fuer die eigentliche Messung bleibt der Zufall an —
// zufaellige GUIDs sind das realistische Verhalten.
let s = (Number(process.env.DET_SEED) || 0x9e3779b9) >>> 0;
function next() {
  s ^= s << 13; s >>>= 0;
  s ^= s >> 17;
  s ^= s << 5; s >>>= 0;
  return s;
}

const echt = globalThis.crypto;
Object.defineProperty(globalThis, 'crypto', {
  configurable: true,
  writable: true,
  value: {
    __echt: echt,
    getRandomValues(arr) {
      for (let i = 0; i < arr.length; i++) arr[i] = next() & 0xff;
      return arr;
    },
  },
});
