// Die Folge des Kollaps, ohne jeden Harness: zwei Geraete bearbeiten
// NEBENLAEUFIG zwei VERSCHIEDENE Stellen im kollabierten Schwanz.
//
// Deckt eine einzige Op den ganzen Rest der Notiz (siehe probe-grenze.mjs), dann
// loeschen beide Geraete denselben Riesenblock und fuegen jeweils ihre eigene
// Fassung davon ein. Beide Einfuegungen ueberleben die Vereinigung -> der
// Schwanz steht doppelt da.
//
// GEGENPROBE gegen ein blindes Instrument: dieselbe Lage unterhalb der Grenze
// (39.000 Zeilen) und unter `semantisch`. Zeigt das Mass dort keinen
// Unterschied, misst es nichts.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const R = require(process.env.SPIKE_BUNDLE ?? './real-neu.cjs');
const Y = require('yjs');

function text(l) {
  const z = [];
  for (let i = 0; i < l; i++) z.push(`n0-base-${i}`);
  return z.join('\n') + '\n';
}
function mit(a, idx, marke) {
  const z = a.split('\n');
  z.splice(idx, 0, marke);
  return z.join('\n');
}

console.log('Zeilen | modus      | Zeilen am Ende | erwartet | Grundtext doppelt | beide Marken da');
for (const L of [39000, 45000]) {
  const a = text(L);
  // Zwei verschiedene Stellen, beide HINTER der 40.000er Marke.
  const A = mit(a, L - 200, 'n0-DA-1');
  const B = mit(a, L - 100, 'n0-DB-1');
  for (const modus of ['semantisch', 'zeile']) {
    const mkDoc = (neu) => {
      const cm = new R.CrdtManager();
      cm.diffModus = modus;
      cm.setContent('p.md', a);
      const basis = Y.encodeStateAsUpdate(cm.docs.get('p.md'));
      cm.setContent('p.md', neu);
      return { update: Y.encodeStateAsUpdate(cm.docs.get('p.md')), basis };
    };
    // Gemeinsame Ausgangslage: BEIDE starten vom selben Doc-Stand.
    const cmBasis = new R.CrdtManager();
    cmBasis.diffModus = modus;
    cmBasis.setContent('p.md', a);
    const gemeinsam = Y.encodeStateAsUpdate(cmBasis.docs.get('p.md'));

    const macheReplikat = (neu) => {
      const d = new Y.Doc();
      Y.applyUpdate(d, gemeinsam);
      const cm = new R.CrdtManager();
      cm.diffModus = modus;
      cm.docs.set('p.md', d);
      cm.setContent('p.md', neu);
      return Y.encodeStateAsUpdate(d);
    };
    const uA = macheReplikat(A);
    const uB = macheReplikat(B);

    const ziel = new Y.Doc();
    Y.applyUpdate(ziel, uA);
    Y.applyUpdate(ziel, uB);
    const erg = ziel.getText('content').toString();
    const zeilen = erg.split('\n').filter((x) => x.length > 0);
    const zaehler = new Map();
    for (const zl of zeilen) zaehler.set(zl, (zaehler.get(zl) ?? 0) + 1);
    let doppelt = 0;
    for (let i = 0; i < L; i++) {
      const c = zaehler.get(`n0-base-${i}`) ?? 0;
      if (c > 1) doppelt += c - 1;
    }
    const beide = zaehler.has('n0-DA-1') && zaehler.has('n0-DB-1');
    console.log(
      `${String(L).padStart(6)} | ${modus.padEnd(10)} | ${String(zeilen.length).padStart(14)} | ${String(L + 2).padStart(8)} |` +
      ` ${String(doppelt).padStart(17)} | ${beide}`
    );
  }
}
