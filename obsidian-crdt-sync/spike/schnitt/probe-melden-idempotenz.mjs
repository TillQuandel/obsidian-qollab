// Stapelt sich der gemeldete Block, wenn mehrere Geraete denselben Hunk
// unabhaengig verwerfen? OHNE Harness, nur `threeWayMerge`.
//
//   SPIKE_BUNDLE=./real-neu.cjs SPIKE_PATCH=melden-voll node probe-melden-idempotenz.mjs
//
// Genau diese Frage hat die letzte Schadensklasse getragen: Eine Ersetzung, die
// EINZELN harmlos ist, wird toedlich, sobald mehrere Replikate sie unabhaengig
// rechnen und die Haelften sich stapeln (`base` -> `basebase` -> `basebasebase`,
// siehe `probe-idempotenz.mjs`). Fuer die Meldung gilt dieselbe Pruefung, und
// sie muss VOR einem Einbau beantwortet sein.
//
// Zwei Faelle:
//   A  Zwei Geraete rechnen denselben Merge unabhaengig auf demselben `other`.
//      Beide melden. Konvergieren die Ergebnisse, steht der Block einmal.
//   B  Ein zweites Geraet rechnet den Merge auf dem ERGEBNIS des ersten — der
//      Block ist dort schon Text. Waechst er dann ein zweites Mal?
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const R = require(process.env.SPIKE_BUNDLE ?? './real-neu.cjs');
const PS = await import('./patchsonde.mjs');
const VAR = process.env.SPIKE_PATCH ?? 'melden-voll';
PS.sondeInstalliere(VAR);

const MARKE = 'nicht einsortierbare lokale Aenderung';
const zaehleMarken = (t) => t.split(MARKE).length - 1;

// Ein Tripel, das den Verwurf sicher ausloest: der Kontext des lokalen Hunks
// kehrt in `other` nicht zeichengleich wieder.
const base = ['n0-base-0', 'n0-base-1', 'n0-base-2', 'n0-base-3'].join('\n') + '\n';
const local = ['n0-base-0', 'n0-D0-1', 'n0-base-1', 'n0-base-2', 'n0-base-3'].join('\n') + '\n';
const other = ['n0-base-0|n0-D1-9', 'n0-base-1|n0-D1-4', 'n0-base-2', 'n0-base-3'].join('\n') + '\n';

const a1 = R.threeWayMerge(base, local, other);
const a2 = R.threeWayMerge(base, local, other);

console.log(`variante=${VAR}`);
console.log(`  Fall A  zwei Geraete, derselbe Merge:`);
console.log(`     gleich?      ${a1 === a2 ? 'ja' : 'NEIN'}`);
console.log(`     Marken       ${zaehleMarken(a1)}`);

// Fall B: das zweite Geraet sieht das Ergebnis des ersten als `other`.
const b = R.threeWayMerge(base, local, a1);
console.log(`  Fall B  Merge auf dem Ergebnis des ersten:`);
console.log(`     Marken       ${zaehleMarken(b)}  (Fall A hatte ${zaehleMarken(a1)})`);
console.log(`     gewachsen?   ${b.length > a1.length ? `JA  ${a1.length} -> ${b.length}` : 'nein'}`);

// Und noch eine Runde — stapelt es sich weiter?
const c = R.threeWayMerge(base, local, b);
console.log(`  dritte Runde:`);
console.log(`     Marken       ${zaehleMarken(c)}`);
console.log(`     Laenge       ${c.length}`);
console.log(`  Grundtext vollstaendig in der dritten Runde? ` +
  `${base.trim().split('\n').every((z) => c.includes(z)) ? 'ja' : 'NEIN'}`);
console.log(`  lokales Token da? ${c.includes('n0-D0-1') ? 'ja' : 'NEIN'}`);
console.log(`\n  a1 = ${JSON.stringify(a1)}`);
console.log(`  b  = ${JSON.stringify(b)}`);
