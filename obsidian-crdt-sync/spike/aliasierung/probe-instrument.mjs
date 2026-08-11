// GEGENPROBE fuer das Messinstrument `zeilenBesitz`.
//
// Ein Zaehler, der immer dasselbe meldet, ist blind — sechs Instrumente in
// diesem Projekt waren es nachweislich (`CLAUDE.md` §Arbeitsweise). Diese Probe
// faehrt genau die beiden Vorlagen aus `spike/gate-widerlegung/
// probe-head-aliasing.mjs` durch die Itemzuordnung. Sie unterscheiden sich in
// GENAU der Eigenschaft, die gemessen werden soll:
//
//   Fall 1  gemeinsame Zeile an VERSCHIEDENEN Stellen -> Union verdoppelt sie
//           -> der lokale Beitrag muss ein EIGENES Item haben
//   Fall 2  gemeinsame Zeile an DERSELBEN Stelle      -> Union traegt sie einmal
//           -> der lokale Beitrag muss auf einem FREMDEN Item mitreiten
//
// Meldet das Instrument beide Male dasselbe, ist es blind und die Messung
// wertlos. Der Weg ueber `CrdtManager` statt ueber rohe Y.Doc-Aufrufe ist
// Absicht: gemessen werden soll der Pfad, den `switchToGuid:1454` nimmt,
// einschliesslich `diffOps` und `diffModus`.
//
//   node spike/aliasierung/bauen.mjs && node spike/aliasierung/probe-instrument.mjs
import { createRequire } from 'node:module';
import { zeilenBesitz, zaehleZeilen, clientsImDoc } from './besitz.mjs';

const require = createRequire(import.meta.url);
const R = require('./real-alias.cjs');
const Y = require('yjs');

const PFAD = 'n.md';

function lauf(name, winnerText, localText, zeile) {
  // Gewinner-Inkarnation …
  const gew = new R.CrdtManager();
  gew.setContent(PFAD, winnerText);
  const update = Y.encodeStateAsUpdate(gew.docs.get(PFAD));

  // … und das unterlegene Geraet: eigene Historie verworfen, Gewinner-Doc
  // aufgebaut, Vereinigung materialisiert (sync-handler.ts:1443-1454).
  const ver = new R.CrdtManager();
  ver.applyUpdate(PFAD, update);
  const doc = ver.docs.get(PFAD);
  const kollision = clientsImDoc(doc).has(doc.clientID);
  const ziel = R.unionMerge(winnerText, localText);
  ver.setContent(PFAD, ziel);

  const besitz = zeilenBesitz(doc.getText('content'), doc.clientID);
  const vorkommen = besitz.filter((b) => b.zeile === zeile);
  const eigen = vorkommen.filter((b) => b.fremd === 0 && b.eigen > 0).length;
  const fremd = vorkommen.filter((b) => b.eigen === 0).length;
  const gemischt = vorkommen.length - eigen - fremd;
  const nLokal = zaehleZeilen(localText).get(zeile) ?? 0;

  // Kontrolle: der aus den Items rekonstruierte Text muss der Doc-Text sein.
  const rekon = besitz.map((b) => b.zeile).join('\n');
  const docText = ver.getContent(PFAD);
  const gleich = rekon === docText.replace(/\n$/, '');

  console.log(`--- ${name}`);
  console.log(`  winner ${JSON.stringify(winnerText)}  local ${JSON.stringify(localText)}`);
  console.log(`  ziel(:1454) ${JSON.stringify(ziel)}`);
  console.log(
    `  "${zeile}": lokal ${nLokal}x, im Ergebnis ${vorkommen.length}x` +
      ` -> eigene Items ${eigen}, fremde ${fremd}, gemischt ${gemischt}`
  );
  console.log(`  ohne eigene Kopie: ${Math.max(0, nLokal - eigen)}`);
  console.log(`  [Rekonstruktion == Doc-Text: ${gleich}; clientID-Kollision: ${kollision}]`);
  console.log('');
  return { eigen, fremd, gleich, kollision };
}

const a = lauf(
  'Fall 1 — gemeinsame Zeile an verschiedenen Stellen',
  'b0\nb3\nb2\n',
  'b0\nb1\nA1\nb2\nb3\n',
  'b3'
);
const b = lauf(
  'Fall 2 — gemeinsame Zeile an derselben Stelle',
  '# Notiz\nnur auf C\ngemeinsam\n',
  '# Notiz\nnur auf A\ngemeinsam\n',
  'gemeinsam'
);

const sieht = a.eigen === 1 && b.eigen === 0 && b.fremd === 1;
console.log('=======================================================');
console.log(`Fall 1 eigene Items: ${a.eigen} (erwartet 1)   Fall 2 eigene Items: ${b.eigen} (erwartet 0)`);
console.log(
  sieht
    ? 'INSTRUMENT SIEHT DEN UNTERSCHIED — die Zaehlung ist nicht blind.'
    : 'BLIND ODER FALSCH: die beiden Faelle sind nicht unterscheidbar.'
);
if (!a.gleich || !b.gleich) console.log('WARNUNG: Rekonstruktion weicht vom Doc-Text ab.');
