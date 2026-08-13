// signatur.mjs — Welche Eingaben koennen die in `r13`/`r14` beobachtete
// Duplikat-Signatur ueberhaupt erzeugen?
//
// AUSGANGSLAGE (gemessen, nicht vermutet):
//   `r13-cdp` meldet `alt-B-1x` = 2 (soll 1).
//   `r14-cdp` meldet `kontrolle2-keine-duplikate` = 1/2/1 (soll 1/1/1).
//   In beiden Faellen ist der verdoppelte Marker `mB` — der, den B im
//   gemeinsamen Aufbau setzt. Alle uebrigen Marker stehen genau einmal.
//   Logs: C:\tmp\qollab-test\runs\r13-cdp-lauf.log, r14-cdp-lauf2.log.
//   `H-COUNT` zaehlt Regex-Treffer im `.md`-Text (harness-ext.ps1:469-478),
//   nicht CRDT-Items — die Signatur ist also eine Aussage ueber den Dateitext.
//
// DIE FRAGE, DIE DIESE PROBE BEANTWORTET:
//   Statt zu raten, welcher Codepfad laeuft, wird der Suchraum umgedreht:
//   Welche Eingabepaare (other, local) liefern in den ECHTEN Merge-Funktionen
//   genau diese Signatur — und welche nicht? Was allen Treffern gemeinsam ist,
//   ist die Bedingung, nach der im Produkt zu suchen ist.
//
// WARUM ERSCHOEPFEND STATT AN BEISPIELEN:
//   Eine Probe an selbst ausgedachten Faellen misst die eigene Phantasie. Hier
//   werden ALLE geordneten Teilmengen der vier Marker gegen ALLE geordneten
//   Teilmengen gefahren (65 x 65 = 4225 Paare je Funktion). Damit ist die
//   Aussage "nur diese Konstellationen erzeugen die Signatur" vollstaendig
//   statt exemplarisch.
//
// GEGENPROBE (Pflicht, damit "kein Treffer" nicht "nichts gemessen" heisst):
//   Der Lauf prueft am Ende, dass die Zaehlung ueberhaupt Duplikate SEHEN kann —
//   ein bekannt duplizierender Fall aus `tests/erstkontakt-duplikat.test.ts:137`
//   muss als Treffer erscheinen.
//
// REICHWEITE — was dieser Lauf NICHT sagt (nachgemessen, nicht abgeleitet):
//   Der Suchraum besteht aus geordneten Teilmengen, jede Zeile also HOECHSTENS
//   EINMAL je Fassung. Ein Ergebnis wie "alle Treffer sind umsortiert" gilt
//   damit nur unter der Bedingung, dass BEIDE Eingaben duplikatfrei sind.
//   Traegt eine Eingabe das Duplikat bereits, reicht `unionMerge` es unveraendert
//   durch — ohne jede Umsortierung. Gemessen:
//       unionMerge('kopf\nX\n', 'kopf\nX\nY\nX\n')  ->  'kopf\nX\nY\nX\n', X zweimal
//   Die richtige Lesart ist deshalb: Umsortierung ist notwendig, damit
//   `unionMerge` ein Duplikat ERZEUGT — nicht, damit eines im Ergebnis steht.
//   Ein weiter vorne entstandenes Duplikat laeuft unbemerkt durch diese Stelle.
//
// Aufruf (aus obsidian-crdt-sync/):
//   node -e "require('esbuild').buildSync({bundle:true,platform:'node',format:'cjs',external:['diff-match-patch'],entryPoints:['src/text-merge.ts'],outfile:'spike/duplikat-mb/merge.cjs'})"
//   node spike/duplikat-mb/signatur.mjs

import { createRequire } from 'node:module';
const require_ = createRequire(import.meta.url);
const { unionMerge, threeWayMerge } = require_('./merge.cjs');

