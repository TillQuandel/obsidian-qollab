// r14-ursache.mjs — Warum steht `BBB` in r14 zweimal im CRDT?
//
// BEFUNDLAGE (X-08). Der Realtest r14-cdp ist nach dem Zeilenende-Fix T-08
// unveraendert rot. Die Itemkette von vault-b (r14-items.mjs) zeigt:
//
//   #4  client 2170101464  clock  53   "BBB-<RunId>\nB2-<RunId>"   <- endet OHNE \n
//   #5  client 4220309557  clock 105   "BBB-<RunId>\nA2-<RunId>"
//
// BEIDE Geraete haben `BBB` in ihre EIGENE Insert-Op aufgenommen, und in beiden
// Vaults ist das urspruengliche `BBB`-Item geloescht (Tombstones bei clock 27
// und 79). Der sichtbare Schaden — `B2-...BBB-...` in einer Zeile — ist nur die
// Folge davon, dass Item #4 nicht auf `\n` endet und #5 direkt anschliesst.
//
// DIE HYPOTHESE, die hier gemessen wird: Endet der Text NICHT auf einem
// Zeilenumbruch, ist seine letzte Zeile beim naechsten `setContent` keine
// unberuehrte Zeile mehr, sondern eine GEAENDERTE — aus `BBB` wird `BBB\nA2`.
// `diffOps` loest das als DELETE der alten Zeile plus INSERT der neuen. Tun das
// zwei Geraete unabhaengig, verschmelzen die DELETE-Haelften und die
// INSERT-Haelften stapeln sich: `BBB` steht danach zweimal.
//
// Das ist dieselbe Mechanik wie die dritte Untervariante in produktziel.md
// ("Was ab vier Geraeten uebrig bleibt"), aber an einer Bedingung, die dort
// nicht steht: NICHT die Gerätezahl, sondern der fehlende Schluss-Umbruch.
// probe-idempotenz.mjs kann sie strukturell nicht sehen — seine Texte enden
// ausnahmslos auf `\n` (`.join(NL) + NL`).
//
// KEIN Harness, kein Transport, kein Herkunftstor. Nur die Umrechnung
// Text -> Ops und das Zusammenfuehren zweier Staende.
//
// Aufruf (aus obsidian-crdt-sync/):
//   node spike/schnitt/build-neu.mjs
//   node spike/duplikat-mb/r14-ursache.mjs

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hier = path.dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(import.meta.url);

// BEIDE Fassungen, aus `bauen-crdt.mjs`. Ohne die kaputte daneben waere ein
// sauberes Ergebnis nicht von „der Fall trat gar nicht ein" zu unterscheiden —
// und genau so las sich dieses Instrument nach dem Einbau des Fixes einmal:
// „Hypothese traegt nicht", obwohl sie trug und der Fix nur schon wirkte.
const R = require_(path.join(hier, 'crdt.cjs'));
const R_ALT = require_(path.join(hier, 'crdt-vor-fix.cjs'));

const NL = String.fromCharCode(10);
const ID = 'r14cdp-20260813-213723';

// Der konvergierte Ausgangsstand, wie ihn H-SETUP-SHARED-CDP hinterlaesst.
const RUMPF = [
  '# Meetingprotokoll',
  '',
  'Punkt 1: Ausgangslage',
  'Punkt 2: Beschluss',
  '',
  'Ende der Vorlage',
  `AAA-${ID}`,
  `BBB-${ID}`,
].join(NL);

const zaehle = (text, marker) => text.split(marker).length - 1;

/**
 * Fuehrt die Lage von r14 nach: gemeinsamer Ausgangsstand, dann haengt jede
 * Seite unabhaengig EINE eigene Zeile an. Danach werden die Staende vereinigt.
 *
 * @param mitSchlussUmbruch endet der Ausgangsstand auf `\n`?
 */
