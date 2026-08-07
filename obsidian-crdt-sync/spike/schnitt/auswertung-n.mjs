// Wertet `ergebnis-grundtext-n-2026-08-07.txt` aus: je Gerätezahl und Arm die
// Verteilung des strengen Grundtext-Maßes, plus ein Permutationstest zwischen
// den Armen.
//
// Warum eine Verteilung und keine Einzelzahl: `bilanz-n.mjs` ist NICHT
// reproduzierbar. Der Apparat selbst enthält keinen Zufall, der gemessene
// Produktivcode aber zwei Quellen — `generateGuid` (`crypto.getRandomValues`)
// und die `clientID` jedes `Y.Doc` (Yjs zieht sie zufällig). Beide entscheiden
// bei einem Erstkontakt mit, welche Kette gewinnt. Eine Einzelziehung aus
// diesem Instrument ist eine Stichprobe, kein Messwert.
//
//   node auswertung-n.mjs [datei]
import { readFileSync } from 'node:fs';

const datei = process.argv[2] ?? new URL('./ergebnis-grundtext-n-2026-08-07.txt', import.meta.url);
const zeilen = readFileSync(datei, 'utf8').split('\n');

const daten = new Map(); // `${arm}|${N}` -> zahlen[]
let arm = null;
for (const z of zeilen) {
  if (z.startsWith('## ARM')) { arm = z.slice(7).trim(); continue; }
  const m = z.match(/N=(\d+)\s+konvergent.*GRUNDTEXT-WEG=\s*(\d+)/);
  if (!m || !arm) continue;
  const k = `${arm}|${m[1]}`;
  if (!daten.has(k)) daten.set(k, []);
  daten.get(k).push(Number(m[2]));
}

const mittel = (a) => a.reduce((x, y) => x + y, 0) / a.length;

// Permutationstest, zweiseitig, über die Differenz der Mittelwerte. Fester
// Zufallsstrom, damit der Test selbst reproduzierbar ist — anders als das
// Instrument, das er auswertet.
function permTest(a, b, iter = 200000) {
  const beob = Math.abs(mittel(a) - mittel(b));
  const alle = [...a, ...b];
  const nA = a.length;
  let s = 0x2545f491;
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 0x100000000; };
  let mind = 0;
  for (let i = 0; i < iter; i++) {
    const p = alle.slice();
    for (let j = p.length - 1; j > 0; j--) {
      const k = Math.floor(rnd() * (j + 1));
      [p[j], p[k]] = [p[k], p[j]];
    }
    if (Math.abs(mittel(p.slice(0, nA)) - mittel(p.slice(nA))) >= beob - 1e-12) mind++;
  }
  return (mind + 1) / (iter + 1);
}

console.log('Strenger Grundtext-Verlust (Zeilen je Lauf, Zellbasis 40 Seeds x 10 Notizen x 8 Basiszeilen = 3200)\n');
for (const n of ['2', '3', '4']) {
  const a = daten.get(`ALT|${n}`) ?? [];
  const b = daten.get(`NEU|${n}`) ?? [];
  if (!a.length || !b.length) { console.log(`N=${n}: unvollständig`); continue; }
  const p = permTest(a, b);
  console.log(
    `N=${n}` +
    `  ALT n=${a.length} mittel=${mittel(a).toFixed(1)} spanne=${Math.min(...a)}-${Math.max(...a)} nullläufe=${a.filter((x) => x === 0).length}` +
    `  |  NEU n=${b.length} mittel=${mittel(b).toFixed(1)} spanne=${Math.min(...b)}-${Math.max(...b)} nullläufe=${b.filter((x) => x === 0).length}` +
    `  |  p=${p.toFixed(4)}`
  );
  console.log(`      ALT: ${a.join(',')}`);
  console.log(`      NEU: ${b.join(',')}`);
}
