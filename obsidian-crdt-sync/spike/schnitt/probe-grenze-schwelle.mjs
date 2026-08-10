// WO GENAU kollabiert `diff_linesToChars_`? `probe-grenze.mjs` zeigt den Kollaps
// an drei Stuetzstellen (39.000 / 40.001 / 45.000); diese Probe sucht die Kante
// exakt, weil die Schwelle im Produktivcode daraus abgeleitet wird.
//
// Gemessen wird auf der Groesse, die die Bibliothek zaehlt: der Zahl der
// VERSCHIEDENEN Zeilen. Deshalb zwei Reihen —
//   A) alle Zeilen verschieden  (verschieden == gesamt)
//   B) gesamt konstant 45.000, aber nur `D` davon verschieden (der Rest ist eine
//      Wiederholung). Kollabiert B an derselben Stelle wie A, ist belegt, dass
//      die Bibliothek an VERSCHIEDENEN und nicht an GESAMT-Zeilen bricht.
//
// Kollaps-Kriterium ohne Blick in die Bibliothek: `chars1` hat ein Zeichen je
// Zeile. Ist `chars1.length` kleiner als die Zeilenzahl, deckt mindestens ein
// Token mehr als eine Zeile — genau das ist der Kollaps.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { diff_match_patch } = require('diff-match-patch');
const dmp = new diff_match_patch();

// L Zeilen, davon `verschieden` verschiedene (die uebrigen wiederholen Zeile 0).
function text(L, verschieden = L) {
  const z = [];
  for (let i = 0; i < L; i++) z.push(i < verschieden ? `n0-base-${i}` : 'n0-base-0');
  return z.join('\n') + '\n';
}
const zeilen = (t) => t.split('\n').length - 1; // Text endet auf \n

function messe(t) {
  const x = dmp.diff_linesToChars_(t, t);
  const n = zeilen(t);
  return { n, chars1: x.chars1.length, kollabiert: x.chars1.length < n };
}

console.log('Reihe A — alle Zeilen verschieden');
console.log('gesamt | verschieden | chars1 | kollabiert');
for (const L of [39998, 39999, 40000, 40001, 40002, 40003]) {
  const r = messe(text(L));
  console.log(
    `${String(L).padStart(6)} | ${String(L).padStart(11)} | ${String(r.chars1).padStart(6)} | ${r.kollabiert}`
  );
}

console.log('');
console.log('Reihe B — gesamt konstant 45.000, verschieden variiert');
console.log('gesamt | verschieden | chars1 | kollabiert');
for (const D of [39998, 39999, 40000, 40001, 40002, 45000]) {
  const r = messe(text(45000, D));
  console.log(
    `${String(45000).padStart(6)} | ${String(D).padStart(11)} | ${String(r.chars1).padStart(6)} | ${r.kollabiert}`
  );
}