// Der echte BASE-Text des Harness (harness.ps1:84-91), LF, mit Schlusszeilenumbruch.
const BASE = [
  '# Meetingprotokoll',
  '',
  'Punkt 1: Ausgangslage',
  'Punkt 2: Beschluss',
  '',
  'Ende der Vorlage',
].join('\n') + '\n';

// Die vier Marker aus r14-cdp.ps1:43-46, mit einer RunId derselben Bauart.
const RUN = 'r14cdp-20260812-210047';
const mA = `AAA-${RUN}`;
const mB = `BBB-${RUN}`;
const mB2 = `B2-${RUN}`;
const mA2 = `A2-${RUN}`;
const MARKER = { mA, mB, mB2, mA2 };
const NAMEN = Object.keys(MARKER);

// Kein Marker darf Teilstring eines anderen sein — sonst zaehlt H-COUNT falsch
// und die ganze Signatur waere ein Artefakt der Zaehlweise.
for (const a of NAMEN) {
  for (const b of NAMEN) {
    if (a !== b && MARKER[b].includes(MARKER[a])) {
      throw new Error(`Marker ${a} ist Teilstring von ${b} — Zaehlung waere mehrdeutig.`);
    }
  }
}

// H-COUNT nachgebaut: Regex-Treffer im Volltext (harness-ext.ps1:477).
function zaehle(text, marker) {
  let n = 0;
  let i = text.indexOf(marker);
  while (i !== -1) {
    n++;
    i = text.indexOf(marker, i + marker.length);
  }
  return n;
}

// Alle geordneten Teilmengen von NAMEN (inkl. der leeren): 1+4+12+24+24 = 65.
function geordneteTeilmengen(namen) {
  const raus = [[]];
  const rek = (praefix, rest) => {
    for (let i = 0; i < rest.length; i++) {
      const naechster = [...praefix, rest[i]];
      raus.push(naechster);
      rek(naechster, [...rest.slice(0, i), ...rest.slice(i + 1)]);
    }
  };
  rek([], namen);
  return raus;
}

function fassung(folge) {
  return BASE + folge.map((n) => MARKER[n]).join('\n') + (folge.length ? '\n' : '');
}

const FOLGEN = geordneteTeilmengen(NAMEN);

// Die gesuchte Signatur: mB genau zweimal, jeder andere Marker genau einmal.
function istSignatur(text) {
  return (
    zaehle(text, mB) === 2 &&
    zaehle(text, mA) === 1 &&
    zaehle(text, mA2) === 1 &&
    zaehle(text, mB2) === 1
  );
}

// Fuer einen Treffer: steht mB in `other` und `local` relativ zu den gemeinsamen
// Markern in derselben Ordnung? Das ist die Bedingung, die die Vermutung
// "Umsortierung" praezise macht — und die der Lauf bestaetigen oder widerlegen soll.
function istUmsortiert(a, b) {
  const gemeinsam = a.filter((n) => b.includes(n));
  const inA = gemeinsam.filter((n) => a.includes(n));
  const inB = b.filter((n) => gemeinsam.includes(n));
  return inA.join(',') !== inB.join(',');
}

const funktionen = {
  unionMerge: (other, local) => unionMerge(other, local),
  // threeWayMerge mit der plausibelsten Basis: dem gemeinsamen Aufbau-Stand.
  // Er ist der einzige Punkt, an dem beide Seiten nachweislich denselben Text
  // trugen (Assert `setup-geteilte-guid`, byte-gleich laut X-06).
  threeWayMergeAufBasisAufbau: (other, local) =>
    threeWayMerge(fassung(['mA', 'mB']), local, other),
};

const bericht = [];

