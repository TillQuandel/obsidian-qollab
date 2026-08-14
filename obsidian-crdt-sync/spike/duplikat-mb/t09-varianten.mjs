// t09-varianten.mjs — Zwei Fix-Wege gegen T-09, gegeneinander gemessen.
//
// BEFUND (T-09): Endet der Text nicht auf `\n`, ist seine letzte Zeile beim
// naechsten `setContent` eine GEAENDERTE statt einer unberuehrten -
// `diff_linesToChars_` tokenisiert inklusive Zeilenende, "BBB" und "BBB\n" sind
// verschiedene Tokens. `diffOps` loest das als DELETE "BBB" + INSERT "BBB\nA2".
// Haengen zwei Geraete unabhaengig an, stapeln sich die INSERT-Haelften.
//
// DIE ZWEI WEGE:
//   V1 cleanupMerge   Nach `diff_charsToLines_` zusaetzlich
//                     `diff_cleanupMerge` laufen lassen. Die Bibliothek zieht
//                     gemeinsame Praefixe aus DELETE/INSERT-Paaren heraus.
//                     Billig - aber sie tut das UEBERALL, nicht nur an der
//                     letzten Zeile, und kann damit die Zeilentreue von T-05
//                     unterlaufen.
//   V2 schlusszeile   Chirurgisch: NUR wenn der Text nicht auf `\n` endet und
//                     genau am Ende ein DELETE+INSERT-Paar mit gemeinsamem
//                     Praefix steht, wird dieser Praefix als EQUAL abgespalten.
//                     Kleinster Eingriff, kleinster Blast-Radius.
//
// WARUM GEMESSEN UND NICHT GEWAEHLT: M-01 ist an genau dieser Stelle gefallen -
// ein Eingriff, der Verdopplung senkt, kostete +42 % stillen Grundtextverlust,
// weil er den eigenen Beitrag auf fremde Items aliasierte. Ein Fix-Weg, der nur
// die Zielzahl trifft, ist deshalb kein Beleg. Gemessen wird auch, was er
// KOSTET.
//
// Aufruf (aus obsidian-crdt-sync/):
//   node spike/schnitt/build-neu.mjs
//   node spike/duplikat-mb/t09-varianten.mjs

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hier = path.dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);
const R = require_(path.join(hier, '..', 'schnitt', 'real-neu.cjs'));
const { diff_match_patch, DIFF_DELETE, DIFF_INSERT, DIFF_EQUAL } = require_('diff-match-patch');

const NL = String.fromCharCode(10);
const DMP = new diff_match_patch();

// Der Bestand: exakt die Op-Folge aus src/crdt-manager.ts, Zweig 'zeile'.
function opsBestand(current, content) {
  const a = DMP.diff_linesToChars_(current, content);
  const diffs = DMP.diff_main(a.chars1, a.chars2, false);
  DMP.diff_charsToLines_(diffs, a.lineArray);
  return diffs.filter((d) => d[1].length > 0);
}

function opsV1(current, content) {
  const diffs = opsBestand(current, content);
  DMP.diff_cleanupMerge(diffs);
  return diffs.filter((d) => d[1].length > 0);
}

// V2: nur die Schlusszeile, nur wenn sie ohne Umbruch endet.
function opsV2(current, content) {
  const diffs = opsBestand(current, content);
  if (current.endsWith(NL)) return diffs;
  // Gesucht: ein DELETE, unmittelbar gefolgt von einem INSERT, das mit dem
  // DELETE-Text beginnt, und das DELETE ist der Schluss von `current`.
  for (let i = 0; i < diffs.length - 1; i++) {
    const [op1, d1] = diffs[i];
    const [op2, d2] = diffs[i + 1];
    if (op1 !== DIFF_DELETE || op2 !== DIFF_INSERT) continue;
    if (!d2.startsWith(d1)) continue;
    // Deckt dieses DELETE wirklich das Ende von `current`? Sonst ist es eine
    // Aenderung mitten im Text, und dort soll die Zeilentreue gelten.
    const bisHier = diffs
      .slice(0, i + 1)
      .filter(([o]) => o !== DIFF_INSERT)
      .reduce((n, [, t]) => n + t.length, 0);
    if (bisHier !== current.length) continue;
    const rest = d2.slice(d1.length);
    const neu = diffs.slice(0, i);
    neu.push([DIFF_EQUAL, d1]);
    if (rest.length > 0) neu.push([DIFF_INSERT, rest]);
    neu.push(...diffs.slice(i + 2));
    return neu.filter((d) => d[1].length > 0);
  }
  return diffs;
}

