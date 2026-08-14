// t09-adversarial.mjs — Der Versuch, den T-09-Fix zu WIDERLEGEN.
//
// Der Fix (`schlusszeileEntkleben` in src/crdt-manager.ts) formt eine Op-Folge
// um, bevor sie in `setContent` auf den Y.Text angewendet wird. Jede Umformung
// von Ops kann die Positionsrechnung brechen — und ein gebrochener Diff
// verliert Text, ohne dass irgendein Zaehler anschlaegt.
//
// Der letzte Fix dieser Klasse (T-08) war nach ZWEI adversarialen Runden immer
// noch falsch. Beide Fehler waren in Minuten zu finden, sobald jemand gezielt
// dagegen gearbeitet hat. Dieses Instrument arbeitet gezielt dagegen.
//
// ZWEI EIGENSCHAFTEN, gegen beide Fassungen geprueft:
//
//   INVARIANTE  Nach setContent(a) und setContent(b) MUSS getContent() === b
//               sein. Sie gilt im Bestand wie im Fix; bricht sie unter dem Fix,
//               ist er falsch. Das ist der Regressionsschutz - er findet
//               Positionsfehler, die keine Zaehlung sieht.
//
//   WIRKUNG     Zwei Replikate haengen unabhaengig je eine Zeile an. Eine Zeile,
//               die NIEMAND angefasst hat, darf danach nicht doppelt dastehen.
//               Das ist der Unterschied, den der Fix macht.
//
// Der Zufall ist deterministisch (eigener PRNG, fester Seed) — sonst waere ein
// Fund nicht nachstellbar, und genau daran ist in diesem Projekt schon eine
// Kalibrierung gescheitert.
//
// Aufruf (aus obsidian-crdt-sync/):
//   node spike/duplikat-mb/bauen-crdt.mjs
//   node spike/duplikat-mb/t09-adversarial.mjs [<runden>]

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hier = path.dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);
const MIT = require_(path.join(hier, 'crdt.cjs'));
const OHNE = require_(path.join(hier, 'crdt-vor-fix.cjs'));

const NL = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const RUNDEN = Number(process.argv[2] ?? 4000);

// mulberry32 — klein, deterministisch, reicht fuer Textbau.
function prng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Das Alphabet deckt genau die Fallen ab, die ein Reviewer suchen wuerde:
// leere Zeilen, Surrogatpaare (Emoji), CRLF, wiederholte Zeilen (damit ein
// DELETE/INSERT-Paar mitten im Text zufaellig die Laengenbedingung erfuellen
// kann), und Zeilen, die Praefix voneinander sind.
const BAUSTEINE = [
  '',
  'a',
  'ab',
  'abc',
  'abcd',
  'Punkt 1',
  'Punkt 1: lang',
  'x'.repeat(40),
  '\u{1F600}',          // Emoji, Surrogatpaar
  'vor\u{1F600}nach',
  'Zeile' + CR,          // verirrtes CR
  '  eingerueckt',
];

function baueText(r) {
  const n = 1 + Math.floor(r() * 7);
  const zeilen = [];
  for (let i = 0; i < n; i++) zeilen.push(BAUSTEINE[Math.floor(r() * BAUSTEINE.length)]);
  const eol = r() < 0.25 ? CR + NL : NL;
  const text = zeilen.join(eol);
  // In einem Viertel der Faelle MIT Schluss-Umbruch, sonst ohne. Der Fall ohne
  // ist der interessante, deshalb ueberwiegt er.
  return r() < 0.25 ? text + eol : text;
}

function invarianteVerletzt(R, a, b) {
  const c = new R.CrdtManager();
  c.setContent('n.md', a);
  c.setContent('n.md', b);
  const ist = c.getContent('n.md');
  return ist === b ? null : { a, b, ist };
}

