// WARUM: Die Zerlegung in `herkunft.mjs` zeigt, dass die Verdopplung nicht in
// den Textfunktionen entsteht, sondern in `CrdtManager.applyUpdate` — dem
// Yjs-Merge zweier Sidecars. Diese Datei reduziert genau das auf den kleinsten
// Textstand: EINE Zeile, zwei Geraete, kein gemeinsamer Vorfahr.
//
// Der Mechanismus, den sie sichtbar macht: Yjs dedupliziert nach ITEM-ID, nicht
// nach Inhalt. Materialisieren zwei Geraete DENSELBEN Text unabhaengig als je
// eigene Ops (`setContent`, src/crdt-manager.ts:364), tragen die Zeichen
// verschiedene IDs — der Merge haelt beide fuer echte, nebenlaeufige Beitraege
// und behaelt beide. Das ist kein Fehler in Yjs, sondern die Folge davon, dass
// derselbe Inhalt zweimal als Neuschrift auftritt.
//
// Gefahren wird der ECHTE `CrdtManager` aus dem gebuendelten Produktivcode
// (`spike/schnitt/real-neu.cjs`), kein Nachbau.
//
//   node spike/verdopplung/minimal-crdt.mjs

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const det = require('../schnitt/det-quelle.cjs');
const webcrypto = require('lib0/webcrypto');
det.zufallQuelleAn();
det.setzeZufallSeed(42); // SPIKE_DET-Aequivalent: fixierte Zufallsquelle
globalThis.crypto.getRandomValues = (arr) => webcrypto.getRandomValues(arr);
const reqS = createRequire(new URL('../schnitt/anker.mjs', import.meta.url));
const R = reqS('./real-neu.cjs');

const zeig = (t) => JSON.stringify(t).split('\\n').join('|');
const P = 'n0.md';

function doppelte(text) {
  const m = new Map();
  for (const z of text.split('\n')) if (z.length > 0) m.set(z, (m.get(z) ?? 0) + 1);
  return [...m].filter(([, n]) => n > 1).map(([z, n]) => `${z} x${n}`);
}

// ---------------------------------------------------------------------------
// FALL 1 — der Minimalfall. Beide Geraete haben dieselbe `.md` (eine Zeile) vom
// Datei-Sync bekommen und materialisieren sie unabhaengig. Danach tauschen sie
// ihre Sidecars aus. Kleiner geht es nicht.
// ---------------------------------------------------------------------------
{
  const A = new R.CrdtManager();
  const B = new R.CrdtManager();
  A.setContent(P, 'a\n');
  B.setContent(P, 'a\n'); // BYTE-GLEICHER Text, eigene Ops
  const vorher = A.getContent(P);
  A.applyUpdate(P, B.encodeState(P));
  const nachher = A.getContent(P);
  console.log('--- FALL 1  eine Zeile, zwei Geraete, kein gemeinsamer Vorfahr');
  console.log(`  A vor dem Merge  = ${zeig(vorher)}`);
  console.log(`  B (byte-gleich)  = ${zeig(B.getContent(P))}`);
  console.log(`  A nach applyUpdate(B) = ${zeig(nachher)}`);
  console.log(`  doppelte Zeilen: ${doppelte(nachher).join(', ') || '(keine)'}`);
  A.disposeAll();
  B.disposeAll();
}

// ---------------------------------------------------------------------------
// FALL 2 — in der Sprache des Messapparats: Grundtext plus ein Fremd-Token, das
// BEIDE Geraete kennen (eines per CRDT, eines aus der gelieferten `.md`).
// ---------------------------------------------------------------------------
{
  const A = new R.CrdtManager();
  const B = new R.CrdtManager();
  const text = ['n0-base-0', 'n0-base-1', 'n0-D1-0'].join('\n') + '\n';
  A.setContent(P, text);
  B.setContent(P, text);
  A.applyUpdate(P, B.encodeState(P));
  const nachher = A.getContent(P);
  console.log('--- FALL 2  Apparatsprache: derselbe Notiztext auf beiden Geraeten');
  console.log(`  Text auf beiden       = ${zeig(text)}`);
  console.log(`  A nach applyUpdate(B) = ${zeig(nachher)}`);
  console.log(`  doppelte Zeilen: ${doppelte(nachher).join(', ') || '(keine)'}`);
  A.disposeAll();
  B.disposeAll();
}

// ---------------------------------------------------------------------------
// GEGENPROBE — dieselben zwei Geraete MIT gemeinsamer Historie: B baut seinen
// Doc aus A's State auf, statt den Text neu zu materialisieren. Danach traegt
// jedes Zeichen auf beiden Seiten DIESELBE Item-ID, und der Merge dedupliziert.
// Ohne diese Probe waere Fall 1 auch mit „Yjs verdoppelt immer" vereinbar.
// ---------------------------------------------------------------------------
{
  const A = new R.CrdtManager();
  const B = new R.CrdtManager();
  A.setContent(P, 'a\n');
  B.applyUpdate(P, A.encodeState(P)); // gemeinsame Historie statt Neuschrift
  B.setContent(P, 'a\nb\n'); // eigener Beitrag obendrauf
  A.applyUpdate(P, B.encodeState(P));
  const nachher = A.getContent(P);
  console.log('--- GEGENPROBE  dieselbe Lage MIT gemeinsamer Historie');
  console.log(`  A nach applyUpdate(B) = ${zeig(nachher)}`);
  console.log(`  doppelte Zeilen: ${doppelte(nachher).join(', ') || '(keine)'}`);
  A.disposeAll();
  B.disposeAll();
}
