// Gegenprobe zur eigenen Widerlegung:
// Behauptung des Pruefers — die Aliasierung, die dem Gate angelastet wurde,
// steht BEREITS in HEAD. Wenn `unionMerge` eine Zeile als EQUAL erkennt, wird
// sie nicht dupliziert; dann hat das Verlierer-Geraet keine eigene Kopie, und
// ein gewoehnlicher Delete des Gewinners toetet sie.
//
// Aufruf (aus obsidian-crdt-sync/):
//   node spike/wirkung/bauen.mjs && node spike/gate-widerlegung/probe-head-aliasing.mjs
import * as Y from 'yjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { unionMerge } = require('../wirkung/neu.cjs');

const zaehle = (t, z) => t.split('\n').filter((x) => x === z).length;

function lauf(name, winnerText, localText, loeschZeile) {
  const ziel = unionMerge(winnerText, localText); // genau das tut `unite` an :1454

  const gew = new Y.Doc({ clientID: 1 });
  gew.getText('t').insert(0, winnerText);
  const gewState = Y.encodeStateAsUpdate(gew);

  // Verlierer uebernimmt den Gewinner-Doc und materialisiert `ziel` (= :1454)
  const ver = new Y.Doc({ clientID: 2 });
  Y.applyUpdate(ver, gewState);
  const tv = ver.getText('t');
  tv.delete(0, tv.length);
  tv.insert(0, ziel);
  const verState = Y.encodeStateAsUpdate(ver);

  // Gewinner sieht den Stand und loescht dann SEINE Zeile
  const gew2 = new Y.Doc({ clientID: 1 });
  Y.applyUpdate(gew2, gewState);
  Y.applyUpdate(gew2, verState);
  const t2 = gew2.getText('t');
  const s = t2.toString();
  const i = s.indexOf(loeschZeile + '\n');
  if (i >= 0) t2.delete(i, loeschZeile.length + 1);
  const nach = gew2.getText('t').toString();

  console.log(`--- ${name}`);
  console.log(`  winner   : ${JSON.stringify(winnerText)}`);
  console.log(`  local    : ${JSON.stringify(localText)}`);
  console.log(`  ziel(:1454): ${JSON.stringify(ziel)}   -> "${loeschZeile}" darin ${zaehle(ziel, loeschZeile)}x`);
  console.log(`  Gewinner loescht "${loeschZeile}"`);
  console.log(`  Endstand : ${JSON.stringify(nach)}`);
  const da = zaehle(nach, loeschZeile) > 0;
  console.log(`  ueberlebt: ${da ? 'JA' : 'NEIN  <-- lokaler Beitrag tot, OHNE jedes Gate'}`);
  console.log('');
  return da;
}

// Fall 1: die Vorlage, mit der die Widerlegung gefahren wurde — unionMerge
// verdoppelt, der Beitrag ueberlebt.
const a = lauf('Vorlage der Widerlegung (unionMerge verdoppelt)',
  'b0\nb3\nb2\n', 'b0\nb1\nA1\nb2\nb3\n', 'b3');

// Fall 2: eine gewoehnliche Vorlage — die gemeinsame Zeile steht in BEIDEN an
// derselben Stelle, der Diff erkennt sie als EQUAL, es entsteht KEIN zweites
// Item.
const b = lauf('Gewoehnliche Vorlage (gemeinsame Zeile, gleiche Stelle)',
  '# Notiz\nnur auf C\ngemeinsam\n', '# Notiz\nnur auf A\ngemeinsam\n', 'gemeinsam');

console.log('=======================================================');
console.log(`Fall 1 ueberlebt: ${a}   Fall 2 ueberlebt: ${b}`);
console.log(b ? 'Aliasierung auf HEAD NICHT reproduziert.'
              : 'BESTAETIGT: Die Aliasierung steht bereits in HEAD — ohne jedes Gate.');
