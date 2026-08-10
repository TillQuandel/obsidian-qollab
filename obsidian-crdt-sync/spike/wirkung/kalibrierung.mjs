// kalibrierung.mjs — Zeigt der Seed-3-Schadensfall am ALTEN Build den Schaden?
//
// Zweck: Bevor ein Realtest an echten Obsidian-Instanzen gebaut wird, muss
// belegt sein, dass der Fall die Schadensklasse UEBERHAUPT trifft. Ein gruener
// Lauf an einem Szenario, das die Klasse nicht ausloest, sieht aus wie ein
// Erfolg (Vault-Note `[[Messinstrument-Blindheit]]`).
//
// Fixture zeichengleich aus `spike/schnitt/probe-fuzz.mjs`, Seed 3 — dieselbe,
// die auf `versuch/patch-apply-einbau` als `tests/three-way-fuzz.test.ts` liegt.
//
// Aufruf (aus obsidian-crdt-sync/):
//   node spike/wirkung/bauen.mjs && node spike/wirkung/kalibrierung.mjs

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const alt = require(path.join(here, 'alt.cjs'));
const neu = require(path.join(here, 'neu.cjs'));

const BASIS = [
  'n0-base-0', 'n0-base-1', 'n0-base-2', 'n0-base-3',
  'n0-base-4', 'n0-base-5', 'n0-base-6', 'n0-base-7',
];
const base = BASIS.join('\n') + '\n';
// Lokal: `|n0-D0-9` an n0-base-6 angehaengt.
const local = [
  'n0-base-0', 'n0-base-1', 'n0-base-2', 'n0-base-3',
  'n0-base-4', 'n0-base-5', 'n0-base-6|n0-D0-9', 'n0-base-7',
].join('\n') + '\n';
// Fremd: zwei Ergaenzungen plus eine neue Schlusszeile.
const other = [
  'n0-base-0', 'n0-base-1', 'n0-base-2', 'n0-base-3',
  'n0-base-4', 'n0-base-5|n0-D1-4', 'n0-base-6|n0-D1-0', 'n0-base-7', 'n0-D1-6',
].join('\n') + '\n';

// Grundtextzeilen, die ALLE DREI Staende unveraendert tragen. Nur ihr Verlust
// ist K.o.-Kriterium 1 — `n0-base-5` und `n0-base-6` hat `other` legitim
// erweitert, sie als eigene Zeile zu erwarten waere falsch.
const lokalZeilen = local.split('\n');
const fremdZeilen = other.split('\n');
const unberuehrt = BASIS.filter((z) => lokalZeilen.includes(z) && fremdZeilen.includes(z));

function pruefe(name, merge) {
  const merged = merge(base, local, other);
  const zeilen = merged.split('\n');
  const fehlend = unberuehrt.filter((z) => !zeilen.includes(z));
  const lokalDa = merged.includes('n0-D0-9');
  return { name, merged, zeilen, fehlend, lokalDa };
}

const arme = [
  pruefe('alt  (vor ba9f943, Fuzzy-patch_apply)', alt.threeWayMerge),
  pruefe('neu  (efae37a, zeilenweiser 3-Wege)', neu.threeWayMerge),
];

console.log('Unberuehrter Grundtext (alle drei Staende tragen ihn):');
console.log('  ' + unberuehrt.join(' '));
console.log('');

for (const a of arme) {
  console.log('=== ' + a.name + ' ===');
  console.log('  Ergebnis:');
  for (const z of a.zeilen) if (z !== '') console.log('    ' + z);
  console.log('  Grundtext zerstoert : ' + (a.fehlend.length ? a.fehlend.join(', ') : '(keiner)'));
  console.log('  lokale Ergaenzung da: ' + (a.lokalDa ? 'ja' : 'NEIN'));
  console.log('');
}

const [altArm, neuArm] = arme;
const kalibriert = altArm.fehlend.length > 0 && neuArm.fehlend.length === 0;
console.log('KALIBRIERUNG: ' + (kalibriert ? 'JA' : 'NEIN')
  + ' — alt zerstoert ' + altArm.fehlend.length + ', neu zerstoert ' + neuArm.fehlend.length);
if (!kalibriert) {
  console.log('  Ohne Schaden am alten Arm ist ein Realtest auf dieser Fixture blind.');
  process.exitCode = 1;
}
