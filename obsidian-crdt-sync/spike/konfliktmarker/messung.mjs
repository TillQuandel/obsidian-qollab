// messung.mjs — Was tun die echten Merge-Funktionen mit einer `.md`, die
// Git-Konfliktmarker traegt?
//
// Warum diese Messung existiert: `docs/produktziel.md` („Offene Widersprueche",
// Punkt 5) behauptet, Qollab wuerde einen Git-Konflikt nicht aufloesen, sondern
// VERTEILEN — die Markerzeilen wanderten als gewoehnlicher Text ins CRDT und von
// dort ueber die eigene Hilfsdatei zu allen Peers, und `unionMerge` koenne sie
// nicht wieder entfernen. Diese Behauptung ist aus dem Kontrollfluss GELESEN,
// nicht gemessen. Gelesene Behauptungen sind im Repo mehrfach an der Messung
// zerbrochen (zuletzt: zwei Drittel eines Grundtextbefunds waren Messartefakt).
// Also nachrechnen, an `unionMerge` und `threeWayMerge` selbst.
//
// Warum harness-frei: Jest ist hier gesperrt (paralleler Testlauf im selben
// Cache). `bauen.mjs` buendelt `src/text-merge.ts` nach `merge.cjs`, mehr braucht
// es nicht — die beiden Funktionen sind reine Textfunktionen ohne Obsidian.
//
// Aufruf (aus obsidian-crdt-sync/):
//   node spike/konfliktmarker/bauen.mjs && node spike/konfliktmarker/messung.mjs

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { unionMerge, threeWayMerge } = require(path.join(here, 'merge.cjs'));

// ---------------------------------------------------------------------------
// Fixtures
//
// Realistisch heisst hier: eine Notiz mit Ueberschrift, unveraenderten Zeilen
// oben und unten und EINEM Konfliktblock in der Mitte — so sieht die Datei aus,
// die `git merge` im Vault stehen laesst. Der Minimalfall daneben dient nur der
// Lesbarkeit des Mechanismus; ein Befund, den nur er zeigt, waere keiner.
// ---------------------------------------------------------------------------

// Der Stand, den beide Seiten vor dem Git-Konflikt kannten.
const gemeinsam = [
  '# Wochenplan',
  '',
  'Fester Absatz oben.',
  '',
  '- Termin: offen',
  '',
  'Fester Absatz unten.',
  '',
].join('\n');

// Was der Peer im CRDT traegt: er hat den Termin auf Mittwoch gesetzt.
const peerStand = [
  '# Wochenplan',
  '',
  'Fester Absatz oben.',
  '',
  '- Termin: Mittwoch 14:00',
  '',
  'Fester Absatz unten.',
  '',
].join('\n');

// Was `git merge` auf dem Geraet in die `.md` schreibt: eigene Aenderung
// (Dienstag) gegen die fremde (Mittwoch), Konfliktblock in der Mitte.
const markerStand = [
  '# Wochenplan',
  '',
  'Fester Absatz oben.',
  '',
  '<<<<<<< HEAD',
  '- Termin: Dienstag 10:00',
  '=======',
  '- Termin: Mittwoch 14:00',
  '>>>>>>> abc1234',
  '',
  'Fester Absatz unten.',
  '',
].join('\n');

// Von Hand aufgeraeumt: Marker weg, nur die eigene Seite behalten.
const aufgeraeumt = [
  '# Wochenplan',
  '',
  'Fester Absatz oben.',
  '',
  '- Termin: Dienstag 10:00',
  '',
  'Fester Absatz unten.',
  '',
].join('\n');

// Ein Peer, der auf dem verteilten Markerstand unabhaengig weitergearbeitet hat
// — damit `threeWayMerge` in Frage 2 nicht am trivialen Fall „Gegenseite hat
// nichts getan" gemessen wird.
const peerAufMarker = markerStand.replace(
  'Fester Absatz unten.',
  'Fester Absatz unten. Nachtrag vom Peer.'
);

