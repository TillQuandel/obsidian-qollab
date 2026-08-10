// Verliert `threeWayMerge` Grundtext — OHNE Harness, ohne Transport, ohne CRDT?
//
//   SPIKE_BUNDLE=./real-neu.cjs node probe-fuzz.mjs [seeds]
//
// Geprueft wird ausschliesslich `threeWayMerge(base, local, other)` aus
// src/text-merge.ts. Ein kleiner Suchlauf erzeugt Tripel aus derselben
// Zeilen-Grammatik, die der Harness benutzt (`n0-base-k` als Grundtext,
// `n0-Dx-y` als Bearbeitungen), und prueft danach genau zwei Dinge:
//
//   WEG      eine GRUNDTEXTZEILE, die base, local UND other alle drei tragen,
//            fehlt im Ergebnis. Das ist K.o.-Kriterium 1 — niemand hat sie
//            angefasst.
//   LOKALWEG ein Token, das NUR local eingefuegt hat, fehlt im Ergebnis. Das ist
//            der stille Verwurf: die lokale Bearbeitung ist ohne Meldung weg.
//
// Die beiden Zahlen sind der ganze Trade-off. Eine Variante, die WEG senkt und
// LOKALWEG hebt, tauscht nur die Schadensart.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const R = require(process.env.SPIKE_BUNDLE ?? './real-neu.cjs');
const PS = await import('./patchsonde.mjs');
PS.sondeInstalliere(process.env.SPIKE_PATCH ?? 'bestand');

const SEEDS = Number(process.argv[2] ?? 2000);
const ZEIGE = Number(process.env.ZEIGE ?? 3);

// Deterministischer PRNG — der Lauf muss wiederholbar sein.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const BASIS_N = 8;
const grundzeilen = Array.from({ length: BASIS_N }, (_, k) => `n0-base-${k}`);
const base = grundzeilen.join('\n') + '\n';

// Eine Bearbeitung: `anzahl` Tokens an zufaellige Zeilenpositionen einfuegen.
// `dev` unterscheidet die Geraete, damit die Tokens sich nicht zufaellig decken.
function bearbeite(r, dev, anzahl) {
  const zeilen = [...grundzeilen];
  const tokens = [];
  for (let i = 0; i < anzahl; i++) {
    const t = `n0-D${dev}-${Math.floor(r() * 10)}`;
    tokens.push(t);
    const pos = Math.floor(r() * (zeilen.length + 1));
    // Haelfte der Faelle: eigene Zeile. Andere Haelfte: an eine bestehende Zeile
    // ANGEHAENGT — das erzeugt den Fall, in dem eine Grundtextzeile ihren
    // Wortlaut aendert und der Patch-Kontext nicht mehr exakt wiederkehrt.
    if (r() < 0.5 || pos >= zeilen.length) zeilen.splice(pos, 0, t);
    else zeilen[pos] = zeilen[pos] + '|' + t;
  }
  return { text: zeilen.join('\n') + '\n', tokens };
}

let weg = 0;
let lokalWeg = 0;
let gezeigt = 0;
const beispiele = [];

for (let seed = 1; seed <= SEEDS; seed++) {
  const r = rng(seed * 0x9e3779b1);
  const L = bearbeite(r, 0, 1 + Math.floor(r() * 3));
  const O = bearbeite(r, 1, 1 + Math.floor(r() * 3));
  const erg = R.threeWayMerge(base, L.text, O.text);
  const da = erg.split('\n');

  // Grundtextzeilen, die alle drei Staende UNVERAENDERT tragen — sie duerfen
  // unter keinen Umstaenden verschwinden.
  const unberuehrt = grundzeilen.filter(
    (z) => L.text.split('\n').includes(z) && O.text.split('\n').includes(z)
  );
  const fehlend = unberuehrt.filter((z) => !da.includes(z));

  // Tokens, die NUR local kennt. Fehlen sie, hat der Patch sie still verworfen.
  const nurLokal = L.tokens.filter((t) => !O.text.includes(t));
  const lokalFehlt = nurLokal.filter((t) => !erg.includes(t));

  if (fehlend.length) weg += fehlend.length;
  if (lokalFehlt.length) lokalWeg += lokalFehlt.length;

  if (lokalFehlt.length && process.env.ZEIGE_LOKAL && gezeigt < ZEIGE) {
    gezeigt++;
    beispiele.push(
      `  [seed=${seed}] LOKAL fehlt: ${lokalFehlt.join(', ')}\n` +
      `    local = ${JSON.stringify(L.text)}\n` +
      `    other = ${JSON.stringify(O.text)}\n` +
      `    erg   = ${JSON.stringify(erg)}`
    );
  }
  if (fehlend.length && gezeigt < ZEIGE) {
    gezeigt++;
    beispiele.push(
      `  [seed=${seed}] fehlt: ${fehlend.join(', ')}\n` +
      `    base  = ${JSON.stringify(base)}\n` +
      `    local = ${JSON.stringify(L.text)}\n` +
      `    other = ${JSON.stringify(O.text)}\n` +
      `    erg   = ${JSON.stringify(erg)}`
    );
  }
}

for (const b of beispiele) console.log(b);
console.log(
  `== probe-fuzz patch=${process.env.SPIKE_PATCH ?? 'bestand'} seeds=${SEEDS}` +
  `: WEG=${weg} LOKALWEG=${lokalWeg} | ${PS.sondeZeile()}`
);
