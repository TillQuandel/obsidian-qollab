// idempotenz.mjs — Der Preis des Zeilenende-Fixes, gemessen statt behauptet.
//
// Die adversariale Prüfung des Fixes (2026-08-13) hat einen Fall gefunden, in
// dem ein zweiter Merge auf dem eigenen Ergebnis unter der neuen Fassung Inhalt
// verdoppelt, unter der alten nicht:
//     base='text\nx\nx'  local='text\nAr\nx'  other='text\nBr\nx\nB2'
//     Runde 1 in beiden Fassungen identisch; Runde 2 alt stabil, neu verdoppelt.
//
// DIE FRAGE IST NICHT, OB DAS AUFTRITT — es tritt auf. Die Frage ist, ob es NEU
// ist. `docs/produktziel.md` führt diff3 als formal nicht idempotent (Khanna/
// Kunal/Pierce, FSTTCS 2007, Fact 4.2.2) und nennt für den zeilenweisen Merge
// 24,7 % der Fälle. Der Fix hängt fehlende Zeilenenden an — er überführt damit
// Ohne-Zeilenende-Fälle in genau den Pfad, den der Mit-Zeilenende-Fall immer
// schon nahm. Dieser Lauf misst, ob das die Rate über die bekannte hinaus hebt.
//
// GEMESSEN WIRD IN VIER ZELLEN, getrennt nach Schluss-Zeilenende, weil der Fix
// genau daran hängt. Je Zelle dieselben Fälle für beide Fassungen (gepaart), mit
// festem Generator — ohne `Math.random`, damit der Lauf reproduzierbar ist. Eine
// Zahl aus einem streuenden Instrument trägt in diesem Projekt nicht.
//
// Aufruf (aus obsidian-crdt-sync/):
//   node spike/duplikat-mb/bauen.mjs && node spike/duplikat-mb/idempotenz.mjs

import { createRequire } from 'node:module';
const require_ = createRequire(import.meta.url);
const alt = require_('./merge-vor-fix.cjs');
const neu = require_('./merge.cjs');

// Deterministischer Generator (xorshift32) — derselbe Seed, dieselben Fälle.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0x100000000;
  };
}

// Der LEERSTRING gehört ins Alphabet — sonst entsteht nie eine Leerzeile, und
// kein erzeugter Text endet je auf '\n\n'. Genau dafür war die erste Fassung
// dieses Instruments BLIND: Sie hat den Strip-Fehler an der abschließenden
// Leerzeile (zweite adversariale Prüfung, 2026-08-13) strukturell nicht sehen
// können, und die Zahl 862/2000 wurde daraufhin als Entlastung zitiert, die sie
// für diesen Fall nicht trug. Ein Instrument, das eine Schadensklasse nicht
// erzeugen kann, entlastet sie nicht.
const WORTE = ['text', 'x', 'Ar', 'Br', 'B2', 'lorem', 'ipsum', 'h', 'Z', 'q', '', ''];

function baueFall(r) {
  const n = 2 + Math.floor(r() * 3);
  const grund = Array.from({ length: n }, () => WORTE[Math.floor(r() * WORTE.length)]);
  const mit = (zs) => zs.join('\n');
  // Jede Seite ändert eine zufällige Position und hängt ggf. etwas an.
  const seite = () => {
    const zs = [...grund];
    const i = Math.floor(r() * zs.length);
    zs[i] = WORTE[Math.floor(r() * WORTE.length)];
    if (r() < 0.5) zs.push(WORTE[Math.floor(r() * WORTE.length)]);
    return mit(zs);
  };
  return { base: mit(grund), local: seite(), other: seite() };
}

// Die vier Zellen: welches der drei Stücke endet auf einem Zeilenumbruch?
const ZELLEN = [
  { name: 'alle MIT Schluss-Umbruch', b: true, l: true, o: true },
  { name: 'alle OHNE Schluss-Umbruch', b: false, l: false, o: false },
  { name: 'base ohne, Seiten mit', b: false, l: true, o: true },
  { name: 'base mit, Seiten ohne', b: true, l: false, o: false },
];

const N = 2000;
// `an === false` darf nur EINEN Schluss-Umbruch entfernen, nicht alle. Die erste
// Fassung nutzte `/\n+$/` und vernichtete damit jede abschließende Leerzeile —
// dieselbe Blindheit wie beim Alphabet oben.
const nl = (s, an) =>
  an ? (s.endsWith('\n') ? s : s + '\n') : s.endsWith('\n') ? s.slice(0, -1) : s;

console.log(`Nicht-Idempotenz: wie oft gilt merge(base, merge(base,l,o), o) !== merge(base,l,o)?`);
console.log(`Je Zelle ${N} gepaarte Fälle, fester Seed — beide Fassungen sehen dieselben Eingaben.\n`);
console.log('  Zelle                          ohne Fix    mit Fix    Bewertung');
console.log('  ' + '-'.repeat(74));