const VARIANTEN = [
  ['Bestand', opsBestand],
  ['V1 cleanupMerge', opsV1],
  ['V2 schlusszeile', opsV2],
];

// --- Ein Lauf: zwei Replikate haengen unabhaengig je eine Zeile an ----------
function anhaengen(ops, basis, m1, m2) {
  const quelle = new R.CrdtManager();
  quelle.setContent('n.md', basis);
  const saat = quelle.encodeState('n.md');
  const a = new R.CrdtManager();
  const b = new R.CrdtManager();
  a.applyUpdate('n.md', saat);
  b.applyUpdate('n.md', saat);
  const anh = (m) => (basis.endsWith(NL) ? basis + m + NL : basis + NL + m);
  setzeOps(ops);
  a.setContent('n.md', anh(m1));
  b.setContent('n.md', anh(m2));
  b.applyUpdate('n.md', a.encodeState('n.md'));
  const t = b.getContent('n.md');
  setzeOps(null);
  return t;
}

// Den Op-Rechner in den echten CrdtManager einhaengen. `src/` bleibt unberuehrt.
const origSetContent = R.CrdtManager.prototype.setContent;
let aktiveOps = null;
function setzeOps(fn) {
  aktiveOps = fn;
}
R.CrdtManager.prototype.setContent = function (filePath, content) {
  if (!aktiveOps) return origSetContent.call(this, filePath, content);
  const doc = this.getOrCreate(filePath);
  const text = doc.getText('content');
  const current = text.toString();
  if (current === content) return;
  const diffs = aktiveOps(current, content);
  doc.transact(() => {
    let pos = 0;
    for (const [op, data] of diffs) {
      if (op === DIFF_EQUAL) pos += data.length;
      else if (op === DIFF_INSERT) {
        text.insert(pos, data);
        pos += data.length;
      } else text.delete(pos, data.length);
    }
  });
};

const RUMPF = ['# Notiz', '', 'Punkt 1', 'Punkt 2', '', 'Ende', 'AAA', 'BBB'].join(NL);
const zaehle = (t, m) => t.split(m).length - 1;

