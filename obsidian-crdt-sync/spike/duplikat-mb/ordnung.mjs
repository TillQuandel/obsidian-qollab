// ordnung.mjs — Woher kommt die Umsortierung, die das Duplikat erzeugt?
//
// VORLAUF: `signatur.mjs` hat erschoepfend gemessen (4225 Paare), dass die in
// `r13`/`r14` beobachtete Signatur (mB=2, alle anderen Marker=1) in `unionMerge`
// AUSNAHMSLOS eine Umsortierung voraussetzt — 372 Treffer, davon 372 umsortiert,
// 0 nicht. `text-merge.ts:304-305` sagt dasselbe zu: „umsortierte Zeilen
// erscheinen doppelt (eine Verschiebung ist ohne Basis nicht von `geloescht +
// eingefuegt` zu unterscheiden)".
//
// DAMIT VERSCHIEBT SICH DIE FRAGE: nicht mehr „warum dupliziert unionMerge",
// sondern „wer sortiert hier um". Im Merge-Code gibt es dafuer genau eine
// Stelle, die Reihenfolge aktiv festlegt:
//
//     text-merge.ts:245   const [x, y] = [ta, tb].sort();
//
// Sie loest den Konfliktfall „beide Seiten haben dieselbe Stelle angefasst" auf,
// indem sie die beiden Bloecke LEXIKOGRAPHISCH ordnet — laut Kommentar, „damit
// alle Geraete dasselbe Ergebnis rechnen". Determinismus ist damit erreicht;
// die Frage, die hier gemessen wird, ist eine andere: Kann diese Ordnung eine
// BESTEHENDE Reihenfolge umkehren?
//
// Die Marker des Harness geben den Verdacht her (r14-cdp.ps1:43-46):
//     mA  = 'AAA-<RunId>'      mA2 = 'A2-<RunId>'
//     mB  = 'BBB-<RunId>'      mB2 = 'B2-<RunId>'
// Lexikographisch ist '2' (0x32) kleiner als 'A' (0x41) und als 'B' (0x42) —
// also 'A2-…' < 'AAA-…' und 'B2-…' < 'BBB-…'. Der spaeter entstandene Marker
// sortiert VOR den frueheren.
//
// GEPRUEFT WIRD DESHALB IN ZWEI ARMEN, die sich in genau einem Punkt
// unterscheiden — den Marker-NAMEN. Alles andere ist zeichengleich:
//   Arm 1 (echte Namen):     Sortierung kehrt die Reihenfolge um
//   Arm 2 (ordnungstreue):   Sortierung laesst die Reihenfolge stehen
// Bleibt das Duplikat in Arm 2 aus, ist es der Sortierstelle zugeordnet — und
// zwar mit positivem Gegensignal statt mit einem Plausibilitaetsargument.
//
// Aufruf (aus obsidian-crdt-sync/):
//   node spike/duplikat-mb/ordnung.mjs

import { createRequire } from 'node:module';
const require_ = createRequire(import.meta.url);
const { unionMerge, threeWayMerge } = require_('./merge.cjs');

const BASE = [
  '# Meetingprotokoll',
  '',
  'Punkt 1: Ausgangslage',
  'Punkt 2: Beschluss',
  '',
  'Ende der Vorlage',
].join('\n') + '\n';

const RUN = 'r14cdp-20260812-210047';

// Arm 1: die echten Marker der Runner.
const ECHT = {
  name: 'echte Harness-Marker',
  mA: `AAA-${RUN}`,
  mB: `BBB-${RUN}`,
  mA2: `A2-${RUN}`,
  mB2: `B2-${RUN}`,
};
// Arm 2: dieselbe Rolle, aber die Namen sortieren in Entstehungsreihenfolge.
// EINZIGE Aenderung gegenueber Arm 1. Nichts am Ablauf, nichts am Code.
const ORDNUNGSTREU = {
  name: 'ordnungstreue Marker (Gegenprobe)',
  mA: `A1-${RUN}`,
  mB: `B1-${RUN}`,
  mA2: `A9-${RUN}`,
  mB2: `B9-${RUN}`,
};

function zaehle(text, marker) {
  let n = 0;
  let i = text.indexOf(marker);
  while (i !== -1) { n++; i = text.indexOf(marker, i + marker.length); }
  return n;
}