const minGemeinsam = 'Zeile\n';
const minMarker = [
  '<<<<<<< HEAD',
  'meine Zeile',
  '=======',
  'fremde Zeile',
  '>>>>>>> abc1234',
  '',
].join('\n');
const minPeer = 'fremde Zeile\n';
const minAufgeraeumt = 'meine Zeile\n';

// ---------------------------------------------------------------------------
// Werkzeug
// ---------------------------------------------------------------------------

const MARKER = ['<<<<<<<', '=======', '>>>>>>>'];

// Zaehlt Markerzeilen. Bewusst zeilen-, nicht zeichenbasiert: `=======` mitten in
// einer Zeile waere ein Trennstrich, nur am Zeilenanfang ist es ein Git-Marker.
function marker(text) {
  const treffer = { '<<<<<<<': 0, '=======': 0, '>>>>>>>': 0 };
  for (const z of text.split('\n')) {
    for (const m of MARKER) if (z.startsWith(m)) treffer[m]++;
  }
  return treffer;
}

const markerSumme = (text) => Object.values(marker(text)).reduce((a, b) => a + b, 0);

const markerZeile = (text) => {
  const t = marker(text);
  return `<<<<<<< ${t['<<<<<<<']}  ======= ${t['=======']}  >>>>>>> ${t['>>>>>>>']}  (Summe ${markerSumme(text)})`;
};

function zeige(titel, text) {
  console.log(`  ${titel}  [${text.length} Zeichen]`);
  for (const z of text.split('\n')) console.log(`    | ${z}`);
}

function ueberschrift(t) {
  console.log('');
  console.log('='.repeat(78));
  console.log(t);
  console.log('='.repeat(78));
}

const urteile = [];
function urteil(text) {
  urteile.push(text);
  console.log(`  >> ${text}`);
}

// ---------------------------------------------------------------------------
// Frage 1 — Ueberleben die Markerzeilen den Merge?
// ---------------------------------------------------------------------------

ueberschrift('FRAGE 1 — Ueberleben die Markerzeilen den Merge?');

console.log('Ausgangslage (realistisch):');
zeige('markerStand (die .md nach `git merge`)', markerStand);
zeige('peerStand (was der Peer im CRDT traegt)', peerStand);
console.log(`  Marker in markerStand: ${markerZeile(markerStand)}`);

console.log('');
console.log('--- unionMerge(other = peerStand, local = markerStand) ---');
const u1 = unionMerge(peerStand, markerStand);
zeige('Ergebnis', u1);
console.log(`  Marker im Ergebnis: ${markerZeile(u1)}`);
urteil(
  `unionMerge: Marker ueberleben ${markerSumme(u1) === 3 ? 'VOLLSTAENDIG' : `teilweise (${markerSumme(u1)}/3)`}`
);

console.log('');
console.log('--- unionMerge(other = markerStand, local = peerStand) ---');
console.log('  (Gegenrichtung: der saubere Peer zieht die Markerfassung)');
const u1r = unionMerge(markerStand, peerStand);
zeige('Ergebnis', u1r);
console.log(`  Marker im Ergebnis: ${markerZeile(u1r)}`);
urteil(
  `unionMerge (Gegenrichtung, also beim PEER): Marker ${markerSumme(u1r) === 3 ? 'kommen vollstaendig an' : `nur teilweise (${markerSumme(u1r)}/3)`}`
);

console.log('');
console.log('--- threeWayMerge(base = gemeinsam, local = markerStand, other = peerStand) ---');
const t1 = threeWayMerge(gemeinsam, markerStand, peerStand);
zeige('Ergebnis', t1);
console.log(`  Marker im Ergebnis: ${markerZeile(t1)}`);
urteil(
  `threeWayMerge: Marker ueberleben ${markerSumme(t1) === 3 ? 'VOLLSTAENDIG' : `teilweise (${markerSumme(t1)}/3)`}`
);

