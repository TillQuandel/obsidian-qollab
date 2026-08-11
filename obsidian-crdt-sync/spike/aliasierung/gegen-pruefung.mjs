// GEGENPRUEFUNG des Instruments aus `lauf.mjs` (Messung 1).
//
// Gefragt ist nicht, ob `zeilenBesitz` eigene von fremden Items unterscheidet —
// das zeigt `probe-instrument.mjs`. Gefragt ist, ob die BUCHUNG darueber
// (`lauf.mjs:176-239`) die beiden Klassen trennen kann, um die es geht:
//
//   (a) LEGITIM  eine gemeinsame Grundtextzeile, die der Gewinner spaeter
//                loescht — erwartetes CRDT-Verhalten.
//   (b) SCHADEN  ein Beitrag, den das unterlegene Geraet SELBST getippt hat,
//                der aber zeichengleich mit einer Gewinnerzeile ist und deshalb
//                kein eigenes Item bekommt.
//
// Der Bericht fuehrt `ohneAberNichtImGewinner = 0` als ENTSCHEIDENDEN Beleg
// ("der Zaehler belegt, dass die Implementierung dieser Logik tatsaechlich
// folgt"). Diese Probe fragt zurueck: KANN der Zaehler ueberhaupt feuern?
//
//   node spike/aliasierung/gegen-pruefung.mjs
import { createRequire } from 'node:module';
import { zeilenBesitz, zaehleZeilen, zeilenArt } from './besitz.mjs';

const require = createRequire(import.meta.url);
const R = require('./real-alias.cjs');
const Y = require('yjs');

const PFAD = 'n.md';
const DET = Number(process.env.SPIKE_DET ?? 42);

// Ein Wechsel, gebucht WORTGLEICH nach `lauf.mjs:176-239`.
function buche(winnerText, localText, eigenDev = -1) {
  const gew = new R.CrdtManager();
  gew.setContent(PFAD, winnerText);
  const gewDoc = gew.docs.get(PFAD);
  const update = Y.encodeStateAsUpdate(gewDoc);

  const ver = new R.CrdtManager();
  ver.applyUpdate(PFAD, update);
  const doc = ver.docs.get(PFAD);
  const vor = ver.getContent(PFAD); // = winnerText, der Doc-Stand vor :1454
  const ziel = R.unionMerge(vor, localText); // = `unite` an :1454
  ver.setContent(PFAD, ziel);

  const besitz = zeilenBesitz(doc.getText('content'), doc.clientID);
  const mEigen = new Map();
  for (const b of besitz) {
    if (b.zeile.length === 0) continue;
    if (b.fremd === 0 && b.eigen > 0) mEigen.set(b.zeile, (mEigen.get(b.zeile) ?? 0) + 1);
  }
  const mVor = zaehleZeilen(vor);
  const mLokal = zaehleZeilen(localText);

  const z = { lokalZeilen: 0, lokalMit: 0, lokalOhne: 0, ohneNichtImGewinner: 0, art: new Map() };
  for (const [zeile, nL] of mLokal) {
    const eigenOut = mEigen.get(zeile) ?? 0;
    const mit = Math.min(nL, eigenOut);
    const ohne = nL - mit;
    z.lokalZeilen += nL;
    z.lokalMit += mit;
    z.lokalOhne += ohne;
    if (ohne > 0 && !mVor.has(zeile)) z.ohneNichtImGewinner += ohne;
    const a = zeilenArt(zeile);
    const k =
      a.art === 'basis'
        ? 'grundtext'
        : a.art === 'token'
          ? a.dev === eigenDev
            ? 'token-eigenes-geraet'
            : 'token-fremdes-geraet'
          : 'sonstiges';
    let e = z.art.get(k) ?? { mit: 0, ohne: 0 };
    e.mit += mit;
    e.ohne += ohne;
    z.art.set(k, e);
  }
  return { z, ziel, vor, ver, gew, mEigen };
}

// Loeschprobe: der Gewinner loescht `marke` auf SEINEM Doc, danach werden beide
// Staende zusammengefuehrt (wie `kern.mjs:132-147`).
function stirbt(r, winnerText, marke) {
  const ohne = winnerText
    .split('\n')
    .filter((zl, i, a) => !(zl === marke && a.indexOf(zl) === i))
    .join('\n');
  r.gew.setContent(PFAD, ohne);
  const Z = new R.CrdtManager();
  Z.applyUpdate(PFAD, Y.encodeStateAsUpdate(r.gew.docs.get(PFAD)));
  Z.applyUpdate(PFAD, Y.encodeStateAsUpdate(r.ver.docs.get(PFAD)));
  const end = Z.getContent(PFAD);
  return end.split('\n').filter((x) => x === marke).length === 0;
}

