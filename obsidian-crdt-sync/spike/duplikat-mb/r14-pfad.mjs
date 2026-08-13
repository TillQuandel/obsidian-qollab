// r14-pfad.mjs — Welcher Merge-Pfad erzeugt den Endtext von r14?
//
// LAGE (Realtest r14-cdp, Lauf r14cdp-20260813-213723, NACH dem Zeilenende-Fix
// T-08; Evidenz-Zip des Laufs):
//   vault-a  158 Zeichen, sauber:  ... AAA / BBB / A2
//   vault-b  210 Zeichen, kaputt:  ... AAA / BBB / B2<KLEBT>BBB / A2
// Beide Staende enden OHNE Zeilenumbruch — in Obsidian der Normalfall.
//
// Der Assert `kontrolle2-keine-duplikate` meldet 1/2/1 statt 1/1/1. Die 2 ist
// KEIN Duplikat: `H-COUNT` zaehlt Regex-Treffer im Volltext
// (`harness-ext.ps1:477`), und `BBB-<RunId>` kommt zweimal vor, weil es einmal
// als eigene Zeile und einmal an `B2-<RunId>` geklebt dasteht. Die CRDT-Sicht
// meldete im Messpunktlauf vom 2026-08-12 `mB = 1` — das CRDT ist heil, der
// Schaden sitzt im Dateitext.
//
// DIE FRAGE: `threeWayMerge` hat die Zeilenende-Garantie seit T-08, und im
// Build steckt sie nachweislich (`zielNl` 2x, `padLast` 4x im deployten
// main.js). Wenn dieser Pfad liefe, duerfte nichts kleben. Was laeuft dann?
//
// UNTERSCHIED ZU r13: Dort waren beide Vaults byte-gleich beschaedigt
// (konvergent, still). Hier ist NUR B betroffen — divergent.
//
// Aufruf (aus obsidian-crdt-sync/):
//   node spike/duplikat-mb/bauen.mjs && node spike/duplikat-mb/r14-pfad.mjs

import { createRequire } from 'node:module';
const require_ = createRequire(import.meta.url);
const neu = require_('./merge.cjs');
const alt = require_('./merge-vor-fix.cjs');

const ID = 'r14cdp-20260813-213723';
const BASIS = [
  '# Meetingprotokoll',
  '',
  'Punkt 1: Ausgangslage',
  'Punkt 2: Beschluss',
  '',
  'Ende der Vorlage',
  `AAA-${ID}`,
  `BBB-${ID}`,
].join('\n'); // endet OHNE \n — wie Obsidian schreibt

const LOCAL = `${BASIS}\nB2-${ID}`; // Bs eigener Edit
const OTHER = `${BASIS}\nA2-${ID}`; // As Edit, per Sidecar zugestellt

// Was der Lauf tatsaechlich in vault-b hinterlassen hat.
const GEMESSEN = [
  '# Meetingprotokoll',
  '',
  'Punkt 1: Ausgangslage',
  'Punkt 2: Beschluss',
  '',
  'Ende der Vorlage',
  `AAA-${ID}`,
  `BBB-${ID}`,
  `B2-${ID}BBB-${ID}`,
  `A2-${ID}`,
].join('\n');

const ERWARTET = `${BASIS}\nB2-${ID}\nA2-${ID}`;

// --- Selbsttest: stimmen die rekonstruierten Laengen mit dem Lauf ueberein? ---
// Ohne diesen Abgleich koennte das Instrument eine erdachte Lage rechnen statt
// der gemessenen. Genau diese Verwechslung hat das Projekt mehrfach bezahlt.
const soll = { BASIS: 132, LOCAL: 158, OTHER: 158, GEMESSEN: 210, ERWARTET: 184 };
let selbsttestOk = true;
console.log('--- Selbsttest gegen die Messung -------------------------------');
for (const [name, text] of Object.entries({ BASIS, LOCAL, OTHER, GEMESSEN, ERWARTET })) {
  const ok = text.length === soll[name];
  if (!ok) selbsttestOk = false;
  console.log(`  ${name.padEnd(9)} ${String(text.length).padStart(3)} Zeichen  soll ${soll[name]}  ${ok ? 'ok' : '>>> ABWEICHUNG <<<'}`);
}
if (!selbsttestOk) {
  console.error('\nFEHLER: Die rekonstruierte Lage deckt sich nicht mit dem Lauf. Abbruch.');
  process.exit(1);
}
console.log(`  Differenz gemessen - erwartet: ${GEMESSEN.length - ERWARTET.length} Zeichen = Laenge von "BBB-${ID}" (${`BBB-${ID}`.length})`);

