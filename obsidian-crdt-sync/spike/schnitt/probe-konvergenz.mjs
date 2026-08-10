// Konvergieren mehrere Peers, wenn jeder in EIGENER Reihenfolge mergt?
//
//   SPIKE_BUNDLE=./real-neu.cjs node probe-konvergenz.mjs [seeds]
//
// Das ist die Frage, an der ein Merge-Verfahren fuer „zwei oder mehr" steht oder
// faellt. `docs/produktziel.md` Gruppe 1 verlangt: „Alle Beteiligten enden mit
// demselben Text." Bei N Geraeten trifft jedes die Beitraege in anderer
// Reihenfolge — kommt dabei derselbe Text heraus?
//
// Formal ist das die ASSOZIATIVITAET des Merges. Fuer diff3 ist sie NICHT
// selbstverstaendlich; diese Probe misst sie an unserem konkreten Verfahren,
// statt sie anzunehmen.
//
// Aufbau: Eine Basis, drei unabhaengige Bearbeitungen A, B, C. Verglichen werden
// alle sinnvollen Klammerungen:
//     ((A,B),C)   ((A,C),B)   ((B,C),A)
// Alle drei muessen zeichengleich sein.
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

let ungleich = 0;
let grundWeg = 0;
const beispiele = [];

for (let seed = 1; seed <= SEEDS; seed++) {
  const r = rng(seed * 0x9e3779b1);
  const A = bearbeite(r, 0, 1 + Math.floor(r() * 2));
  const B = bearbeite(r, 1, 1 + Math.floor(r() * 2));
  const C = bearbeite(r, 2, 1 + Math.floor(r() * 2));

  // Jedes Geraet mergt die beiden fremden Beitraege in eigener Reihenfolge.
  const ab = merge(base, A, B);
  const abc = merge(base, ab, C);
  const ac = merge(base, A, C);
  const acb = merge(base, ac, B);
  const bc = merge(base, B, C);
  const bca = merge(base, bc, A);

  const alle = [abc, acb, bca];
  if (new Set(alle).size > 1) {
    ungleich++;
    if (beispiele.length < 2) {
      beispiele.push(
        `  [seed=${seed}] drei Reihenfolgen, ${new Set(alle).size} verschiedene Ergebnisse\n` +
        `    A   = ${JSON.stringify(A)}\n` +
        `    B   = ${JSON.stringify(B)}\n` +
        `    C   = ${JSON.stringify(C)}\n` +
        `    ABC = ${JSON.stringify(abc)}\n` +
        `    ACB = ${JSON.stringify(acb)}\n` +
        `    BCA = ${JSON.stringify(bca)}`
      );
    }
  }
  // Und faellt dabei Grundtext weg, den alle drei unveraendert tragen?
  const unberuehrt = grundzeilen.filter(
    (z) => A.split('\n').includes(z) && B.split('\n').includes(z) && C.split('\n').includes(z)
  );
  for (const erg of alle) {
    const da = erg.split('\n');
    grundWeg += unberuehrt.filter((z) => !da.includes(z)).length;
  }
}

for (const b of beispiele) console.log(b);
console.log(
  `== probe-konvergenz seeds=${SEEDS}: ` +
  `Reihenfolgen mit ABWEICHUNG = ${ungleich} (${((ungleich / SEEDS) * 100).toFixed(1)} %), ` +
  `Grundtext weg = ${grundWeg}`
);