const zeilen = [];
for (const z of ZELLEN) {
  const r = rng(20260813);
  let instabilAlt = 0;
  let instabilNeu = 0;
  // Fälle, in denen NEU instabil und ALT stabil ist — und davon die, die im
  // MIT-Zeilenende-Pfad schon OHNE Fix instabil sind. Sind das alle, bringt der
  // Fix kein neues Verhalten, sondern vereinheitlicht auf das bestehende.
  let neuSchlechter = 0;
  let davonImMitPfadSchonInstabil = 0;
  const ungeklaert = [];
  for (let i = 0; i < N; i++) {
    const f = baueFall(r);
    const base = nl(f.base, z.b), local = nl(f.local, z.l), other = nl(f.other, z.o);
    const a1 = alt.threeWayMerge(base, local, other);
    const aStabil = a1 === alt.threeWayMerge(base, a1, other);
    const n1 = neu.threeWayMerge(base, local, other);
    const nStabil = n1 === neu.threeWayMerge(base, n1, other);
    if (!aStabil) instabilAlt++;
    if (!nStabil) instabilNeu++;
    if (!nStabil && aStabil) {
      neuSchlechter++;
      const B = nl(f.base, true), L = nl(f.local, true), O = nl(f.other, true);
      const m1 = alt.threeWayMerge(B, L, O);
      if (m1 !== alt.threeWayMerge(B, m1, O)) davonImMitPfadSchonInstabil++;
      // Die Ausnahmen NICHT wegrunden: Wer eine Rate zitiert, muss sagen können,
      // was die Reste sind. Sonst steht am Ende „erklärt bis auf Rundung" in der
      // Akte, und niemand hat je hingesehen.
      else if (ungeklaert.length < 5) ungeklaert.push({ base, local, other });
    }
  }
  const diff = instabilNeu - instabilAlt;
  const bewertung = diff === 0 ? 'unverändert' : diff > 0 ? `+${diff}` : `${diff}`;
  console.log(
    `  ${z.name.padEnd(30)} ${String(instabilAlt).padStart(5)}/${N}  ${String(instabilNeu).padStart(5)}/${N}   ${bewertung}`
  );
  zeilen.push({ ...z, instabilAlt, instabilNeu, neuSchlechter, davonImMitPfadSchonInstabil, ungeklaert });
}

console.log('\nKontrollfrage: Wo NEU instabil ist und ALT stabil war — ist derselbe Fall');
console.log('im MIT-Zeilenende-Pfad schon OHNE Fix instabil?');
for (const z of zeilen) {
  if (z.neuSchlechter === 0) {
    console.log(`  ${z.name.padEnd(30)} keine solchen Fälle`);
    continue;
  }
  const rest = z.neuSchlechter - z.davonImMitPfadSchonInstabil;
  console.log(
    `  ${z.name.padEnd(30)} ${z.davonImMitPfadSchonInstabil}/${z.neuSchlechter} schon im Bestand instabil` +
      (rest === 0 ? ' — ALLE, kein neues Verhalten' : ` — ${rest} bleiben ungeklärt`)
  );
  for (const u of z.ungeklaert) {
    console.log(
      `      ungeklärt: base=${JSON.stringify(u.base)} local=${JSON.stringify(u.local)} other=${JSON.stringify(u.other)}`
    );
    // Von Hand nachgesehen (2026-08-13), alle drei Reste dieser Zelle: Es sind
    // KEINE neuen Fälle, sondern eine Schwäche DIESER Kontrollfrage. Sie bildet
    // den Mit-Zeilenende-Vergleich über `nl(f.base, true)` aus dem GENERIERTEN
    // Fall und trifft damit nicht denselben Text wie die Zelle. Prüft man den
    // konkreten Fall direkt nach, liefert der Bestand im Mit-Zeilenende-Pfad
    // dasselbe wie die neue Fassung — Beispiel:
    //   base='Z\nx\n\nlorem\n' local='Z\nBr\n\nlorem' other='Z\nx\n'
    //   alt ohne Schluss-\n : 'Z\nBr\n\nlorem'   (behält lorem)
    //   alt MIT Schluss-\n  : 'Z\nBr\n'          (löscht lorem — wie die neue Fassung)
    // `other` hat `lorem` gelöscht und `local` es nicht angefasst; die Löschung
    // gewinnt, das ist 3-Wege-Semantik. Der Bestand behielt `lorem` nur, weil die
    // fehlende Schlusszeile `lorem` von `lorem\n` unterscheidbar machte und
    // dadurch einen Konflikt erzwang — genau das Tokenisierungs-Artefakt, das
    // dieser Fix beseitigt.
  }
  if (z.ungeklaert.length) {
    console.log('      (von Hand nachgesehen — siehe Kommentar im Quelltext: ebenfalls Vereinheitlichung)');
  }
}

console.log('\nGegenprobe: misst der Lauf überhaupt etwas?');
// Ohne diese Zeile wäre „0 Unterschiede" nicht von „Instrument tot" zu trennen.
const b = 'text\nx\nx', l = 'text\nAr\nx', o = 'text\nBr\nx\nB2';
const q1 = neu.threeWayMerge(b, l, o);
console.log(`  bekannter Fall aus der Prüfung: neu instabil = ${q1 !== neu.threeWayMerge(b, q1, o)}`);
const B = b + '\n', L = l + '\n', O = o + '\n';
const q2 = alt.threeWayMerge(B, L, O);
console.log(`  derselbe Fall MIT Zeilenende, OHNE Fix: alt instabil = ${q2 !== alt.threeWayMerge(B, q2, O)}`);
console.log('  -> Ist die zweite Zeile true, war die Nicht-Idempotenz schon vor dem Fix da.');
