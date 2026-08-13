// sweep-basis.mjs — Unter WELCHER Basis verdoppelt der Sweep-Merge `mB`?
//
// ── WARUM DIESE PROBE DIE FRAGE VERSCHIEBT ─────────────────────────────────
// Die Aktenlage fuehrt als „offensichtlichen Kandidaten" fuer `r13`: „Der
// Startup-Sweep loest ihn per `unionMerge` auf, und der hat keinen gemeinsamen
// Vorfahren, kann also per Konstruktion nicht deduplizieren."
//
// Im Code gelesen (nicht gemessen) trifft das den Pfad nicht:
//
//   `mergeForLocalDiff(notePath, content, imSweep=true)` (sync-handler.ts:1748)
//     -> `adopted` ist im Sweep von `r13` FALSE: B hat eigenen State, `ensureDoc`
//        adoptiert nicht. Der `unite`/`unionMerge`-Zweig (`:1837`) haengt aber
//        genau an `base === undefined`, und das gilt NUR bei `adopted`.
//     -> Der own-Branch endet stattdessen auf
//        `threeWayMerge(base, content, mergedText)` (`:1847`).
//
// `unionMerge` laeuft in diesem Pfad also gar nicht. Gemessen werden muss der
// 3-Wege-Merge — und dessen Ergebnis haengt vollstaendig an der BASIS.
//
// ── WAS DIE BASIS IM SWEEP IST — strukturell, nicht zufaellig ───────────────
// `chooseLocalDiffBase` (sync-handler.ts:1880-1893) beginnt mit:
//     const lastSeen = this.localDiffBase.get(notePath);
//     if (lastSeen === undefined) return docBeforeMerge;
// und `localDiffBase` ist eine reine In-Memory-Map (`sync-handler.ts:350`,
// bestaetigt durch den Kommentar `:365`: „Rein in-memory ... Nach einem
// Neustart"). Im Startup-Sweep ist sie damit IMMER leer — die Note wird dort
// zum ersten Mal in dieser Sitzung angefasst. Die Basis ist also strukturell
// `docBeforeMerge`, und der `lastSeen`/`lead`-Zweig darunter ist im Sweep-Pfad
// unerreichbar.
//
// (Zweiter moeglicher Basiswert: `fremdBasis` aus der Sweep-Schranke. Deren
// Standard ist entgegen dem Kommentar in `main.ts:1375` NICHT 'aus', sondern
// 'basis-signatur' — `sync-handler.ts:132-135`. Auch sie wird hier mitgefahren.)
//
// ── DIE FRAGE, DIE DIESE PROBE BEANTWORTET ─────────────────────────────────
// Bei festen `content` und `other` — beide aus dem Runner ablesbar — wird JEDE
// geordnete Teilmenge der Marker als Basis durchgefahren. Ergebnis ist die
// vollstaendige Menge der Basis-Staende, unter denen `mB` doppelt endet. Was
// die trennt, ist die Bedingung, die der Realtest dann nur noch pruefen muss.
//
// GEGENPROBE: Der Lauf zeigt beide Seiten — die Basen, unter denen `mB` doppelt
// wird, UND die, unter denen es sauber bleibt. Ein Ergebnis „alle duplizieren"
// oder „keine dupliziert" waere ein Hinweis auf ein blindes Instrument und wird
// ausdruecklich als solcher gemeldet.
//
// Aufruf (aus obsidian-crdt-sync/):
//   node spike/duplikat-mb/sweep-basis.mjs

import { createRequire } from 'node:module';
const require_ = createRequire(import.meta.url);
const { threeWayMerge, unionMerge } = require_('./merge.cjs');

const BASE = [
  '# Meetingprotokoll', '', 'Punkt 1: Ausgangslage', 'Punkt 2: Beschluss', '', 'Ende der Vorlage',
].join('\n') + '\n';

// Die Marker aus r13-cdp.ps1:53-56.
const RUN = 'r13cdp-20260812-205534';
const M = {
  mA: `AAA-${RUN}`,
  mB: `BBB-${RUN}`,
  mA2: `A2-${RUN}`,
  mOff: `OFFLINE-B-${RUN}`,
};
const NAMEN = Object.keys(M);

