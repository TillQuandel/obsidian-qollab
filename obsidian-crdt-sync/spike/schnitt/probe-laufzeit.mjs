// ACHSE 4 (2026-08-10): Was KOSTET `diffModus = 'zeile'` an Laufzeit?
//
//   SPIKE_BUNDLE=./real-neu.cjs node probe-laufzeit.mjs [wiederholungen]
//
// Gemessen wird auf ZWEI Ebenen, weil beide etwas anderes beantworten:
//
//   A) DIE DIFF-PASSE ALLEIN — `diff_main` + `diff_cleanupSemantic` gegen
//      `diff_linesToChars_` -> `diff_main(..., false)` -> `diff_charsToLines_`.
//      Beide Folgen stehen hier woertlich so, wie `crdt-manager.ts` sie rechnet
//      (`src/crdt-manager.ts:337-374`); die Bibliothek ist dieselbe Instanz-
//      Klasse. Das beantwortet die Vermutung aus der Akte („zusaetzliche Passe,
//      dafuer kuerzerer diff_main — unterm Strich vermutlich schneller").
//
//   B) `CrdtManager.setContent` KOMPLETT — inklusive der Yjs-Transaktion. Das
//      ist der Preis, den das Plugin wirklich zahlt: eine groebere Op-Folge
//      schreibt mehr Zeichen ins CRDT, auch wenn der Diff schneller war.
//      Gefahren wird der ECHTE Produktivcode aus dem Bundle, ueber den Schalter
//      `crdt.diffModus` — kein Nachbau.
//
// VERFAHREN: je Zelle `W` Wiederholungen derselben Aenderung auf frischen
// Objekten, gemessen mit `process.hrtime.bigint()`. Ausgewiesen wird der MEDIAN
// (nicht der Mittelwert — ein GC-Lauf verzerrt den Mittelwert und nicht den
// Median) sowie Min. Vor jeder Zelle laeuft eine Aufwaermrunde von W/4 Laeufen,
// deren Zeiten verworfen werden; ohne sie misst man den JIT.
//
// GEGENPROBE gegen ein blindes Instrument: die Zelle `ganz` (maximal grober
// Diff) muss in B deutlich TEURER sein als `zeile` — sie schreibt jedes Zeichen
// neu. Zeigt das Instrument dort keinen Unterschied, misst es nichts.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const R = require(process.env.SPIKE_BUNDLE ?? './real-neu.cjs');
const { diff_match_patch } = require('diff-match-patch');

const W = Number(process.argv[2] ?? 200);
const dmp = new diff_match_patch();

function text(l, praefix = 'n0') {
  const zeilen = [];
  for (let i = 0; i < l; i++) zeilen.push(`${praefix}-base-${i}`);
  return zeilen.join('\n') + '\n';
}
// Die Aenderung des Harness: EINE Zeile an zufaelliger (hier: mittiger) Stelle.
function bearbeitet(t, marke) {
  const z = t.split('\n');
  const p = Math.floor(z.length / 2);
  z.splice(p, 0, `n0-D1-${marke}`);
  return z.join('\n');
}

const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};

function miss(fn, w) {
  for (let i = 0; i < Math.max(1, w >> 2); i++) fn(i); // Aufwaermen, verworfen
  const zeiten = [];
  for (let i = 0; i < w; i++) {
    const t0 = process.hrtime.bigint();
    fn(i);
    zeiten.push(Number(process.hrtime.bigint() - t0) / 1e6); // ms
  }
  return { med: median(zeiten), min: Math.min(...zeiten) };
}

const zeichenDiff = (a, b) => {
  const d = dmp.diff_main(a, b);
  dmp.diff_cleanupSemantic(d);
  return d;
};
const zeilenDiff = (a, b) => {
  const x = dmp.diff_linesToChars_(a, b);
  const d = dmp.diff_main(x.chars1, x.chars2, false);
  dmp.diff_charsToLines_(d, x.lineArray);
  return d.filter((e) => e[1].length > 0);
};

const LAGEN = (process.env.SPIKE_LAGEN ?? '8,200,1000,5000').split(',').map(Number);

console.log(`# A) NUR DIE DIFF-PASSE, ${W} Wiederholungen je Zelle, Median (Min) in ms`);
console.log('Zeilen | semantisch (diff_main+cleanup) | zeile (linesToChars+diff_main+charsToLines) | Faktor');
for (const L of LAGEN) {
  const a = text(L);
  const b = bearbeitet(a, 7);
  const s = miss(() => zeichenDiff(a, b), W);
  const z = miss(() => zeilenDiff(a, b), W);
  console.log(
    `${String(L).padStart(6)} | ${s.med.toFixed(4)} (${s.min.toFixed(4)})`.padEnd(48) +
    `| ${z.med.toFixed(4)} (${z.min.toFixed(4)})`.padEnd(46) +
    `| ${(z.med / s.med).toFixed(2)}x`
  );
}

