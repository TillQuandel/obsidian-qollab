// zeilenende.mjs — Wirkungsnachweis: `threeWayMerge` klebte zwei Zeilen
// aneinander, wenn ein Stand nicht auf einem Zeilenumbruch endet.
//
// Fährt BEIDE Fassungen gegeneinander (`bauen.mjs` legt sie an):
//   merge-vor-fix.cjs   Stand c8b8710 — der Schaden muss AUFTRETEN
//   merge.cjs           Arbeitsbaum   — der Schaden muss AUSBLEIBEN
// Ohne den kaputten Arm wäre „sauber" nicht von „der Fall trat nicht ein" zu
// unterscheiden. Beide Richtungen werden deshalb geprüft und einzeln gemeldet.
//
// ── WIE DER BEFUND GEFUNDEN WURDE ──────────────────────────────────────────
// `r13-cdp-lokal.ps1` und `r14-cdp-lokal.ps1` (2026-08-13, zwei echte
// Obsidian-Instanzen) haben das vermeintliche Duplikat einem Schritt zugeordnet:
//     r13:  M6 vor dem Startup-Sweep, App ZU  -> mB = 1   |  M7 danach -> mB = 2
//     r14:  M7 vor der Zustellung             -> mB = 1   |  M8 danach -> mB = 2
// Der Endtext beider Läufe enthält `A2-<RunId>BBB-<RunId>` — zwei Marker auf
// EINER Zeile. In `r13` sind beide Vaults byte-gleich (217 Zeichen): konvergenter
// und damit stiller Schaden. Es war nie eine doppelte Zeile; `H-COUNT` zählt
// Regex-Treffer im Volltext, deshalb sah die Verschmelzung wie eine Verdopplung
// aus.
//
// ── WAS DAMIT AUS DER AKTENLAGE FÄLLT ──────────────────────────────────────
// Der Folgeprompt führte als „offensichtlichen Kandidaten": „Der Startup-Sweep
// löst ihn per `unionMerge` auf, und der ... kann per Konstruktion nicht
// deduplizieren." Beide Hälften halten nicht:
//   1. `unionMerge` läuft in diesem Pfad gar nicht — der `unite`-Zweig
//      (sync-handler.ts:1837) hängt an `base === undefined` und damit an
//      `adopted`; in `r13`/`r14` hat B eigenen State, es wird nicht adoptiert.
//      Der own-Branch endet auf `threeWayMerge` (`:1847`).
//   2. `unionMerge` wäre dort die LÖSUNG gewesen: mit denselben Eingaben liefert
//      es 191 Zeichen und `mB` genau einmal (Abschnitt 3 unten).
//
// ── DIE URSACHE ────────────────────────────────────────────────────────────
// `diff_linesToChars_` tokenisiert INKLUSIVE Zeilenende. `unionMerge` fängt das
// seit Review C-1 mit `padLast` ab (text-merge.ts:376-379) und beschreibt den
// Schaden wörtlich; `threeWayMerge` rief `dreiWegeZeilen` ohne diese Garantie.
// Beim Wechsel auf den zeilenweisen 3-Wege-Merge (Registratur `T-04`, eingebaut
// 2026-08-11) wurde der Fix nicht mitgezogen.
//
// ── WARUM ES NIEMAND SAH ───────────────────────────────────────────────────
// `tests/three-way-line-endings.test.ts` prüfte CRLF, LF und BOM — 26 Fixtures,
// und alle 26 endeten auf einem Zeilenumbruch. Genau der Fall, den `unionMerge`s
// eigener Kommentar „in Obsidian der Normalfall" nennt, war nicht abgedeckt.
// Seit dem Fix steht dort ein eigener describe-Block.
//
// Aufruf (aus obsidian-crdt-sync/):
//   node spike/duplikat-mb/bauen.mjs && node spike/duplikat-mb/zeilenende.mjs

import { createRequire } from 'node:module';
const require_ = createRequire(import.meta.url);
const alt = require_('./merge-vor-fix.cjs');
const neu = require_('./merge.cjs');