for (const a of NAMEN) for (const b of NAMEN) {
  if (a !== b && M[b].includes(M[a])) throw new Error(`Marker ${a} ist Teilstring von ${b}.`);
}

const zaehle = (t, m) => {
  let n = 0, i = t.indexOf(m);
  while (i !== -1) { n++; i = t.indexOf(m, i + m.length); }
  return n;
};
const fassung = (f) => BASE + (f.length ? f.map((k) => M[k]).join('\n') + '\n' : '');
const zeig = (f) => f.length ? f.join(' ') : '(nur BASE)';

function geordneteTeilmengen(namen) {
  const raus = [[]];
  const rek = (p, rest) => {
    for (let i = 0; i < rest.length; i++) {
      const n = [...p, rest[i]];
      raus.push(n);
      rek(n, [...rest.slice(0, i), ...rest.slice(i + 1)]);
    }
  };
  rek([], namen);
  return raus;
}

// ── Die feste Lage aus r13, Schritt fuer Schritt aus dem Runner gelesen ─────
// r13-cdp.ps1:105  B's `.md` wird bei GESCHLOSSENER App extern ergaenzt:
//                  H-WRITE-NOTE 'b' $note ((H-READ 'b' $note) + "`n$mOff")
//                  Der gelesene Stand ist der Aufbau-Stand [mA mB].
const content = fassung(['mA', 'mB', 'mOff']);
// r13-cdp.ps1:91   A hatte vorher im Prozess $mA2 angehaengt; :106 stellt genau
//                  As Hilfsdatei zu. Nach `mergePendingForeign` traegt der Doc
//                  also den Aufbau-Stand plus mA2.
const other = fassung(['mA', 'mB', 'mA2']);

console.log('LAGE (aus r13-cdp.ps1 gelesen)');
console.log(`  content (Bs .md nach externem Write) : ${zeig(['mA', 'mB', 'mOff'])}`);
console.log(`  other   (Doc nach Fremd-Merge)       : ${zeig(['mA', 'mB', 'mA2'])}`);
console.log(`  base    (= docBeforeMerge)           : durchgefahren, alle 65 Faelle\n`);

const dopplet = [];
const sauber = [];
for (const bf of geordneteTeilmengen(NAMEN)) {
  const erg = threeWayMerge(fassung(bf), content, other);
  const z = { mA: zaehle(erg, M.mA), mB: zaehle(erg, M.mB), mA2: zaehle(erg, M.mA2), mOff: zaehle(erg, M.mOff) };
  const eintrag = { bf, z, erg, hatMB: bf.includes('mB') };
  if (z.mB > 1) dopplet.push(eintrag); else sauber.push(eintrag);
}

console.log(`Basen, unter denen mB DOPPELT endet: ${dopplet.length} von 65`);
console.log(`Basen, unter denen mB sauber bleibt: ${sauber.length} von 65\n`);

if (dopplet.length === 0 || dopplet.length === 65) {
  console.log('  ACHTUNG: einseitiges Ergebnis — als Instrumentenbefund lesen, nicht als Produktbefund.');
}

