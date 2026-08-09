// OHNE Harness: die dritte Untervariante an der verorteten Stelle allein.
//
//   SPIKE_BUNDLE=./real-neu.cjs node probe-idempotenz.mjs
//
// Gezeigt wird genau eine Eigenschaft von `CrdtManager.setContent`
// (src/crdt-manager.ts:264, Op-Folge aus `diffOps` :291): dieselbe
// Text-Ersetzung, auf mehreren Replikaten UNABHAENGIG gerechnet, ist NICHT
// idempotent — die DELETE-Haelften verschmelzen, die INSERT-Haelften stapeln
// sich. Kein Transport, kein Tor, kein Parkplatz. Nur die Umrechnung Text -> Ops.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const R = require(process.env.SPIKE_BUNDLE ?? './real-neu.cjs');
const NL = String.fromCharCode(10);
const z = (s) => JSON.stringify(s).split('\\n').join('|');

// Gegenprobe: dieselbe Ersetzung, aber die Op-Folge an Zeilengrenzen ausgerichtet.
if (process.argv[2] === 'zeile') {
  const DMP = new (require('diff-match-patch').diff_match_patch)();
  R.CrdtManager.prototype.setContent = function (filePath, content) {
    const doc = this.getOrCreate(filePath);
    const text = doc.getText('content');
    const current = text.toString();
    if (current === content) return;
    const a = DMP.diff_linesToChars_(current, content);
    const diffs = DMP.diff_main(a.chars1, a.chars2, false);
    DMP.diff_charsToLines_(diffs, a.lineArray);
    doc.transact(() => {
      let pos = 0;
      for (const [op, data] of diffs) {
        if (op === 0) pos += data.length;
        else if (op === 1) { text.insert(pos, data); pos += data.length; }
        else text.delete(pos, data.length);
      }
    });
  };
}

// Der Doc-Stand, den alle Replikate gemeinsam haben (zwei fremde Zeilen um eine
// Grundtextzeile herum) — und der Text, auf den jedes Replikat unabhaengig
// zurueckgeht (die beiden fremden Zeilen weg, Grundtext unveraendert).
const VOR = ['n5-base-0', 'n5-D3-9', 'n5-base-1', 'n5-D3-1', 'n5-base-2'].join(NL) + NL;
const NACH = ['n5-base-0', 'n5-base-1', 'n5-base-2'].join(NL) + NL;

function lauf(anzahl) {
  const quelle = new R.CrdtManager();
  quelle.setContent('n5.md', VOR);
  const saat = quelle.encodeState('n5.md');

  const repl = [];
  for (let i = 0; i < anzahl; i++) {
    const c = new R.CrdtManager();
    c.applyUpdate('n5.md', saat); // identische Item-IDs auf allen Replikaten
    repl.push(c);
  }
  // Jedes Replikat rechnet dieselbe Ersetzung — unabhaengig, ohne die anderen
  // gesehen zu haben. Genau die Lage nach einer verzoegerten `.md`-Zustellung.
  for (const c of repl) c.setContent('n5.md', NACH);
  // Danach sehen sie einander (Sidecar-Austausch).
  for (const a of repl) for (const b of repl) if (a !== b) a.applyUpdate('n5.md', b.encodeState('n5.md'));
  return repl.map((c) => c.getContent('n5.md'));
}

console.log(`VOR   = ${z(VOR)}`);
console.log(`NACH  = ${z(NACH)}   (das Ziel jedes einzelnen Replikats)`);
for (const n of [1, 2, 3, 4]) {
  const erg = lauf(n);
  const alleGleich = erg.every((t) => t === erg[0]);
  const zeileDa = erg[0].split(NL).includes('n5-base-1');
  console.log(
    `${n} Replikat(e) rechnen dieselbe Ersetzung -> ${z(erg[0])}` +
    `  konvergent=${alleGleich ? 'ja' : 'NEIN'}  n5-base-1 vorhanden=${zeileDa ? 'ja' : 'NEIN'}`
  );
}