const zeilen = (m, folge) => BASE + folge.map((k) => m[k]).join('\n') + '\n';

function lauf(m) {
  const out = [];
  const log = (s) => out.push(s);

  log(`\n${'='.repeat(72)}`);
  log(`ARM: ${m.name}`);
  log('='.repeat(72));

  // Sortiert die Stelle text-merge.ts:245 hier um? Erst die reine Frage stellen,
  // damit der Arm auch dann etwas aussagt, wenn der Ablauf unten nichts zeigt.
  const paarA = [`${m.mA}\n`, `${m.mA2}\n`].sort();
  const paarB = [`${m.mB}\n`, `${m.mB2}\n`].sort();
  const kehrtA = paarA[0].trim() === m.mA2;
  const kehrtB = paarB[0].trim() === m.mB2;
  log(`\n[1] Was tut [ta,tb].sort() (text-merge.ts:245) mit diesen Namen?`);
  log(`    A-Paar: ${m.mA} / ${m.mA2}  ->  ${paarA.map((s) => s.trim()).join(' , ')}`);
  log(`            kehrt die Entstehungsreihenfolge um: ${kehrtA ? 'JA' : 'nein'}`);
  log(`    B-Paar: ${m.mB} / ${m.mB2}  ->  ${paarB.map((s) => s.trim()).join(' , ')}`);
  log(`            kehrt die Entstehungsreihenfolge um: ${kehrtB ? 'JA' : 'nein'}`);

  // --- Der Ablauf, wie er im Runner steht ----------------------------------
  // Aufbau (H-SETUP-SHARED-CDP, harness-cdp.ps1): A schreibt BASE+mA, B adoptiert
  // per Startup-Sweep und haengt mB an. Beide Vaults danach byte-gleich (X-06).
  const nachAufbau = zeilen(m, ['mA', 'mB']);
  log(`\n[2] Stand nach dem gemeinsamen Aufbau (beide Vaults byte-gleich):`);
  log(`    ${[m.mA, m.mB].join(' | ')}`);

  // Danach haengt jede Seite ihren Beitrag an — nebenlaeufig, an dieselbe Stelle
  // (ans Ende). r14-cdp.ps1:101 (B: mB2) und :134 (A: mA2).
  const aLokal = zeilen(m, ['mA', 'mB', 'mA2']);
  const bLokal = zeilen(m, ['mA', 'mB', 'mB2']);
  log(`\n[3] Nebenlaeufige Beitraege, jede Seite fuer sich:`);
  log(`    A: ${[m.mA, m.mB, m.mA2].join(' | ')}`);
  log(`    B: ${[m.mA, m.mB, m.mB2].join(' | ')}`);

  // Der 3-Wege-Merge gegen die gemeinsame Basis — der eingebaute Weg (T-04).
  // Jede Seite rechnet ihn mit sich als `local` und der Gegenseite als `other`.
  const aNachMerge = threeWayMerge(nachAufbau, aLokal, bLokal);
  const bNachMerge = threeWayMerge(nachAufbau, bLokal, aLokal);
  const zeigen = (t) => t.slice(BASE.length).split('\n').filter(Boolean).join(' | ');
  log(`\n[4] threeWayMerge gegen die Aufbau-Basis, je Seite:`);
  log(`    A rechnet: ${zeigen(aNachMerge)}`);
  log(`    B rechnet: ${zeigen(bNachMerge)}`);
  const konvergent = aNachMerge === bNachMerge;
  log(`    beide Seiten gleich: ${konvergent ? 'JA' : 'NEIN'}`);

  // Wo steht mB jetzt, relativ zu mB2? Das ist die Groesse, um die es geht.
  const posB = (t) => {
    const zs = t.slice(BASE.length).split('\n').filter(Boolean);
    return { mB: zs.findIndex((z) => z === m.mB), mB2: zs.findIndex((z) => z === m.mB2) };
  };
  const pa = posB(aNachMerge);
  const pb = posB(bNachMerge);
  const verschoben = pa.mB > pa.mB2 || pb.mB > pb.mB2;
  log(`\n[5] Steht mB nach dem Merge HINTER mB2 (also umsortiert)?`);
  log(`    A: mB an ${pa.mB}, mB2 an ${pa.mB2}  ->  ${pa.mB > pa.mB2 ? 'UMSORTIERT' : 'in Ordnung'}`);
  log(`    B: mB an ${pb.mB}, mB2 an ${pb.mB2}  ->  ${pb.mB > pb.mB2 ? 'UMSORTIERT' : 'in Ordnung'}`);

  // Yjs ordnet nebenlaeufige Einfuegungen NICHT lexikographisch, sondern nach
  // seinen eigenen Regeln (Item-Ordnung ueber clientID). Der Doc-Stand kann die
  // beiden Beitraege deshalb in der Entstehungsreihenfolge fuehren, waehrend die
  // `.md` aus dem Merge oben die sortierte Fassung traegt. Genau dieses Paar
  // trifft in den `unionMerge`-Stellen aufeinander.
  const docOrdnung = zeilen(m, ['mA', 'mB', 'mB2', 'mA2']);
  log(`\n[6] Doc-Stand in Entstehungsreihenfolge (wie Yjs ihn fuehren kann):`);
  log(`    ${zeigen(docOrdnung)}`);

  const vereinigtA = unionMerge(docOrdnung, aNachMerge);
  const vereinigtB = unionMerge(docOrdnung, bNachMerge);
  log(`\n[7] unionMerge(Doc-Stand, Merge-Ergebnis) — der Zusammenprall:`);
  log(`    mit As Fassung: ${zeigen(vereinigtA)}`);
  log(`    mit Bs Fassung: ${zeigen(vereinigtB)}`);

  const sig = (t) => ({
    mA: zaehle(t, m.mA), mB: zaehle(t, m.mB),
    mA2: zaehle(t, m.mA2), mB2: zaehle(t, m.mB2),
  });
  const sA = sig(vereinigtA);
  const sB = sig(vereinigtB);
  const fmt = (s) => `mA=${s.mA} mB=${s.mB} mA2=${s.mA2} mB2=${s.mB2}`;
  log(`\n[8] Zaehlung wie H-COUNT (Regex-Treffer im Volltext):`);
  log(`    mit As Fassung: ${fmt(sA)}`);
  log(`    mit Bs Fassung: ${fmt(sB)}`);

  const getroffen = sA.mB === 2 || sB.mB === 2;
  log(`\n[9] ERGEBNIS: mB doppelt? ${getroffen ? 'JA — Signatur reproduziert' : 'NEIN'}`);

  return { name: m.name, kehrtA, kehrtB, konvergent, verschoben, getroffen, text: out.join('\n') };
}