const zaehle = (t, m) => t.split(m).length - 1;
let fehler = 0;
const pruef = (name, ist, soll) => {
  const ok = JSON.stringify(ist) === JSON.stringify(soll);
  if (!ok) fehler++;
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${name}`);
  if (!ok) console.log(`       ist  ${JSON.stringify(ist)}\n       soll ${JSON.stringify(soll)}`);
};

console.log('=== 1. Der kleinste Fall ===');
const kAlt = alt.threeWayMerge('a\nb', 'a\nb\nX', 'a\nb\nY');
const kNeu = neu.threeWayMerge('a\nb', 'a\nb\nX', 'a\nb\nY');
console.log(`  ohne Fix: ${JSON.stringify(kAlt)}`);
console.log(`  mit  Fix: ${JSON.stringify(kNeu)}`);
pruef('ohne Fix klebt b an X (der Schaden tritt auf)', kAlt, 'a\nb\nXb\nY');
pruef('mit Fix bleiben die Zeilen getrennt', kNeu, 'a\nb\nX\nY');

console.log('\n=== 2. Dieselbe Lage wie im Realtest r13 (byte-genau) ===');
const BASE =
  ['# Meetingprotokoll', '', 'Punkt 1: Ausgangslage', 'Punkt 2: Beschluss', '', 'Ende der Vorlage'].join('\n') + '\n';
const R = 'r13lok-20260812-235416';
const mA = `AAA-${R}`, mB = `BBB-${R}`, mA2 = `A2-${R}`, mOff = `OFFLINE-B-${R}`;
// So baut der Runner: jeder Edit hängt "\n"+Marker an, nie ein Schluss-Umbruch.
const aufbau = BASE + mA + '\n' + mB;      // Messpunkt M1/M2: 132 Zeichen
const content = aufbau + '\n' + mOff;      // Messpunkt M5/M6: 165 Zeichen
const doc = aufbau + '\n' + mA2;           // Messpunkt M3:    158 Zeichen
pruef('Aufbau-Stand trifft den Messpunkt', aufbau.length, 132);
pruef('Bs .md trifft den Messpunkt', content.length, 165);
pruef('As Stand trifft den Messpunkt', doc.length, 158);

const rAlt = alt.threeWayMerge(aufbau, content, doc);
const rNeu = neu.threeWayMerge(aufbau, content, doc);
pruef('ohne Fix: der gemessene Endtext (217 Zeichen)', rAlt.length, 217);
pruef('ohne Fix: mB zählt zweimal — wie der rote Assert', zaehle(rAlt, mB), 2);
pruef('ohne Fix: die verschmolzene Zeile steht wörtlich drin', rAlt.includes(`${mA2}${mB}`), true);
pruef('mit Fix: mB zählt einmal', zaehle(rNeu, mB), 1);
pruef('mit Fix: keine verschmolzene Zeile', rNeu.includes(`${mA2}${mB}`), false);
// Positives Gegensignal: der Fix darf nicht dadurch „sauber" werden, dass er Text
// weglässt. Jeder Beitrag muss genau einmal dastehen.
pruef('mit Fix: jeder Beitrag überlebt genau einmal', [mA, mB, mA2, mOff].map((m) => zaehle(rNeu, m)), [1, 1, 1, 1]);
console.log(`  ohne Fix: ${JSON.stringify(rAlt.slice(BASE.length))}`);
console.log(`  mit  Fix: ${JSON.stringify(rNeu.slice(BASE.length))}`);

console.log('\n=== 3. Der Kandidat der Aktenlage: was unionMerge hier täte ===');
const uni = neu.unionMerge(doc, content);
pruef('unionMerge lässt mB einfach — auch schon vor dem Fix', zaehle(uni, mB), 1);
pruef('mit Fix trifft threeWayMerge dieselbe Länge wie unionMerge', rNeu.length, uni.length);
console.log(`  unionMerge: ${uni.length} Zeichen, threeWayMerge mit Fix: ${rNeu.length}`);
console.log('  Der Kandidat der Aktenlage wäre hier die Lösung gewesen, nicht die Ursache.');

console.log('\n=== 4. Der Schaden hängt NUR am Zeilenumbruch ===');
// Zeichengleiche Lage, nur mit Schluss-Umbruch auf allen drei Ständen. Schon die
// alte Fassung ist damit sauber — der Umbruch ist die einzige Variable.
const mitAlt = alt.threeWayMerge(aufbau + '\n', content + '\n', doc + '\n');
pruef('ohne Fix, aber MIT Schluss-Umbruch: bereits sauber', zaehle(mitAlt, mB), 1);
pruef('ohne Fix, aber MIT Schluss-Umbruch: keine Verschmelzung', mitAlt.includes(`${mA2}${mB}`), false);

console.log('\n=== 5. Der Fix erfindet und verschluckt keine Zeilenenden ===');
pruef('keine Seite hatte einen -> Ergebnis hat keinen', neu.threeWayMerge('a\nb', 'a\nb\nX', 'a\nb\nY').endsWith('\n'), false);
pruef('lokal hatte einen -> Ergebnis behält ihn', neu.threeWayMerge('a\nb', 'a\nb\nX\n', 'a\nb\nY').endsWith('\n'), true);
pruef('fremd hatte einen -> Ergebnis behält ihn', neu.threeWayMerge('a\nb', 'a\nb\nX', 'a\nb\nY\n').endsWith('\n'), true);
pruef('beide hatten einen -> Ergebnis behält ihn', neu.threeWayMerge('a\nb\n', 'a\nb\nX\n', 'a\nb\nY\n'), 'a\nb\nX\nY\n');
pruef('Leerstring bleibt Leerstring', neu.threeWayMerge('', '', ''), '');

console.log('\n=== 5b. Die Regression, die die adversariale Prüfung fand ===');
// Die ERSTE Fassung des Fixes entfernte das angehängte Zeilenende nur, wenn weder
// `local` noch `other` eines hatte — und las `other` damit als Beitrag, auch wenn
// `other === base`, die Gegenseite also gar nichts geändert hat. Damit brach die
// Identität, und der gewöhnliche lokale Edit am Dateiende bekam einen Umbruch
// angehängt, den niemand getippt hat. Die zweite Fassung merged das Umbruch-Bit
// selbst 3-Wege-artig. Beide Richtungen werden hier gehalten.
pruef('Gegenseite unverändert -> lokaler Stand byteweise (LF)', neu.threeWayMerge('a\nb\n', 'a\nb\nLokal', 'a\nb\n'), 'a\nb\nLokal');
pruef('Gegenseite unverändert -> lokaler Stand byteweise (CRLF)', neu.threeWayMerge('a\r\nb\r\n', 'a\r\nb\r\nLokal', 'a\r\nb\r\n'), 'a\r\nb\r\nLokal');
pruef('lokales Entfernen des Umbruchs wird übernommen', neu.threeWayMerge('a\nb\n', 'a\nb', 'a\nb\n'), 'a\nb');
pruef('fremdes Entfernen des Umbruchs wird übernommen', neu.threeWayMerge('a\nb\n', 'a\nb\n', 'a\nb'), 'a\nb');
// Die Identität selbst, über alle vier Zeilenende-Lagen.
for (const [b, l] of [['a\nb\n', 'a\nb\nX'], ['a\nb', 'a\nb\nX'], ['a\nb\n', 'a\nb\nX\n'], ['', 'a']]) {
  pruef(`Identität threeWayMerge(base, local, base) === local  base=${JSON.stringify(b)}`, neu.threeWayMerge(b, l, b), l);
}

console.log('\n=== 6. Gegenprobe: sieht die Prüfung überhaupt einen sauberen Fall? ===');
// Ohne diese Zeilen wäre „alles OK" nicht von „Instrument misst nichts" zu trennen.
pruef('unveränderter Stand bleibt unverändert', neu.threeWayMerge('a\nb', 'a\nb', 'a\nb'), 'a\nb');
pruef('reine lokale Ergänzung ohne Gegenseite', neu.threeWayMerge('a', 'a\nX', 'a'), 'a\nX');

console.log(`\n${'='.repeat(64)}`);
console.log(
  fehler === 0
    ? 'ALLE PRÜFUNGEN WIE ERWARTET — Schaden am alten Stand belegt, am neuen behoben.'
    : `${fehler} Prüfung(en) abweichend — der Nachweis trägt so NICHT.`
);
if (fehler) process.exitCode = 1;
