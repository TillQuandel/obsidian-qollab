// Die Literaturbefunde am eigenen Merge nachgemessen.
//
//   SPIKE_BUNDLE=./real-neu.cjs node probe-idempotenz-breit.mjs [seeds]
//
// Quelle der Hypothesen: Khanna/Kunal/Pierce, „A Formal Investigation of Diff3",
// FSTTCS 2007 (https://www.cis.upenn.edu/~bcpierce/papers/diff3-short.pdf).
// Dort ist FORMAL BEWIESEN:
//   - Fact 4.2.2: diff3 ist NICHT idempotent. Das Gegenbeispiel dupliziert einen
//     Block beim erneuten Mergen — und zwar OHNE dass eine Fassung die andere
//     vollstaendig enthaelt. Genau darauf prueft unser Idempotenz-Zweig.
//   - 4.3: Verschiebt jede Seite denselben Block, steht er im Ergebnis ZWEIMAL,
//     und die Divergenz waechst.
//
// Beides ist hier NICHT nachgebaut, sondern an unserem Verfahren gemessen:
//   (1) Breite Idempotenz: erg = merge(base, local, other); wird erg erneut als
//       `other` eingesetzt, muss dasselbe herauskommen.
//   (2) Verschobene Bloecke: eine Seite verschiebt einen Absatz, die andere
//       aendert woanders. Steht der Absatz danach genau einmal da?
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const R = require(process.env.SPIKE_BUNDLE ?? './real-neu.cjs');
const merge = R.threeWayMerge;

const SEEDS = Number(process.argv[2] ?? 2000);

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

const grundzeilen = Array.from({ length: 8 }, (_, k) => `n0-base-${k}`);
const base = grundzeilen.join('\n') + '\n';

function bearbeite(r, dev, anzahl) {
  const zeilen = [...grundzeilen];
  for (let i = 0; i < anzahl; i++) {
    const t = `n0-D${dev}-${Math.floor(r() * 10)}`;
    const pos = Math.floor(r() * (zeilen.length + 1));
    if (r() < 0.5 || pos >= zeilen.length) zeilen.splice(pos, 0, t);
    else zeilen[pos] = zeilen[pos] + '|' + t;
  }
  return zeilen.join('\n') + '\n';
}

// (1) Breite Idempotenz -----------------------------------------------------
let nichtIdempotent = 0;
let gewachsen = 0;
const beispiele = [];
for (let seed = 1; seed <= SEEDS; seed++) {
  const r = rng(seed * 0x9e3779b1);
  const L = bearbeite(r, 0, 1 + Math.floor(r() * 3));
  const O = bearbeite(r, 1, 1 + Math.floor(r() * 3));
  const e1 = merge(base, L, O);
  const e2 = merge(base, L, e1);
  if (e1 !== e2) {
    nichtIdempotent++;
    if (e2.length > e1.length) gewachsen++;
    if (beispiele.length < 2) {
      beispiele.push(
        `  [seed=${seed}] erneutes Mergen aendert das Ergebnis (${e1.length} -> ${e2.length} Zeichen)\n` +
        `    local = ${JSON.stringify(L)}\n` +
        `    other = ${JSON.stringify(O)}\n` +
        `    e1    = ${JSON.stringify(e1)}\n` +
        `    e2    = ${JSON.stringify(e2)}`
      );
    }
  }
}
for (const b of beispiele) console.log(b);
console.log(
  `== (1) Idempotenz, ${SEEDS} Seeds: nicht idempotent = ${nichtIdempotent} ` +
  `(${((nichtIdempotent / SEEDS) * 100).toFixed(1)} %), davon gewachsen = ${gewachsen}`
);

// (2) Verschobene Bloecke ---------------------------------------------------
// `local` verschiebt einen Dreierblock ans Ende, `other` aendert eine ganz
// andere Zeile. Der Block darf danach genau EINMAL dastehen.
let blockDoppelt = 0;
let blockWeg = 0;
for (let seed = 1; seed <= SEEDS; seed++) {
  const r = rng(seed * 0x51ed2701);
  const von = Math.floor(r() * 4);
  const block = grundzeilen.slice(von, von + 3);
  const rest = [...grundzeilen.slice(0, von), ...grundzeilen.slice(von + 3)];
  const local = [...rest, ...block].join('\n') + '\n';
  // `other` ergaenzt eine Zeile, die NICHT im verschobenen Block liegt.
  const zielIdx = rest.length > 0 ? Math.floor(r() * rest.length) : 0;
  const anders = [...rest];
  anders[zielIdx] = anders[zielIdx] + '|n0-D1-x';
  const other = [...anders.slice(0, von), ...block, ...anders.slice(von)].join('\n') + '\n';

  const erg = merge(base, local, other);
  for (const z of block) {
    const n = erg.split('\n').filter((l) => l === z).length;
    if (n > 1) blockDoppelt++;
    if (n === 0) blockWeg++;
  }
}
console.log(
  `== (2) Verschobene Bloecke, ${SEEDS} Seeds x 3 Zeilen: ` +
  `doppelt = ${blockDoppelt}, verschwunden = ${blockWeg}`
);