function lauf(mitSchlussUmbruch, Fassung = R) {
  const basis = mitSchlussUmbruch ? RUMPF + NL : RUMPF;
  const anhang = (m) => (mitSchlussUmbruch ? basis + m + NL : basis + NL + m);

  // Gemeinsamer Ausgangsstand mit IDENTISCHEN Item-IDs auf beiden Seiten —
  // eine geteilte Inkarnation, genau wie in r14 (beide GUIDs 9400f357...).
  const quelle = new Fassung.CrdtManager();
  quelle.setContent('n.md', basis);
  const saat = quelle.encodeState('n.md');

  const a = new Fassung.CrdtManager();
  const b = new Fassung.CrdtManager();
  a.applyUpdate('n.md', saat);
  b.applyUpdate('n.md', saat);

  // Jede Seite haengt ihre eigene Zeile an — unabhaengig, ohne die andere zu kennen.
  a.setContent('n.md', anhang(`A2-${ID}`));
  b.setContent('n.md', anhang(`B2-${ID}`));

  // Zustellung: B bekommt As Stand (im Runner der Schritt H-SYNC-ONE a->b).
  b.applyUpdate('n.md', a.encodeState('n.md'));

  const text = b.getContent ? b.getContent('n.md') : b.getText('n.md');
  return {
    text,
    laenge: text.length,
    bbb: zaehle(text, `BBB-${ID}`),
    a2: zaehle(text, `A2-${ID}`),
    b2: zaehle(text, `B2-${ID}`),
    verklebt: /-\d{6}[A-Z]/.test(text),
  };
}

console.log('--- Die Frage: verdoppelt sich die letzte Zeile? ----------------');
console.log('  Zwei Geraete haengen unabhaengig je eine Zeile an denselben Stand.');
console.log(`  Letzte Zeile des Ausgangsstands: "BBB-${ID}"\n`);

const ohneAlt = lauf(false, R_ALT);
const mitAlt = lauf(true, R_ALT);
const ohne = lauf(false);
const mit = lauf(true);

const zeig = (name, r, sollBbb) => {
  console.log(`  ${name}`);
  console.log(`    Laenge      ${r.laenge}`);
  console.log(`    BBB steht   ${r.bbb}x   (soll 1)  ${r.bbb === sollBbb ? '' : ''}`);
  console.log(`    A2 / B2     ${r.a2}x / ${r.b2}x`);
  console.log(`    verklebt    ${r.verklebt ? 'JA' : 'nein'}`);
  console.log(`    Text        ${JSON.stringify(r.text.split(NL).slice(6).join('|'))}`);
};

console.log('  ===== OHNE den Fix (Stand vor dem Einbau) =====');
zeig('OHNE Schluss-Umbruch (der Fall aus r14):', ohneAlt, 1);
console.log('');
zeig('MIT Schluss-Umbruch (die Gegenprobe):', mitAlt, 1);
console.log('\n  ===== MIT dem Fix (Arbeitsbaum) =====');
zeig('OHNE Schluss-Umbruch (der Fall aus r14):', ohne, 1);
console.log('');
zeig('MIT Schluss-Umbruch (die Gegenprobe):', mit, 1);

// --- Abgleich gegen den echten Lauf ---------------------------------------
// Der Endtext, den r14cdp-20260813-213723 in vault-b hinterlassen hat (aus der
// Evidenz-Zip des Laufs, byte-genau uebernommen). Stimmt er ueberein, ist der
// Schaden nicht nur aehnlich nachgebaut, sondern REPRODUZIERT.
const GEMESSEN = [
  ...RUMPF.split(NL),
  `B2-${ID}BBB-${ID}`,
  `A2-${ID}`,
].join(NL);
console.log('\n--- Abgleich mit dem Realtest ----------------------------------');
console.log(`  gemessen im Lauf      : ${GEMESSEN.length} Zeichen`);
console.log(`  ohne Fix gerechnet    : ${ohneAlt.laenge} Zeichen`);
console.log(
  `  byte-gleich           : ${ohneAlt.text === GEMESSEN ? 'JA — der Schaden ist reproduziert' : 'nein'}`
);
console.log(`  mit Fix gerechnet     : ${ohne.laenge} Zeichen`);
console.log(`  Wirkung               : ${ohneAlt.laenge} -> ${ohne.laenge} Zeichen, BBB ${ohneAlt.bbb}x -> ${ohne.bbb}x`);