function zeige(name, winnerText, localText, marke, eigenDev) {
  const r = buche(winnerText, localText, eigenDev);
  const tot = stirbt(r, winnerText, marke);
  const arten = [...r.z.art].map(([k, e]) => `${k}(mit=${e.mit},ohne=${e.ohne})`).join(' ');
  console.log(`--- ${name}`);
  console.log(`    winner ${JSON.stringify(winnerText)}`);
  console.log(`    local  ${JSON.stringify(localText)}`);
  console.log(`    ziel   ${JSON.stringify(r.ziel)}`);
  console.log(
    `    BUCHUNG: lokalZeilen=${r.z.lokalZeilen} mit=${r.z.lokalMit} OHNE=${r.z.lokalOhne}` +
      `  ohneAberNichtImGewinner=${r.z.ohneNichtImGewinner}`
  );
  console.log(`    Arten:   ${arten}`);
  console.log(`    "${marke}" nach Loeschung durch den Gewinner: ${tot ? 'TOT' : 'lebt'}`);
  console.log('');
  return { ...r.z, tot };
}

console.log(`# GEGENPRUEFUNG  SPIKE_DET=${DET}  diffModus=${process.env.QOLLAB_DIFF_MODUS ?? 'zeile (Standard)'}`);
console.log('');
console.log('## Teil 1 — kann die Buchung (a) von (b) trennen?');
console.log('');

// (a) LEGITIM: gemeinsame Grundtextzeile, vom Gewinner geloescht.
const a = zeige(
  '(a) LEGITIM — gemeinsame Grundtextzeile',
  'n0-base-0\nn0-base-1\nn0-D1-0\n',
  'n0-base-0\nn0-base-1\nn0-D0-0\n',
  'n0-base-1',
  0
);

// (b) SCHADEN: BEIDE Menschen tippen unabhaengig dieselbe Zeile. Der Verlierer
// hat sie selbst beigetragen — sie ist trotzdem zeichengleich mit einer
// Gewinnerzeile und bekommt deshalb kein eigenes Item.
const b = zeige(
  '(b) SCHADEN — beide tippen unabhaengig "- [ ] Kran bestellen"',
  '# Bau\n- [ ] Kran bestellen\n- [ ] Beton pruefen\n',
  '# Bau\n- [ ] Kran bestellen\n- [ ] Statik pruefen\n',
  '- [ ] Kran bestellen',
  0
);

console.log('## Teil 2 — kann `ohneAberNichtImGewinner` ueberhaupt feuern?');
console.log('');
// Erschoepfend ueber dasselbe Alphabet wie `sweep.mjs`, Laenge 1..4, je Seite
// eine exklusive Schlusszeile: 14.400 Paare.
const ALPHABET = ['a', 'b', 'c'];
function folgen(maxLen) {
  const out = [];
  const bau = (pre) => {
    if (pre.length > 0) out.push(pre);
    if (pre.length === maxLen) return;
    for (const z of ALPHABET) bau([...pre, z]);
  };
  bau([]);
  return out;
}
const alle = folgen(Number(process.env.SPIKE_MAXLEN ?? 4));
let paare = 0;
let ohneGesamt = 0;
let feuert = 0;
for (const w of alle) {
  for (const l of alle) {
    paare++;
    const r = buche([...w, 'nur-W'].join('\n') + '\n', [...l, 'nur-L'].join('\n') + '\n');
    ohneGesamt += r.z.lokalOhne;
    if (r.z.ohneNichtImGewinner > 0) feuert++;
  }
}
console.log(`   Paare geprueft:                                   ${paare}`);
console.log(`   aliasierte lokale Zeilenvorkommen darin:          ${ohneGesamt}`);
console.log(`   Paare mit ohneAberNichtImGewinner > 0:            ${feuert}`);
console.log('');
console.log(
  feuert === 0
    ? '   => Der Zaehler hat in KEINEM Fall gefeuert. Er ist im Zeilen-Modus\n' +
        '      strukturell an 0 gebunden: eine Zeile ohne eigenes Item liegt per\n' +
        '      Definition ganz auf Gewinner-Items, also stand ihr Inhalt im\n' +
        '      winnerText. Als Beleg fuer irgendetwas taugt er nicht.'
    : `   => Der Zaehler kann feuern (${feuert} Faelle) — er ist kein toter Kontrollwert.`
);