// --- Die Pruefungen ---------------------------------------------------------
// 1+2 sind die Zielzahl, 3-6 sind der PREIS. Ein Weg, der nur 1 trifft, ist
// nicht belegt - genau daran ist M-01 gescheitert.
const pruefungen = [
  {
    name: '1 r14-Lage (ohne Schluss-NL, beide haengen an)',
    soll: 'BBB 1x, kein Kleben',
    lauf: (ops) => {
      const t = anhaengen(ops, RUMPF, 'A2', 'B2');
      return {
        ok: zaehle(t, 'BBB') === 1 && !/B2BBB|A2BBB/.test(t),
        ist: `BBB ${zaehle(t, 'BBB')}x, ${t.length} Zeichen${/B2BBB|A2BBB/.test(t) ? ', KLEBT' : ''}`,
      };
    },
  },
  {
    name: '2 dieselbe Lage MIT Schluss-NL',
    soll: 'BBB 1x (Bestand kann das schon)',
    lauf: (ops) => {
      const t = anhaengen(ops, RUMPF + NL, 'A2', 'B2');
      return { ok: zaehle(t, 'BBB') === 1, ist: `BBB ${zaehle(t, 'BBB')}x, ${t.length} Zeichen` };
    },
  },
  {
    name: '3 Identitaet: derselbe Text erzeugt keine Op',
    soll: 'null Ops',
    lauf: (ops) => {
      const d = ops(RUMPF, RUMPF);
      const echte = d.filter(([o]) => o !== DIFF_EQUAL);
      return { ok: echte.length === 0, ist: `${echte.length} Ops` };
    },
  },
  {
    name: '4 Schlusszeile wird WIRKLICH geaendert (BBB -> BBX)',
    soll: 'Text stimmt, kein Verlust',
    lauf: (ops) => {
      const c = new R.CrdtManager();
      setzeOps(ops);
      c.setContent('x.md', RUMPF);
      c.setContent('x.md', RUMPF.slice(0, -1) + 'X');
      const t = c.getContent('x.md');
      setzeOps(null);
      return { ok: t === RUMPF.slice(0, -1) + 'X', ist: JSON.stringify(t.split(NL).slice(6).join('|')) };
    },
  },
  {
    name: '5 Zeilentreue (T-05): Ruecknahme auf beiden Replikaten',
    soll: 'Grundtext heil, keine Stapelung',
    lauf: (ops) => {
      const VOR = ['b-0', 'D-9', 'b-1', 'D-1', 'b-2'].join(NL) + NL;
      const NACH = ['b-0', 'b-1', 'b-2'].join(NL) + NL;
      const quelle = new R.CrdtManager();
      quelle.setContent('z.md', VOR);
      const saat = quelle.encodeState('z.md');
      const r = [0, 1].map(() => {
        const c = new R.CrdtManager();
        c.applyUpdate('z.md', saat);
        return c;
      });
      setzeOps(ops);
      for (const c of r) c.setContent('z.md', NACH);
      setzeOps(null);
      r[0].applyUpdate('z.md', r[1].encodeState('z.md'));
      const t = r[0].getContent('z.md');
      const heil = ['b-0', 'b-1', 'b-2'].every((l) => zaehle(t, l) === 1);
      return { ok: heil && t === NACH, ist: heil ? (t === NACH ? 'sauber' : `abweichend: ${JSON.stringify(t)}`) : `Grundtext beschaedigt: ${JSON.stringify(t)}` };
    },
  },
  {
    name: '6 Grundtext ueberlebt: Einfuegen mitten im Text',
    soll: 'alle Zeilen genau 1x',
    lauf: (ops) => {
      const c = new R.CrdtManager();
      setzeOps(ops);
      c.setContent('m.md', RUMPF);
      c.setContent('m.md', RUMPF.replace('Punkt 2', 'Punkt 2' + NL + 'Punkt 3'));
      const t = c.getContent('m.md');
      setzeOps(null);
      const alle = ['# Notiz', 'Punkt 1', 'Punkt 2', 'Punkt 3', 'Ende', 'AAA', 'BBB'];
      return { ok: alle.every((l) => zaehle(t, l) === 1), ist: alle.map((l) => `${l}:${zaehle(t, l)}`).join(' ') };
    },
  },
];