console.log('');
console.log('--- Kontrolle: traegt das Ergebnis mehr als markerStand? ---');
console.log(`  markerStand ${markerStand.length} Zeichen, union ${u1.length}, dreiWeg ${t1.length}`);
console.log(`  union === markerStand: ${u1 === markerStand}   dreiWeg === markerStand: ${t1 === markerStand}`);
console.log('  (Der Peer-Text steht bereits IM Konfliktblock — deshalb kommt nichts hinzu.');
console.log('   Der naechste Fall prueft einen Peer, der unabhaengig woanders geschrieben hat.)');
const peerAktiv = peerStand.replace('Fester Absatz unten.', 'Fester Absatz unten. Nachtrag vom Peer.');
const u1a = unionMerge(peerAktiv, markerStand);
const t1a = threeWayMerge(gemeinsam, markerStand, peerAktiv);
zeige('unionMerge(peerAktiv, markerStand)', u1a);
zeige('threeWayMerge(gemeinsam, markerStand, peerAktiv)', t1a);
console.log(`  Marker union   : ${markerZeile(u1a)}`);
console.log(`  Marker dreiWeg : ${markerZeile(t1a)}`);

console.log('');
console.log('--- Minimalfall ---');
const uMin = unionMerge(minPeer, minMarker);
const tMin = threeWayMerge(minGemeinsam, minMarker, minPeer);
zeige('unionMerge(minPeer, minMarker)', uMin);
zeige('threeWayMerge(minGemeinsam, minMarker, minPeer)', tMin);
console.log(`  Marker union   : ${markerZeile(uMin)}`);
console.log(`  Marker dreiWeg : ${markerZeile(tMin)}`);

// ---------------------------------------------------------------------------
// Frage 2 — Kann ein spaeterer Merge die Marker wieder entfernen?
// ---------------------------------------------------------------------------

ueberschrift('FRAGE 2 — Kann ein spaeterer Merge die Marker wieder entfernen?');

console.log('Szenario: Der Markerstand hat sich verteilt, alle Peers tragen ihn.');
console.log('Ein Geraet raeumt von Hand auf (behaelt nur die HEAD-Seite).');
zeige('aufgeraeumt (lokal, von Hand)', aufgeraeumt);
console.log(`  Marker in aufgeraeumt: ${markerZeile(aufgeraeumt)}`);

console.log('');
console.log('--- unionMerge(other = markerStand, local = aufgeraeumt) ---');
const a1 = unionMerge(markerStand, aufgeraeumt);
zeige('Ergebnis', a1);
console.log(`  Marker im Ergebnis: ${markerZeile(a1)}`);
urteil(
  `unionMerge nach Aufraeumen: Marker ${markerSumme(a1) > 0 ? `KOMMEN ZURUECK (${markerSumme(a1)}/3)` : 'bleiben weg'}`
);

console.log('');
console.log('--- threeWayMerge(base = markerStand, local = aufgeraeumt, other = markerStand) ---');
console.log('  (Peer unveraendert — der guenstigste Fall fuers Aufraeumen)');
const b1 = threeWayMerge(markerStand, aufgeraeumt, markerStand);
zeige('Ergebnis', b1);
console.log(`  Marker im Ergebnis: ${markerZeile(b1)}`);
urteil(
  `threeWayMerge nach Aufraeumen (Peer untaetig): Marker ${markerSumme(b1) > 0 ? `kommen zurueck (${markerSumme(b1)}/3)` : 'BLEIBEN WEG'}`
);

console.log('');
console.log('--- threeWayMerge(base = markerStand, local = aufgeraeumt, other = peerAufMarker) ---');
console.log('  (Peer hat auf dem Markerstand unabhaengig weitergeschrieben)');
const b2 = threeWayMerge(markerStand, aufgeraeumt, peerAufMarker);
zeige('Ergebnis', b2);
console.log(`  Marker im Ergebnis: ${markerZeile(b2)}`);
urteil(
  `threeWayMerge nach Aufraeumen (Peer aktiv): Marker ${markerSumme(b2) > 0 ? `kommen zurueck (${markerSumme(b2)}/3)` : 'BLEIBEN WEG'}`
);