for (const [fname, fn] of Object.entries(funktionen)) {
  const treffer = [];
  let gefahren = 0;
  let fehler = 0;

  for (const fo of FOLGEN) {
    for (const fl of FOLGEN) {
      const other = fassung(fo);
      const local = fassung(fl);
      let erg;
      try {
        erg = fn(other, local);
      } catch {
        fehler++;
        continue;
      }
      gefahren++;
      if (istSignatur(erg)) {
        treffer.push({ other: fo, local: fl, umsortiert: istUmsortiert(fo, fl), erg });
      }
    }
  }

  const mitUmsort = treffer.filter((t) => t.umsortiert).length;
  bericht.push({ fname, gefahren, fehler, treffer: treffer.length, mitUmsort, liste: treffer });

  console.log(`\n=== ${fname} ===`);
  console.log(`  gefahren: ${gefahren} Paare, Ausnahmen: ${fehler}`);
  console.log(`  Treffer auf die Signatur (mB=2, Rest=1): ${treffer.length}`);
  console.log(`  davon mit umsortierten gemeinsamen Markern: ${mitUmsort}`);
  console.log(`  davon OHNE Umsortierung: ${treffer.length - mitUmsort}`);

  if (treffer.length) {
    console.log('\n  Alle Treffer (other-Reihenfolge -> local-Reihenfolge):');
    for (const t of treffer) {
      console.log(
        `    [${t.other.join(' ') || '-'}] x [${t.local.join(' ') || '-'}]` +
          `  umsortiert=${t.umsortiert}`
      );
    }
    console.log('\n  Ein Treffer im Volltext (nur der Marker-Teil):');
    const t0 = treffer[0];
    console.log(
      '    ' + t0.erg.slice(BASE.length).split('\n').filter(Boolean).join('\n    ')
    );
  }
}

// --- Gegenprobe: kann die Zaehlung ueberhaupt ein Duplikat sehen? ------------
// Der bekannte duplizierende Fall aus tests/erstkontakt-duplikat.test.ts:137 —
// dieselbe Zeile in beiden Fassungen, umsortiert. Faellt diese Probe, misst der
// ganze Lauf nichts und jedes "0 Treffer" oben waere bedeutungslos.
const gA = fassung(['mA', 'mB']);
const gB = fassung(['mB', 'mA']);
const gErg = unionMerge(gA, gB);
const gSieht = zaehle(gErg, mB) === 2 || zaehle(gErg, mA) === 2;
console.log('\n=== Gegenprobe: sieht die Zaehlung ein bekanntes Duplikat? ===');
console.log(`  unionMerge([mA mB], [mB mA]) -> mA=${zaehle(gErg, mA)}, mB=${zaehle(gErg, mB)}`);
console.log(`  ${gSieht ? 'JA — das Instrument ist nicht blind.' : 'NEIN — INSTRUMENT BLIND, Lauf ungueltig.'}`);
if (!gSieht) process.exitCode = 1;

// --- Zweite Gegenprobe: der Normalfall darf NICHT duplizieren ---------------
// Gleiche Reihenfolge auf beiden Seiten, eine Seite nur laenger. Wenn das schon
// dupliziert, ist nicht die Umsortierung die Bedingung, sondern irgendetwas
// anderes — und die ganze Auswertung oben stuende auf Sand.
const nErg = unionMerge(fassung(['mA', 'mB', 'mA2']), fassung(['mA', 'mB', 'mB2']));
const nOk = zaehle(nErg, mA) === 1 && zaehle(nErg, mB) === 1;
console.log('\n=== Gegenprobe: dupliziert der geordnete Normalfall? ===');
console.log(`  unionMerge([mA mB mA2], [mA mB mB2]) -> mA=${zaehle(nErg, mA)}, mB=${zaehle(nErg, mB)}`);
console.log(`  ${nOk ? 'NEIN — wie erwartet.' : 'DOCH — die Umsortierungs-Erklaerung traegt nicht.'}`);

console.log('\n=== Bilanz ===');
for (const b of bericht) {
  console.log(
    `  ${b.fname}: ${b.treffer}/${b.gefahren} Paare erzeugen die Signatur` +
      (b.treffer ? ` — ${b.mitUmsort} davon umsortiert, ${b.treffer - b.mitUmsort} nicht` : '')
  );
}
