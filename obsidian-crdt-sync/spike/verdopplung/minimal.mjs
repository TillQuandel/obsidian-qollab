// WARUM: Eine Rate sagt nicht, WIE eine Zeile doppelt wird. Diese Messung
// reduziert den beobachteten Fall auf den kleinsten Textstand, der ihn ausloest,
// und fuehrt ihn gegen die ECHTE Funktion aus `src/text-merge.ts` (gebuendelt
// nach `merge.cjs`, kein Nachbau) — nach dem Muster von
// `spike/konfliktmarker/messung.mjs` und `spike/wirkung/kalibrierung.mjs`.
//
// DIE VERMUTUNG, die hier geprueft wird: `unionMerge` vereinigt zeilenweise per
// Diff. Steht DIESELBE Zeile in beiden Eingaben, aber an verschiedenen Stellen,
// dann kann der Diff sie nicht als „gleich" fuehren — sie faellt auf der einen
// Seite in eine DELETE-Strecke (die die Vereinigung behaelt, `text-merge.ts:400`)
// und auf der anderen in eine INSERT-Strecke (die sie ebenfalls behaelt,
// `:403`). Ergebnis: zwei Kopien. Genau diese Lage ist im Erstkontakt der
// Regelfall — der Doc hat den fremden Token bereits per CRDT an SEINER Stelle,
// die per Sync gelieferte `.md` traegt ihn an einer ANDEREN.
//
// Aufruf (aus obsidian-crdt-sync/):
//   node spike/verdopplung/bauen-merge.mjs && node spike/verdopplung/minimal.mjs

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { unionMerge, threeWayMerge } = require(path.join(here, 'merge.cjs'));

const zeig = (t) => JSON.stringify(t).split('\\n').join('|');

function pruefe(name, other, local) {
  const erg = unionMerge(other, local);
  const zaehl = new Map();
  for (const z of erg.split('\n')) if (z.length > 0) zaehl.set(z, (zaehl.get(z) ?? 0) + 1);
  const doppelt = [...zaehl].filter(([, n]) => n > 1).map(([z, n]) => `${z} x${n}`);
  console.log(`--- ${name}`);
  console.log(`  other (per Sync gelieferte .md) = ${zeig(other)}`);
  console.log(`  local (Doc-Stand)              = ${zeig(local)}`);
  console.log(`  unionMerge(other, local)       = ${zeig(erg)}`);
  console.log(`  doppelte Zeilen: ${doppelt.length ? doppelt.join(', ') : '(keine)'}`);
  return doppelt.length;
}

// ---------------------------------------------------------------------------
// FALL 1 — der Minimalfall: EIN Grundtextzeile, EIN Token, zwei Stellen.
// Kleiner geht es nicht: ohne eine gemeinsame Zeile gibt es keine Verschiebung,
// ohne den gemeinsamen Token nichts zu verdoppeln.
// ---------------------------------------------------------------------------
const f1 = pruefe(
  'FALL 1  derselbe Token, verschiedene Stelle (Minimalfall, 3 Zeilen)',
  ['a', 'T', 'b'].join('\n') + '\n',
  ['a', 'b', 'T'].join('\n') + '\n'
);

// ---------------------------------------------------------------------------
// FALL 2 — derselbe Mechanismus in der Sprache des Messapparats: Grundtext
// `n0-base-0..3`, Token `n0-D1-0` von Geraet 1. Der Doc hat ihn per CRDT hinter
// base-3, die gelieferte `.md` traegt ihn hinter base-1.
// ---------------------------------------------------------------------------
const f2 = pruefe(
  'FALL 2  Apparatsprache: Fremd-Token im Doc und in der .md an anderer Stelle',
  ['n0-base-0', 'n0-base-1', 'n0-D1-0', 'n0-base-2', 'n0-base-3'].join('\n') + '\n',
  ['n0-base-0', 'n0-base-1', 'n0-base-2', 'n0-base-3', 'n0-D1-0'].join('\n') + '\n'
);

// ---------------------------------------------------------------------------
// GEGENPROBE A — gleiche Stelle. Findet der Diff den Token als EQUAL, entsteht
// keine Kopie. Ohne diese Probe waere Fall 1 auch mit „unionMerge verdoppelt
// immer" vereinbar.
// ---------------------------------------------------------------------------
const gA = pruefe(
  'GEGENPROBE A  derselbe Token an DERSELBEN Stelle',
  ['a', 'T', 'b'].join('\n') + '\n',
  ['a', 'T', 'b'].join('\n') + '\n'
);

// ---------------------------------------------------------------------------
// GEGENPROBE B — verschiedene Token. Das ist der Fall, fuer den die Vereinigung
// gebaut ist: beide Beitraege bleiben, nichts steht doppelt.
// ---------------------------------------------------------------------------
const gB = pruefe(
  'GEGENPROBE B  verschiedene Token an verschiedenen Stellen',
  ['a', 'T1', 'b'].join('\n') + '\n',
  ['a', 'b', 'T2'].join('\n') + '\n'
);

// ---------------------------------------------------------------------------
// GEGENPROBE C — derselbe Textstand durch `threeWayMerge` mit dem Grundtext als
// Basis. Zeigt, dass ein gemeinsamer Vorfahre den Fall aufloest — und damit,
// dass die Ursache das FEHLEN des Vorfahren ist, nicht die Zeilenverschiebung
// an sich.
// ---------------------------------------------------------------------------
const basis = ['a', 'b'].join('\n') + '\n';
const drei = threeWayMerge(basis, ['a', 'b', 'T'].join('\n') + '\n', ['a', 'T', 'b'].join('\n') + '\n');
const zc = new Map();
for (const z of drei.split('\n')) if (z.length > 0) zc.set(z, (zc.get(z) ?? 0) + 1);
console.log('--- GEGENPROBE C  derselbe Fall MIT gemeinsamem Vorfahren (threeWayMerge)');
console.log(`  base=${zeig(basis)} local=${zeig(['a', 'b', 'T'].join('\n') + '\n')} other=${zeig(['a', 'T', 'b'].join('\n') + '\n')}`);
console.log(`  threeWayMerge = ${zeig(drei)}`);
console.log(`  T steht ${zc.get('T') ?? 0}x`);

console.log(
  `== minimal: FALL1 doppelt=${f1} FALL2 doppelt=${f2} | GEGENPROBE A=${gA} B=${gB} C(T-Vorkommen)=${zc.get('T') ?? 0}`
);