console.log(`\n# B) CrdtManager.setContent KOMPLETT (Diff + Yjs-Transaktion), ${W} Wiederholungen`);
console.log('Zeilen | modus       | Median (Min) ms | Yjs-Items nach dem Lauf');
for (const L of LAGEN) {
  const a = text(L);
  const b = bearbeitet(a, 7);
  for (const modus of ['semantisch', 'zeile', 'ganz']) {
    let items = 0;
    const r = miss((i) => {
      const cm = new R.CrdtManager();
      cm.diffModus = modus;
      cm.setContent('p.md', a);
      cm.setContent('p.md', b);
      if (i === 0) {
        let n = 0;
        for (const doc of cm.docs.values()) for (const arr of doc.store.clients.values()) n += arr.length;
        items = n;
      }
    }, W);
    console.log(`${String(L).padStart(6)} | ${modus.padEnd(11)} | ${r.med.toFixed(4)} (${r.min.toFixed(4)})`.padEnd(52) + `| ${items}`);
  }
}

// ---------------------------------------------------------------------------
// C) DER REALISTISCHE FALL: viele aufeinanderfolgende Bearbeitungen auf EINEM
// Doc. Teil B misst einen frischen Doc — dort hat `ganz` noch keine Historie,
// die es zerstoeren koennte, und wirkt deshalb faelschlich billig. Erst hier
// wird der Unterschied zwischen den Modi sichtbar: gemessen werden Gesamtzeit,
// die Zahl der Yjs-Structs am Ende und die Groesse des kodierten Updates —
// also genau das, was als `.yjs` auf der Platte landet (ACHSE 5).
// ---------------------------------------------------------------------------
const Y = require('yjs');
const EDITS = Number(process.env.SPIKE_EDITFOLGE ?? 30);
console.log(`\n# C) ${EDITS} aufeinanderfolgende Bearbeitungen auf EINEM Doc`);
console.log('Zeilen | modus       | Gesamt ms | Yjs-Items | kodiertes Update (Byte)');
for (const L of LAGEN) {
  const a = text(L);
  // Jede Bearbeitung haengt EINE Zeile an wechselnder Stelle ein — die
  // Aenderungsform des Harness, nur wiederholt.
  const folge = [a];
  let cur = a;
  for (let k = 0; k < EDITS; k++) {
    const z = cur.split('\n');
    z.splice(1 + ((k * 7) % Math.max(1, z.length - 1)), 0, `n0-D1-${k}`);
    cur = z.join('\n');
    folge.push(cur);
  }
  for (const modus of ['semantisch', 'zeile', 'ganz']) {
    const cm = new R.CrdtManager();
    cm.diffModus = modus;
    const t0 = process.hrtime.bigint();
    for (const t of folge) cm.setContent('p.md', t);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    let items = 0, bytes = 0;
    for (const doc of cm.docs.values()) {
      for (const arr of doc.store.clients.values()) items += arr.length;
      bytes += Y.encodeStateAsUpdate(doc).length;
    }
    console.log(`${String(L).padStart(6)} | ${modus.padEnd(11)} | ${ms.toFixed(2).padStart(9)} | ${String(items).padStart(9)} | ${bytes}`);
  }
}

// ---------------------------------------------------------------------------
// D) DIE BIBLIOTHEKSGRENZE. `diff_linesToChars_` teilt den Zeichenvorrat auf:
// 40.000 verschiedene Zeilen fuer text1, danach 65.535 fuer text2 (gelesen in
// `node_modules/diff-match-patch/index.js:505-510`, `maxLines` wird zwischen
// den beiden Aufrufen umgesetzt). Ist die Grenze erreicht, wird der REST zu
// EINER Zeile zusammengefasst. Der Kommentar in `src/crdt-manager.ts:352` nennt
// nur die 65.535 — fuer den ERSTEN Text greift schon die 40.000er Marke.
//
// Hier wird sie ausgeloest und nachgesehen, was daraus wird.
// ---------------------------------------------------------------------------
console.log('\n# D) 40.000-Zeilen-Grenze von diff_linesToChars_');
for (const L of [39999, 40001]) {
  const a = text(L);
  const b = bearbeitet(a, 7);
  const x = dmp.diff_linesToChars_(a, b);
  const zeilenA = a.split('\n').length - 1;
  const kollabiert = x.chars1.length !== zeilenA;
  const t0 = process.hrtime.bigint();
  const cm = new R.CrdtManager();
  cm.diffModus = 'zeile';
  cm.setContent('p.md', a);
  cm.setContent('p.md', b);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  let items = 0;
  for (const doc of cm.docs.values()) for (const arr of doc.store.clients.values()) items += arr.length;
  // Wie gross ist die groebste Op? Bei Kollaps muesste eine Op den ganzen
  // Restschwanz decken.
  const d = zeilenDiff(a, b);
  const groesste = Math.max(...d.filter((e) => e[0] !== 0).map((e) => e[1].length));
  console.log(
    `  Zeilen=${L} chars1=${x.chars1.length} (Zeilen=${zeilenA}) kollabiert=${kollabiert}` +
    ` lineArray=${x.lineArray.length} | setContent ${ms.toFixed(1)} ms, Items=${items}, groesste Nicht-EQUAL-Op=${groesste} Zeichen`
  );
}