console.log('');
console.log('--- Minimalfall Aufraeumen ---');
const aMin = unionMerge(minMarker, minAufgeraeumt);
const bMin = threeWayMerge(minMarker, minAufgeraeumt, minMarker);
zeige('unionMerge(minMarker, minAufgeraeumt)', aMin);
zeige('threeWayMerge(minMarker, minAufgeraeumt, minMarker)', bMin);
console.log(`  Marker union   : ${markerZeile(aMin)}`);
console.log(`  Marker dreiWeg : ${markerZeile(bMin)}`);

// ---------------------------------------------------------------------------
// Frage 3 — Wo unterscheiden sich die beiden Verfahren?
// ---------------------------------------------------------------------------

ueberschrift('FRAGE 3 — Unterschied unionMerge / threeWayMerge');

const tabelle = [
  ['Marker eingeschleppt (Frage 1)', markerSumme(u1), markerSumme(t1)],
  ['Marker nach Aufraeumen, Peer untaetig', markerSumme(a1), markerSumme(b1)],
  ['Marker nach Aufraeumen, Peer aktiv', markerSumme(unionMerge(peerAufMarker, aufgeraeumt)), markerSumme(b2)],
];
console.log('  Lage                                        union   dreiWeg');
for (const [n, u, t] of tabelle) {
  console.log(`  ${n.padEnd(42)}  ${String(u).padStart(5)}   ${String(t).padStart(7)}`);
}
urteil(
  'Beim EINSCHLEPPEN verhalten sich beide gleich; beim ENTFERNEN trennen sie sich '
  + '(dreiWeg hat einen Vorfahren, an dem die Loeschung ablesbar ist, union nicht)'
);

// ---------------------------------------------------------------------------
// Frage 4 — Waechst der Text bei wiederholtem Mergen?
// ---------------------------------------------------------------------------

ueberschrift('FRAGE 4 — Waechst der Text bei wiederholtem Mergen?');

// Wiederholt heisst hier: das Ergebnis geht als neuer LOKALER Stand erneut gegen
// dieselbe Gegenseite. Genau so laeuft es im Produkt, wenn der Peer den alten
// Stand noch fuehrt und die Runde erneut ausgeloest wird.
function runden(name, schritt, start, gegen) {
  const laengen = [start.length];
  let x = start;
  for (let i = 0; i < 3; i++) {
    x = schritt(x, gegen);
    laengen.push(x.length);
  }
  const stabil = laengen[1] === laengen[2] && laengen[2] === laengen[3];
  console.log(`  ${name}`);
  console.log(`    Zeichen: ${laengen.join(' -> ')}   ${stabil ? 'stabil ab Runde 1' : 'NICHT STABIL'}`);
  console.log(`    Marker letzte Runde: ${markerZeile(x)}`);
  return { laengen, stabil, ergebnis: x };
}

const r1 = runden(
  'union: lokal = markerStand, gegen = peerStand',
  (lokal, gegen) => unionMerge(gegen, lokal),
  markerStand,
  peerStand
);
const r2 = runden(
  'union: lokal = aufgeraeumt, gegen = markerStand (Aufraeum-Schleife)',
  (lokal, gegen) => unionMerge(gegen, lokal),
  aufgeraeumt,
  markerStand
);
const r3 = runden(
  'dreiWeg: base = gemeinsam, lokal = markerStand, gegen = peerStand',
  (lokal, gegen) => threeWayMerge(gemeinsam, lokal, gegen),
  markerStand,
  peerStand
);
const r4 = runden(
  'dreiWeg: base = markerStand, lokal = aufgeraeumt, gegen = peerAufMarker',
  (lokal, gegen) => threeWayMerge(markerStand, lokal, gegen),
  aufgeraeumt,
  peerAufMarker
);