// Zwei Replikate haengen unabhaengig an. Rueckgabe: Zeilen, die im Ergebnis
// oefter stehen als in BEIDEN Beitraegen zusammen — also gestapelt wurden,
// obwohl sie niemand angefasst hat.
function stapelung(R, basis) {
  const quelle = new R.CrdtManager();
  quelle.setContent('n.md', basis);
  const saat = quelle.encodeState('n.md');
  const a = new R.CrdtManager();
  const b = new R.CrdtManager();
  a.applyUpdate('n.md', saat);
  b.applyUpdate('n.md', saat);
  const eol = basis.includes(CR + NL) ? CR + NL : NL;
  const anh = (m) => (basis.endsWith(eol) || basis.endsWith(NL) ? basis + m + NL : basis + NL + m);
  a.setContent('n.md', anh('MARKER-A'));
  b.setContent('n.md', anh('MARKER-B'));
  b.applyUpdate('n.md', a.encodeState('n.md'));
  const t = b.getContent('n.md');
  // Die letzte Zeile der Basis hat niemand angefasst.
  //
  // ACHTUNG, hier lag eine Blindstelle. Die erste Fassung zaehlte EXAKTE
  // Zeilen (`split(NL).filter(z => z === letzte)`) und fand nie etwas: Der
  // Schaden verklebt die Zeile mit der naechsten, das Ergebnis heisst dann
  // `B2-...BBB-...` und ist als Zeile ein ANDERER String. Gezaehlt wird
  // deshalb das Vorkommen im Volltext - dieselbe Zaehlweise wie `H-COUNT` im
  // Harness (harness-ext.ps1:477), und genau deshalb sieht die den Schaden.
  const basisZeilen = basis.split(NL).map((z) => z.replace(/\r$/, ''));
  const letzte = basisZeilen[basisZeilen.length - 1];
  if (!letzte) return null;
  const vorkommen = (s, teil) => s.split(teil).length - 1;
  const soll = vorkommen(basis, letzte);
  const ist = vorkommen(t, letzte);
  return ist > soll ? { basis, letzte, soll, ist, text: t } : null;
}

function laufe(name, R) {
  const r = prng(20260814);
  let invBruch = 0;
  let stapel = 0;
  const beispiele = [];
  for (let i = 0; i < RUNDEN; i++) {
    const a = baueText(r);
    const b = baueText(r);
    const v = invarianteVerletzt(R, a, b);
    if (v) {
      invBruch++;
      if (beispiele.length < 3) beispiele.push({ art: 'INVARIANTE', ...v });
    }
    const s = stapelung(R, a);
    if (s) {
      stapel++;
      if (beispiele.length < 3 && invBruch === 0) beispiele.push({ art: 'STAPELUNG', ...s });
    }
  }
  return { name, invBruch, stapel, beispiele };
}

console.log(`T-09 adversarial — ${RUNDEN} Runden je Fassung, Seed 20260814\n`);
const z = (s) => JSON.stringify(s).split('\\n').join('|').split('\\r').join('<CR>');

const ergebnisse = [OHNE, MIT].map((R, i) => laufe(i === 0 ? 'OHNE Fix' : 'MIT  Fix', R));

for (const e of ergebnisse) {
  console.log(`=== ${e.name} ===`);
  console.log(`  Invariante verletzt : ${e.invBruch} von ${RUNDEN}`);
  console.log(`  Zeile gestapelt     : ${e.stapel} von ${RUNDEN}`);
  for (const b of e.beispiele) {
    console.log(`  ${b.art}:`);
    if (b.art === 'INVARIANTE') {
      console.log(`    a   = ${z(b.a)}`);
      console.log(`    b   = ${z(b.b)}`);
      console.log(`    ist = ${z(b.ist)}`);
    } else {
      console.log(`    basis  = ${z(b.basis)}`);
      console.log(`    Zeile "${b.letzte}" ${b.ist}x statt ${b.soll}x`);
    }
  }
  console.log('');
}

const [alt, neu] = ergebnisse;
console.log('--- Befund -----------------------------------------------------');
if (neu.invBruch > 0) {
  console.log('  DER FIX IST FALSCH. Er verletzt die Invariante — nach setContent(b)');
  console.log('  steht nicht b im Doc. Beispiele oben. NICHT einbauen.');
} else if (alt.invBruch > 0) {
  console.log('  Der BESTAND verletzt die Invariante. Das ist ein eigener Befund und');
  console.log('  hat mit dem Fix nichts zu tun — er muss vor allem anderen geklaert werden.');
} else if (neu.stapel < alt.stapel) {
  console.log(`  Der Fix haelt. Invariante in ${RUNDEN} Runden nie verletzt, und die`);
  console.log(`  Stapelung unberuehrter Schlusszeilen faellt von ${alt.stapel} auf ${neu.stapel}.`);
  if (neu.stapel > 0) {
    console.log(`  ACHTUNG: ${neu.stapel} Faelle bleiben. Der Fix deckt nicht alles ab —`);
    console.log('  die Beispiele oben zeigen, welche Lage uebrig ist.');
  }
} else if (neu.stapel === alt.stapel && alt.stapel === 0) {
  console.log('  KEIN UNTERSCHIED und keine Stapelung in beiden Fassungen. Das heisst');
  console.log('  NICHT, dass der Fix wirkt — es heisst, dass dieser Fuzzer die Lage gar');
  console.log('  nicht erzeugt. Das Alphabet ist zu eng; so ist der Lauf wertlos.');
} else {
  console.log(`  Der Fix aendert nichts oder verschlimmert: ${alt.stapel} -> ${neu.stapel}.`);
}