const r1 = lauf(ECHT);
const r2 = lauf(ORDNUNGSTREU);
console.log(r1.text);
console.log(r2.text);

console.log(`\n${'='.repeat(72)}`);
console.log('BILANZ — die beiden Arme unterscheiden sich NUR in den Marker-Namen');
console.log('='.repeat(72));
console.log(`  ${ECHT.name.padEnd(38)} kehrt-um=${r1.kehrtB}  mB-doppelt=${r1.getroffen}`);
console.log(`  ${ORDNUNGSTREU.name.padEnd(38)} kehrt-um=${r2.kehrtB}  mB-doppelt=${r2.getroffen}`);

if (r1.getroffen && !r2.getroffen) {
  console.log(`\n  ZUGEORDNET: Das zweite Vorkommen entsteht an text-merge.ts:245`);
  console.log(`  ([ta,tb].sort()). Der Gegenarm ist zeichengleich bis auf die Namen`);
  console.log(`  und bleibt sauber — die Sortierstelle ist die einzige Variable.`);
} else if (r1.getroffen && r2.getroffen) {
  console.log(`\n  NICHT ZUGEORDNET: Auch der ordnungstreue Arm dupliziert. Die`);
  console.log(`  Sortierstelle ist dann nicht die (alleinige) Ursache.`);
} else if (!r1.getroffen) {
  console.log(`\n  NICHT REPRODUZIERT: Der echte Arm zeigt die Signatur hier nicht.`);
  console.log(`  Diese Kette ist damit NICHT der Weg, auf dem das Duplikat entsteht —`);
  console.log(`  weder bestaetigt noch widerlegt ist damit eine andere Kette.`);
}