// Der wachstumsanfaellige Zweig: BEIDE Geraete raeumen von Hand auf, aber
// verschieden (jedes behaelt seine Seite). Dann greift in `dreiWegeZeilen` der
// Zweig „beide Fassungen behalten" — genau dort sass die frueher gemessene
// Nicht-Idempotenz (132 -> 150 -> 168). Ohne diesen Fall waere Frage 4 an der
// einfachen Lage gemessen und der Befund „kein Wachstum" waere blind.
console.log('');
console.log('  Sonderlage: beide Geraete raeumen auf, aber verschieden');
const raeumtDienstag = aufgeraeumt;
const raeumtMittwoch = markerStand
  .split('\n')
  .filter((z) => !MARKER.some((m) => z.startsWith(m)) && z !== '- Termin: Dienstag 10:00')
  .join('\n');
zeige('  Geraet A (Dienstag)', raeumtDienstag);
zeige('  Geraet B (Mittwoch)', raeumtMittwoch);
const r5 = runden(
  'union: lokal = A, gegen = B',
  (lokal, gegen) => unionMerge(gegen, lokal),
  raeumtDienstag,
  raeumtMittwoch
);
const r6 = runden(
  'dreiWeg: base = markerStand, lokal = A, gegen = B',
  (lokal, gegen) => threeWayMerge(markerStand, lokal, gegen),
  raeumtDienstag,
  raeumtMittwoch
);
zeige('  dreiWeg-Ergebnis nach Runde 3', r6.ergebnis);

const alleStabil = [r1, r2, r3, r4, r5, r6].every((r) => r.stabil);
urteil(
  alleStabil
    ? 'Kein Wachstum: alle sechs Wiederholungen sind ab Runde 1 laengenstabil'
    : 'WACHSTUM: mindestens eine Wiederholung waechst weiter'
);

// ---------------------------------------------------------------------------
// Frage 5 — Erkennung im Repo?
// ---------------------------------------------------------------------------

ueberschrift('FRAGE 5 — Erkennung im Repo (per grep separat gemessen)');
console.log('  Suche in obsidian-crdt-sync/src und /tests nach');
console.log('    <<<<<<<   >>>>>>>   Konfliktmark*   "conflict marker"   conflictMarker');
console.log('  Treffer: 0 (einziger Treffer im gesamten Repo: docs/produktziel.md,');
console.log('  also die Behauptung selbst).');
console.log('  "conflict"/"Konflikt" in src/ trifft ausschliesslich SYNC-Konflikte');
console.log('  (saveConflictCopy in main.ts:1591, .sync-conflict-* in sidecar-watcher.ts)');
console.log('  — nicht Git-Konfliktmarker im Notiztext.');
urteil('Keine Erkennung, kein Test, keine Doku fuer Git-Konfliktmarker in src/ und tests/');

// ---------------------------------------------------------------------------
// Gesamturteil
// ---------------------------------------------------------------------------

ueberschrift('GESAMTURTEIL');
for (const u of urteile) console.log('  - ' + u);
console.log('');
// Welche der beiden Funktionen der geparkte Fremdtext tatsaechlich trifft, ist
// nicht Geschmackssache: `sync-handler.ts:514` loest das Parken mit
// `unionMerge(p.text, doc)` auf. Die Behauptung benennt damit den richtigen Weg
// — und es ist der, der die Marker nicht wieder loswird.
console.log('  Weg im Produkt: geparkter Fremdtext -> unionMerge (sync-handler.ts:514).');
console.log('  threeWayMerge laeuft nur im Merge-Fenster-Zweig (main.ts:1497) und bei');
console.log('  sync-handler.ts:1847 — nicht beim Parken.');
console.log('');
const verteilt = markerSumme(u1) === 3 && markerSumme(u1r) === 3;
console.log(
  `  WIRD EIN GIT-KONFLIKT VERTEILT? ${verteilt ? 'JA' : 'NEIN'}`
);
console.log(
  `  WIRD ER WIEDER LOSGEWORDEN? union: ${markerSumme(a1) > 0 ? 'NEIN' : 'ja'}`
  + `   dreiWeg: ${markerSumme(b1) === 0 && markerSumme(b2) === 0 ? 'JA' : 'nein'}`
);