// --- Die Kandidaten ---------------------------------------------------------
const kandidaten = [
  ['threeWayMerge  MIT Fix', () => neu.threeWayMerge(BASIS, LOCAL, OTHER)],
  ['threeWayMerge OHNE Fix', () => alt.threeWayMerge(BASIS, LOCAL, OTHER)],
  ['unionMerge     MIT Fix', () => neu.unionMerge(OTHER, LOCAL)],
  ['unionMerge    OHNE Fix', () => alt.unionMerge(OTHER, LOCAL)],
];

console.log('\n--- Was liefert welcher Pfad? ----------------------------------');
const treffer = [];
for (const [name, fn] of kandidaten) {
  let r;
  try {
    r = fn();
  } catch (e) {
    console.log(`  ${name}  WARF: ${e.message}`);
    continue;
  }
  const klebt = r.includes(`B2-${ID}BBB-`) || r.includes(`A2-${ID}BBB-`);
  const istGemessen = r === GEMESSEN;
  const istSauber = r === ERWARTET;
  if (istGemessen) treffer.push(name);
  console.log(
    `  ${name}  ${String(r.length).padStart(3)} Zeichen  ` +
      `klebt=${klebt ? 'JA ' : 'nein'}  ` +
      `= gemessen? ${istGemessen ? 'JA' : 'nein'}  ` +
      `= sauber? ${istSauber ? 'JA' : 'nein'}`
  );
}

// --- Gegenprobe: kann das Instrument den Schaden ueberhaupt sehen? -----------
// Eine Positiv-Pruefung ohne Gegenprobe ist im Projekt neunmal blind gewesen.
const probe = alt.threeWayMerge('a\nb', 'a\nb\nX', 'a\nb\nY');
console.log('\n--- Gegenprobe -------------------------------------------------');
console.log(`  Bekannter Klebefall ohne Fix: ${JSON.stringify(probe)}  ${probe === 'a\nb\nXb\nY' ? '-> Instrument sieht Kleben' : '-> BLIND, Ergebnis wertlos'}`);

// --- Wo genau weichen die Kandidaten ab? ------------------------------------
// `threeWayMerge OHNE Fix` trifft die LAENGE (210), aber nicht den Text. Eine
// gleiche Laenge bei ungleichem Text heisst: dieselbe Schadensmenge an anderer
// Stelle. Deshalb hier zeilenweise, statt es aus der Zahl zu schliessen.
const zeig = (name, t) => {
  console.log(`\n  ${name}  (${t.length} Zeichen)`);
  t.split('\n')
    .slice(6)
    .forEach((z, i) => console.log(`    ${String(i + 7).padStart(2)}: [${z}]`));
};
console.log('\n--- Zeilenweise ------------------------------------------------');
zeig('GEMESSEN im Lauf', GEMESSEN);
zeig('threeWayMerge OHNE Fix  (local=B2, other=A2)', alt.threeWayMerge(BASIS, LOCAL, OTHER));
zeig('threeWayMerge OHNE Fix  (local=A2, other=B2)  <- Rollen vertauscht', alt.threeWayMerge(BASIS, OTHER, LOCAL));

// Wer den Merge rechnet, entscheidet ueber die Rollen: Auf B ist der eigene
// Stand `local` und der zugestellte `other` — aber wenn der Schaden auf einem
// Pfad entsteht, auf dem B den fremden Stand als `local` sieht, kippt das.
const vertauscht = alt.threeWayMerge(BASIS, OTHER, LOCAL);
console.log(`\n  Rollen vertauscht === gemessen ? ${vertauscht === GEMESSEN ? 'JA' : 'nein'}`);

console.log('\n--- Befund -----------------------------------------------------');
if (treffer.length === 0 && vertauscht !== GEMESSEN) {
  console.log('  KEIN gepruefter Merge-Pfad erzeugt den gemessenen Endtext —');
  console.log('  auch nicht mit vertauschten Rollen.');
  console.log('  Der Schaden entsteht also NICHT allein in text-merge.ts. Er liegt');
  console.log('  vor oder hinter dem Merge (Aufrufer, setContent/diffOps, Schreibweg)');
  console.log('  ODER die Basis war eine andere als die hier angenommene.');
  console.log('  NAECHSTER SCHRITT: die tatsaechliche Basis aus den Hilfsdateien der');
  console.log('  Evidenz-Zip rekonstruieren (verify.js), statt sie zu unterstellen.');
} else if (vertauscht === GEMESSEN) {
  console.log('  Der gemessene Endtext entsteht bei threeWayMerge OHNE Fix mit');
  console.log('  VERTAUSCHTEN Rollen — B rechnet den fremden Stand als `local`.');
} else {
  console.log(`  Der gemessene Endtext entsteht bei: ${treffer.join(', ')}`);
}