// 7 ist der DISKRIMINATOR zwischen V1 und V2. Die sechs Pruefungen oben
// trennen sie nicht - beide bestehen alles. Der Unterschied liegt im
// Blast-Radius: `diff_cleanupMerge` zieht gemeinsame Affixe UEBERALL heraus,
// nicht nur an der Schlusszeile. Damit sind die Ops nicht mehr zeilentreu -
// und Zeilentreue ist genau das, was T-05 herstellt: "eine angefasste Zeile
// geht ganz raus und ganz wieder rein [...] dieselbe Aenderung, auf mehreren
// Geraeten unabhaengig gerechnet, trifft damit DIESELBEN Items."
//
// Geprueft wird deshalb eine Aenderung MITTEN in einer Zeile, unabhaengig auf
// zwei Replikaten gerechnet. Bleibt die Op zeilentreu, treffen beide dieselben
// Items und nichts stapelt sich. Wird sie zeichenweise, stapeln die
// INSERT-Haelften - dieselbe Mechanik wie T-09 selbst, nur an anderer Stelle.
//
// ACHTUNG - DAS KRITERIUM WAR ZUNAECHST FALSCH GESTELLT. Die erste Fassung
// verlangte "Zeile genau 1x, keine Stapelung". Daran fielen ALLE drei Wege,
// auch der Bestand. Das ist kein Befund ueber die Varianten, sondern ueber das
// Kriterium: Dass zwei unabhaengig erzeugte, inhaltsgleiche Einfuegungen NICHT
// verschmelzen, ist die Grundeigenschaft jedes Text-CRDT - K-09 ist genau
// darueber gefallen (sieben Bibliotheken an den Primaerquellen geprueft).
// Ein Test, der sie verlangt, verwirft jeden moeglichen Fix.
//
// Gemessen wird deshalb, was das Produkt WIRKLICH zusagt (Gruppe 1): Der Text
// bleibt strukturell heil, Zeilen werden nicht zerrissen. Eine doppelte, aber
// vollstaendige Zeile erfuellt das; "Beschlossenossen" nicht.
pruefungen.push({
  name: '7 DISKRIMINATOR: Zeilenmitte identisch auf zwei Replikaten geaendert',
  soll: 'Zeilen bleiben ganz (doppelt ist erlaubt, zerrissen nicht)',
  lauf: (ops) => {
    const VOR = ['b-0', 'Punkt 2: Beschluss', 'b-2'].join(NL) + NL;
    const NACH = ['b-0', 'Punkt 2: Beschlossen', 'b-2'].join(NL) + NL;
    const quelle = new R.CrdtManager();
    quelle.setContent('d.md', VOR);
    const saat = quelle.encodeState('d.md');
    const r = [0, 1].map(() => {
      const c = new R.CrdtManager();
      c.applyUpdate('d.md', saat);
      return c;
    });
    setzeOps(ops);
    for (const c of r) c.setContent('d.md', NACH);
    setzeOps(null);
    r[0].applyUpdate('d.md', r[1].encodeState('d.md'));
    const t = r[0].getContent('d.md');
    // Jede Zeile des Ergebnisses muss eine GANZE Zeile sein - entweder aus VOR
    // oder aus NACH. Eine Zeile wie "Beschlossenossen" ist keine von beiden.
    const erlaubt = new Set([...VOR.split(NL), ...NACH.split(NL)]);
    const zerrissen = t.split(NL).filter((z) => !erlaubt.has(z));
    const dubletten = t.split(NL).filter((z) => z && zaehle(t, z) > 1);
    return {
      ok: zerrissen.length === 0,
      ist:
        zerrissen.length > 0
          ? `ZERRISSEN: ${JSON.stringify(zerrissen)}`
          : dubletten.length > 0
            ? `Zeilen ganz, ${dubletten.length} doppelt (K-09, unvermeidbar)`
            : 'sauber',
    };
  },
});

// Und ein direkter Blick auf die Op-Folge derselben Aenderung: deckt sie ganze
// Zeilen oder Zeichen? Das ist die Eigenschaft, nicht die Rate - nachweisbar
// ohne jeden Lauf.
function zeigeOps(name, ops) {
  const VOR = ['b-0', 'Punkt 2: Beschluss', 'b-2'].join(NL) + NL;
  const NACH = ['b-0', 'Punkt 2: Beschlossen', 'b-2'].join(NL) + NL;
  const d = ops(VOR, NACH).filter(([o]) => o !== DIFF_EQUAL);
  const zeilentreu = d.every(([, t]) => t.endsWith(NL));
  console.log(
    `  ${name.padEnd(17)} ${d.map(([o, t]) => `${o === DIFF_INSERT ? '+' : '-'}${JSON.stringify(t)}`).join(' ')}`
  );
  console.log(`  ${''.padEnd(17)} -> ${zeilentreu ? 'zeilentreu' : 'ZEICHENWEISE (T-05 unterlaufen)'}`);
}

console.log('T-09 — zwei Fix-Wege gegen den Bestand\n');
for (const [name, ops] of VARIANTEN) {
  console.log(`=== ${name} ===`);
  let alle = true;
  for (const p of pruefungen) {
    let r;
    try {
      r = p.lauf(ops);
    } catch (e) {
      r = { ok: false, ist: `WARF: ${e.message}` };
    }
    if (!r.ok) alle = false;
    console.log(`  ${r.ok ? 'ok  ' : 'FAIL'} ${p.name}`);
    console.log(`       soll: ${p.soll}`);
    console.log(`       ist : ${r.ist}`);
  }
  console.log(`  -> ${alle ? 'alle sieben' : 'NICHT alle'} Pruefungen bestanden\n`);
}

console.log('--- Die Op-Folge bei einer Aenderung MITTEN in der Zeile --------');
for (const [name, ops] of VARIANTEN) zeigeOps(name, ops);