// ── Welche Eigenschaft trennt die beiden Gruppen? ──────────────────────────
// Mehrere Kandidaten werden gegeneinander gefahren, statt den erstbesten zu
// nehmen. Gesucht ist eine Eigenschaft, unter der KEINE Basis dupliziert
// (Spalte „dup & eig" = 0) — eine hinreichende Bedingung fuer Sauberkeit.
const eigenschaften = {
  'Basis enthaelt mB': (b) => b.includes('mB'),
  'Basis enthaelt mA und mB': (b) => b.includes('mA') && b.includes('mB'),
  'Basis fuehrt mA VOR mB': (b) =>
    b.includes('mA') && b.includes('mB') && b.indexOf('mA') < b.indexOf('mB'),
  'Basis fuehrt mA unmittelbar vor mB': (b) => b[b.indexOf('mA') + 1] === 'mB',
};
console.log('WELCHE EIGENSCHAFT DER BASIS TRENNT?');
console.log('  (gesucht: "dup & eig" = 0 — unter dieser Eigenschaft dupliziert keine Basis)');
for (const [name, pruef] of Object.entries(eigenschaften)) {
  const dupMit = dopplet.filter((d) => pruef(d.bf)).length;
  const sauberMit = sauber.filter((d) => pruef(d.bf)).length;
  const hinreichend = dupMit === 0 && sauberMit > 0;
  console.log(
    `  ${hinreichend ? 'HINREICHEND' : '           '} ${name.padEnd(36)}` +
      ` dup & eig = ${dupMit}, sauber & eig = ${sauberMit}`
  );
}
console.log(
  '\n  Lesart: Gibt die Basis die Aufbau-Reihenfolge mA -> mB wieder, bleibt mB\n' +
    '  einfach. Alle duplizierenden Basen geben sie NICHT wieder — sie lassen mB\n' +
    '  entweder ganz aus oder fuehren es vor mA. Umgekehrt gilt das nicht: nicht\n' +
    '  jede Basis ohne diese Reihenfolge dupliziert. Die Eigenschaft ist damit\n' +
    '  hinreichend fuer Sauberkeit, nicht notwendig fuer das Duplikat.\n'
);

console.log('Alle duplizierenden Basen:');
for (const d of dopplet) {
  console.log(`  [${zeig(d.bf).padEnd(18)}]  mA=${d.z.mA} mB=${d.z.mB} mA2=${d.z.mA2} mOff=${d.z.mOff}`);
}

if (dopplet.length) {
  console.log('\nEin duplizierendes Ergebnis im Volltext (Marker-Teil):');
  console.log('    ' + dopplet[0].erg.slice(BASE.length).split('\n').filter(Boolean).join('\n    '));
}

// ── Gegenprobe 1: sieht der Aufbau-Stand als Basis sauber aus? ──────────────
// Das ist die Basis, die ein Sweep mit korrektem docBeforeMerge haette.
const korrekt = threeWayMerge(fassung(['mA', 'mB']), content, other);
console.log('\n=== Gegenprobe 1: Basis = Aufbau-Stand [mA mB] (der erwartete Fall) ===');
console.log(`    ${korrekt.slice(BASE.length).split('\n').filter(Boolean).join(' | ')}`);
console.log(`    mB kommt ${zaehle(korrekt, M.mB)} mal vor -> ${zaehle(korrekt, M.mB) === 1 ? 'sauber, wie erwartet' : 'DOPPELT — die Erklaerung traegt nicht'}`);

// ── Gegenprobe 2: was taete unionMerge an derselben Stelle? ─────────────────
// Der Kandidat der Aktenlage. Er laeuft in diesem Pfad nicht (siehe Kopf), aber
// sein Ergebnis gehoert danebengestellt, damit die Unterscheidung belegt ist
// statt behauptet.
const union = unionMerge(other, content);
console.log('\n=== Gegenprobe 2: unionMerge(other, content) — der Kandidat der Aktenlage ===');
console.log(`    ${union.slice(BASE.length).split('\n').filter(Boolean).join(' | ')}`);
console.log(`    mB kommt ${zaehle(union, M.mB)} mal vor, mA ${zaehle(union, M.mA)} mal`);
console.log(`    -> ${zaehle(union, M.mB) === 2 ? 'wuerde mB verdoppeln' : 'wuerde mB NICHT verdoppeln'}`);

// ── Gegenprobe 3: sieht das Instrument ueberhaupt ein mB-Duplikat? ──────────
const blind = threeWayMerge(fassung(['mA']), content, other);
console.log('\n=== Gegenprobe 3: kann das Instrument ein mB-Duplikat sehen? ===');
console.log(`    Basis ohne mB -> mB kommt ${zaehle(blind, M.mB)} mal vor`);
console.log(`    ${zaehle(blind, M.mB) > 1 ? 'JA — nicht blind.' : 'NEIN — Lauf ungueltig, Instrument blind.'}`);
if (zaehle(blind, M.mB) <= 1) process.exitCode = 1;