console.log('\n--- Befund -----------------------------------------------------');
if (ohneAlt.text === GEMESSEN && ohne.bbb === 1 && !ohne.verklebt) {
  console.log('  GEKLAERT UND BEHOBEN. Die Fassung ohne Fix trifft den Endtext des');
  console.log('  Realtests byte-genau; mit Fix ist er sauber. Die Bedingung ist der');
  console.log('  fehlende Schluss-Umbruch: `diffOps` behandelt die letzte Zeile ohne');
  console.log('  `\\n` als GEAENDERT statt als unberuehrt und loest sie als');
  console.log('  DELETE + INSERT auf. Rechnen zwei Geraete das unabhaengig,');
  console.log('  verschmelzen die DELETE-Haelften und die INSERT-Haelften stapeln sich.');
  console.log('  Die Verklebung ist die FOLGE, nicht die Ursache: das erste Item endet');
  console.log('  ohne `\\n`, das zweite schliesst direkt an.');
} else if (ohneAlt.bbb > 1 && mitAlt.bbb === 1) {
  console.log('  BESTAETIGT. Ohne Schluss-Umbruch wird die letzte Zeile verdoppelt,');
  console.log('  mit Schluss-Umbruch nicht. Die Bedingung ist der fehlende `\\n` am');
  console.log('  Ende — nicht die Geraetezahl.');
  console.log(`  Der Schaden ist damit ohne Harness reproduzierbar: ${ohne.bbb}x statt 1x.`);
} else if (ohne.bbb === 1 && mit.bbb === 1) {
  console.log('  NICHT bestaetigt. Beide Faelle sind sauber — die Hypothese traegt');
  console.log('  nicht, der Schaden entsteht woanders (Transport, Tor, Sweep).');
} else {
  console.log(`  Unerwartet: ohne=${ohne.bbb}x, mit=${mit.bbb}x. Beide Faelle ansehen.`);
}

// --- Gegenprobe auf Blindheit ---------------------------------------------
// Ein Instrument, das den Schaden gar nicht erzeugen KANN, meldet "sauber" und
// entlastet damit faelschlich. Neun Instrumente dieses Projekts waren
// nachweislich blind. Deshalb hier eine Lage, in der die Verdopplung mit
// Sicherheit auftreten MUSS: beide Seiten schreiben denselben neuen Text.
const blind = (() => {
  const quelle = new R.CrdtManager();
  quelle.setContent('p.md', 'x' + NL);
  const saat = quelle.encodeState('p.md');
  const a = new R.CrdtManager();
  const b = new R.CrdtManager();
  a.applyUpdate('p.md', saat);
  b.applyUpdate('p.md', saat);
  a.setContent('p.md', 'x' + NL + 'GLEICH' + NL);
  b.setContent('p.md', 'x' + NL + 'GLEICH' + NL);
  b.applyUpdate('p.md', a.encodeState('p.md'));
  const t = b.getContent ? b.getContent('p.md') : b.getText('p.md');
  return t.split('GLEICH').length - 1;
})();
console.log('\n--- Gegenprobe -------------------------------------------------');
console.log(`  Beide Seiten fuegen dieselbe neue Zeile ein: "GLEICH" steht ${blind}x`);
console.log(
  `  ${blind > 1 ? '-> Das Instrument kann Verdopplung sehen.' : '-> BLIND: es sieht keine Verdopplung, jeder Nullbefund oben ist wertlos.'}`
);
