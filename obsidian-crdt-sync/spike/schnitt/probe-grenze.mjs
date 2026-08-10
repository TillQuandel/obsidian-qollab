// ACHSE 2, Sonderfall: die 40.000-Zeilen-Grenze von `diff_linesToChars_` GEZIELT
// im kollabierten Schwanz treffen.
//
// `diff_linesToChars_` vergibt fuer text1 hoechstens 40.000 verschiedene
// Zeilentoken (`node_modules/diff-match-patch/index.js:493-510`, `maxLines`),
// fuer text2 danach 65.535. Ist die Marke erreicht, wird ALLES AB DORT zu EINEM
// Token. Eine Bearbeitung VOR der Marke merkt davon nichts (probe-laufzeit.mjs
// Teil D); eine Bearbeitung DAHINTER trifft das Sammel-Token — und damit deckt
// eine einzige Op den ganzen Rest der Notiz.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const R = require(process.env.SPIKE_BUNDLE ?? './real-neu.cjs');
const Y = require('yjs');
const { diff_match_patch } = require('diff-match-patch');
const dmp = new diff_match_patch();

const zeilenDiff = (a, b) => {
  const x = dmp.diff_linesToChars_(a, b);
  const d = dmp.diff_main(x.chars1, x.chars2, false);
  dmp.diff_charsToLines_(d, x.lineArray);
  return d.filter((e) => e[1].length > 0);
};

function text(l) {
  const z = [];
  for (let i = 0; i < l; i++) z.push(`n0-base-${i}`);
  return z.join('\n') + '\n';
}

console.log('Zeilen | Bearbeitung  | kollabiert | Ops | groesste Nicht-EQUAL-Op (Zeichen) | Items | Update-Byte | Text stimmt');
for (const L of [39000, 40001, 45000]) {
  const a = text(L);
  for (const [wo, idx] of [['vorn (Zeile 10)', 10], ['hinten (drittletzte)', L - 3]]) {
    const z = a.split('\n');
    z.splice(idx, 0, 'n0-D1-neu');
    const b = z.join('\n');
    const x = dmp.diff_linesToChars_(a, b);
    const kollabiert = x.chars1.length !== L;
    const d = zeilenDiff(a, b);
    const groesste = Math.max(...d.filter((e) => e[0] !== 0).map((e) => e[1].length));
    const cm = new R.CrdtManager();
    cm.diffModus = 'zeile';
    cm.setContent('p.md', a);
    cm.setContent('p.md', b);
    let items = 0, bytes = 0;
    for (const doc of cm.docs.values()) {
      for (const arr of doc.store.clients.values()) items += arr.length;
      bytes += Y.encodeStateAsUpdate(doc).length;
    }
    // GEGENPROBE, die wichtigste: bleibt der Text trotz Kollaps korrekt?
    const ok = cm.getContent('p.md') === b;
    console.log(
      `${String(L).padStart(6)} | ${wo.padEnd(20)} | ${String(kollabiert).padEnd(10)} |` +
      ` ${String(d.length).padStart(3)} | ${String(groesste).padStart(33)} | ${String(items).padStart(5)} | ${String(bytes).padStart(11)} | ${ok}`
    );
  }
}
