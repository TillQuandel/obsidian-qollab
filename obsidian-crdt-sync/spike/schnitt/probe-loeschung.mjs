// Warum faellt die LOESCHUNG aus? Der Fall aus `sweep-schranke-basiswahl.test.ts`,
// harness-frei nachgestellt.
//
//   node probe-loeschung.mjs
//
// Lage (aus dem Testlauf getract, nicht konstruiert):
//   base  = Titel / FREMD-EDIT / Zeile A / Zeile B
//   local = Titel / FREMD-EDIT / Zeile A            -> der Patch LOESCHT `Zeile B`
//   other = Titel / FREMD-EDIT / Zeile A / Zeile B / EIGEN-EDIT
//
// Erwartet: `Zeile B` verschwindet, `EIGEN-EDIT` bleibt. Der Umbau lieferte
// stattdessen `angewandt=[false]` — die geloeschte Zeile kam zurueck. Die Frage
// ist, WORAN das liegt: an `patch_apply` (findet den Hunk nicht) oder an der
// Schadenspruefung (haelt ihn faelschlich fuer gefaehrlich).
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { diff_match_patch } = require('diff-match-patch');

const base = 'Titel\nFREMD-EDIT\nZeile A\nZeile B\n';
const local = 'Titel\nFREMD-EDIT\nZeile A\n';
const other = 'Titel\nFREMD-EDIT\nZeile A\nZeile B\nEIGEN-EDIT\n';

const TOKEN_BASIS = 8;
function tokenisiere(texte) {
  const index = new Map();
  const zeilen = [];
  const chars = texte.map((t) => {
    let aus = '';
    for (const zeile of t.split('\n').slice(0, -1).map((l) => l + '\n')) {
      let i = index.get(zeile);
      if (i === undefined) { i = zeilen.length; zeilen.push(zeile); index.set(zeile, i); }
      aus += String.fromCharCode(i + TOKEN_BASIS);
    }
    return aus;
  });
  return { chars, zeilen };
}
const tok = tokenisiere([base, local, other]);
const [a, b, c] = tok.chars;
const zurueck = (s) => Array.from(s, (ch) => tok.zeilen[ch.charCodeAt(0) - TOKEN_BASIS] ?? '').join('');

const dmp = new diff_match_patch();
const patches = dmp.patch_make(a, b);

console.log(`Tokens: ${tok.zeilen.map((z, i) => `${i + TOKEN_BASIS}=${JSON.stringify(z)}`).join('  ')}`);
console.log(`a(base)=${JSON.stringify(a)}  b(local)=${JSON.stringify(b)}  c(other)=${JSON.stringify(c)}`);
console.log(`Hunks: ${patches.length}`);
for (const p of patches) {
  console.log(`  start1=${p.start1} start2=${p.start2} len1=${p.length1} len2=${p.length2}`);
  console.log(`  diffs=${JSON.stringify(p.diffs)}`);
}

// (1) Alle Hunks auf einmal — so macht es die Bibliothek.
const [gesamt, okGesamt] = dmp.patch_apply(dmp.patch_deepCopy(patches), c);
console.log(`\n(1) alle auf einmal:  ok=${JSON.stringify(okGesamt)}  erg=${JSON.stringify(zurueck(gesamt))}`);

// (2) Hunk fuer Hunk — so machte es der Umbau.
let text = c;
const okEinzeln = [];
for (const p of patches) {
  const [neu, ok] = dmp.patch_apply(dmp.patch_deepCopy([p]), text);
  okEinzeln.push(ok[0]);
  if (ok[0]) text = neu;
}
console.log(`(2) Hunk fuer Hunk:   ok=${JSON.stringify(okEinzeln)}  erg=${JSON.stringify(zurueck(text))}`);

// (3) Und was sagt die Schadenspruefung zum Ergebnis aus (1)?
const zaehle = (s) => { const m = new Map(); for (const ch of s) m.set(ch, (m.get(ch) ?? 0) + 1); return m; };
function reisstMit(hunk, vorherC, nachherC) {
  const darfWeg = zaehle(hunk.diffs.filter(([op]) => op === -1).map(([, t]) => t).join(''));
  const vorher = zaehle(vorherC);
  const nachher = zaehle(nachherC);
  for (const [t, hatte] of vorher) {
    const blieb = nachher.get(t) ?? 0;
    if (blieb >= hatte) continue;
    if (hatte - blieb > (darfWeg.get(t) ?? 0)) return true;
  }
  return false;
}
console.log(`(3) reisstMit(hunk0, c, gesamt) = ${reisstMit(patches[0], c, gesamt)}`);
console.log(`\nERWARTET: Zeile B weg, EIGEN-EDIT bleibt`);
