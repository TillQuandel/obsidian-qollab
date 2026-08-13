// leerzeile.mjs — Wie oft hätte der Strip eine abschließende Leerzeile gefressen?
//
// Die zweite adversariale Prüfrunde (2026-08-13) fand, dass ein pauschales
// `merged.slice(0, -1)` nicht nur das von `mitNl` angehängte Zeichen zurücknimmt:
// Endet das Ergebnis auf `'\n\n'`, ist die letzte Zeile LEER, und dieses zweite
// `\n` ist Inhalt. Der Strip löschte es — und verfehlte `zielNl` trotzdem, weil
// danach immer noch ein Umbruch dastand.
//
// WARUM DIESE DATEI EXISTIERT: Die Prüfung meldete dafür eine Rate (7.578 von
// 65.952 Tripeln). Diese Zahl stammt aus einem Skript des Prüfers, das nicht im
// Repo liegt — sie ist damit nicht nachlaufbar, und dieses Projekt führt fünf
// Registratur-Einträge, deren Zahlen genau so unbelegt geworden sind. Statt sie
// zu zitieren, wird sie hier mit eigenem, versioniertem Instrument neu erhoben.
//
// GEMESSEN WIRD DIE WIRKUNG DES GUARDS, isoliert: Für jedes Tripel wird das
// Ergebnis der ausgelieferten Fassung mit dem verglichen, was ohne den Guard
// herauskäme. Der Unterschied ist per Konstruktion genau die gefressene
// Leerzeile.
//
// Aufruf (aus obsidian-crdt-sync/):
//   node spike/duplikat-mb/bauen.mjs && node spike/duplikat-mb/leerzeile.mjs

import { createRequire } from 'node:module';
const require_ = createRequire(import.meta.url);
const neu = require_('./merge.cjs');

// Der Guard in `text-merge.ts` lautet:
//   const schlusszeileLeer = merged.endsWith('\n\n') || merged === '\n';
//   if (!zielNl && merged.endsWith('\n') && !schlusszeileLeer) merged = merged.slice(0, -1);
// Ohne ihn wäre die Bedingung nur `!zielNl && merged.endsWith('\n')`. Der
// Unterschied ist also exakt: Ergebnis endet auf einer Leerzeile UND zielNl ist
// false. Beides ist von außen bestimmbar — `zielNl` aus den drei Eingaben, das
// Ergebnis aus dem Aufruf. Ein Nachbau der Funktion ist dafür nicht nötig.
const endetAufLf = (s) => s.replace(/\r\n/g, '\n').endsWith('\n');
function zielNlVon(base, local, other) {
  const b = endetAufLf(base), l = endetAufLf(local), o = endetAufLf(other);
  return l === b ? o : l;
}
function haetteGefressen(base, local, other) {
  const erg = neu.threeWayMerge(base, local, other);
  if (zielNlVon(base, local, other)) return false;       // Strip liefe ohnehin nicht
  const lf = erg.replace(/\r\n/g, '\n');
  return lf.endsWith('\n\n') || lf === '\n';             // genau der Guard-Fall
}

function rng(seed) {
  let s = seed >>> 0;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 0x100000000; };
}
// Leerstring im Alphabet — ohne ihn entsteht nie eine Leerzeile (die Lehre aus
// der Blindheit von `idempotenz.mjs`, erste Fassung).
const WORTE = ['text', 'x', 'Ar', 'Br', 'lorem', 'h', 'Z', '', '', ''];

const SEED = 20260813;
const N = 20000;
const r = rng(SEED);
let gesamt = 0;
let betroffen = 0;
const beispiele = [];

for (let i = 0; i < N; i++) {
  const n = 2 + Math.floor(r() * 4);
  const grund = Array.from({ length: n }, () => WORTE[Math.floor(r() * WORTE.length)]);
  const seite = () => {
    const zs = [...grund];
    zs[Math.floor(r() * zs.length)] = WORTE[Math.floor(r() * WORTE.length)];
    if (r() < 0.5) zs.push(WORTE[Math.floor(r() * WORTE.length)]);
    return zs.join('\n');
  };
  // Schluss-Umbruch je Stück unabhängig würfeln, damit alle 8 Lagen vorkommen.
  const mitNl = (s) => (r() < 0.5 ? s + '\n' : s);
  const base = mitNl(grund.join('\n')), local = mitNl(seite()), other = mitNl(seite());
  if (base === local && base === other) continue;   // nichts zu mergen
  gesamt++;
  if (haetteGefressen(base, local, other)) {
    betroffen++;
    if (beispiele.length < 3) beispiele.push({ base, local, other });
  }
}

const quote = ((betroffen / gesamt) * 100).toFixed(1);
console.log(`Guard-Wirkung, Seed ${SEED}, ${N} erzeugte Tripel`);
console.log(`  gemergt (nicht trivial gleich) : ${gesamt}`);
console.log(`  davon haette der Strip ohne Guard eine Leerzeile gefressen: ${betroffen} (${quote} %)`);
console.log(`  -> In genau diesen Faellen greift der Guard und laesst den Text in Ruhe.`);

if (beispiele.length) {
  console.log('\nBeispiele:');
  for (const b of beispiele) {
    console.log(`  base=${JSON.stringify(b.base)}`);
    console.log(`  local=${JSON.stringify(b.local)}  other=${JSON.stringify(b.other)}`);
    console.log(`    Ergebnis mit Guard: ${JSON.stringify(neu.threeWayMerge(b.base, b.local, b.other))}\n`);
  }
}

// Gegenprobe: Der bekannte Fall aus der Prüfung MUSS als betroffen erkannt werden.
// Ohne diese Zeile waere „0 betroffen" nicht von „Erkennung kaputt" zu trennen.
const bekannt = ['# Notiz\n', '# Notiz\nZeile', '# Notiz\nZeile\n\n'];
console.log('Gegenprobe: erkennt das Instrument den bekannten Fall aus der Pruefung?');
console.log(`  ${haetteGefressen(...bekannt) ? 'JA — nicht blind.' : 'NEIN — Instrument kaputt, Lauf ungueltig.'}`);
console.log(`  Ergebnis mit Guard: ${JSON.stringify(neu.threeWayMerge(...bekannt))} (die Leerzeile steht)`);
if (!haetteGefressen(...bekannt)) process.exitCode = 1;
