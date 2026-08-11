// sonde.mjs — WANN entsteht beim Inkarnationswechsel eine eigene Kopie des
// lokalen Beitrags, und wann haengt er an einem fremden Item?
//
// Vier Achsen, alle harness-frei gegen `unionMerge` (`src/text-merge.ts:362`)
// und den echten `CrdtManager.setContent` (`src/crdt-manager.ts:364`):
//   A  Position     — gemeinsame Zeile an gleicher vs. verschobener Stelle
//   B  Umgebung     — wieviel gemeinsamer Kontext drumherum steht
//   C  Notizformen  — Frontmatter, Ueberschrift, Liste, Leerzeilen, Codeblock
//   D  Alltagsfall  — zwei Menschen aendern je EINE andere Stelle
//
//   SPIKE_DET=42 node spike/aliasierung/sonde.mjs
import { fall, zeigeKurz, zeigeLang, DET } from './kern.mjs';

const NL = String.fromCharCode(10);
const t = (...zeilen) => zeilen.join(NL) + NL;
const g = (k) => Array.from({ length: k }, (_, i) => `g${i}`);

console.log(`===== ALIASIERUNGS-SONDE   SPIKE_DET=${DET}`);
console.log('E = der lokale Beitrag hat ein EIGENES Yjs-Item; a = er haengt am fremden.');
console.log('');

// ===========================================================================
// A — POSITION. Die gemeinsame Zeile M steht beim Gewinner VOR dem gemeinsamen
// Block, beim Verlierer d Zeilen weiter hinten. k = Zahl der gemeinsamen
// Zeilen, die dabei uebersprungen werden.
// ===========================================================================
function achseA(k, d) {
  const gem = g(k);
  const winner = t('# Titel', 'M', ...gem, 'nur-W');
  const local = t('# Titel', ...gem.slice(0, d), 'M', ...gem.slice(d), 'nur-L');
  return fall(`k=${k} d=${d}`, winner, local, 'M');
}

console.log('== A  Position: Verschiebung d gegen k gemeinsame Zeilen');
console.log('   (Zelle = eigene Kopie? E/a ; Klammer = Vorkommen von M im Ziel)');
console.log('        ' + Array.from({ length: 7 }, (_, d) => `d=${d}`.padStart(6)).join(''));
const aRoh = [];
for (let k = 0; k <= 6; k++) {
  let zeile = `   k=${k} `;
  for (let d = 0; d <= 6; d++) {
    if (d > k) {
      zeile += '     .';
      continue;
    }
    const r = achseA(k, d);
    aRoh.push({ k, d, r });
    zeile += `  ${r.eigeneKopie ? 'E' : 'a'}(${r.imZiel})`;
  }
  console.log(zeile);
}
console.log('');
console.log('   Loeschprobe (Gewinner loescht sein M) fuer k=6:');
for (const e of aRoh.filter((x) => x.k === 6)) {
  console.log(
    `     d=${e.d}  Ziel=${JSON.stringify(e.r.ziel)}`.padEnd(70) +
      ` -> ${e.r.ueberlebt ? 'ueberlebt' : 'TOT'}`
  );
}
console.log('');

// ===========================================================================
// B — UMGEBUNG. Gleiche Stelle, aber unterschiedlich viel gemeinsamer Kontext.
// Frage: Aendert die Umgebung etwas, wenn die REIHENFOLGE stimmt?
// ===========================================================================
console.log('== B  Umgebung bei UNVERSCHOBENER gemeinsamer Zeile');
const bFaelle = [
  [
    'M zwischen lauter Unterschieden',
    t('w0', 'w1', 'M', 'w2'),
    t('x0', 'x1', 'M', 'x2'),
  ],
  [
    'M in gemeinsamem Kontext (2 Zeilen)',
    t('c0', 'c1', 'M', 'w2'),
    t('c0', 'c1', 'M', 'x2'),
  ],
  [
    'M in gemeinsamem Kontext (6 Zeilen)',
    t(...g(3), 'M', ...g(3).map((s) => s + 'b'), 'w'),
    t(...g(3), 'M', ...g(3).map((s) => s + 'b'), 'x'),
  ],
  ['M als erste Zeile', t('M', 'w0', 'w1'), t('M', 'x0', 'x1')],
  ['M als letzte Zeile', t('w0', 'w1', 'M'), t('x0', 'x1', 'M')],
  [
    'M einzige Gemeinsamkeit, Rest komplett verschieden',
    t('w0', 'w1', 'w2', 'M', 'w3', 'w4'),
    t('x0', 'M', 'x1', 'x2', 'x3'),
  ],
  [
    'M beim Verlierer ZWEIMAL, beim Gewinner einmal',
    t('c0', 'M', 'c1'),
    t('c0', 'M', 'c1', 'M'),
  ],
  // KONTROLLE: absolute Zeilennummer verschoben, aber KEINE gemeinsame Zeile
  // ueberholt. Zeigt, dass „verschoben" die Reihenfolge gegen die uebrigen
  // gemeinsamen Zeilen meint, nicht die Zeilennummer.
  [
    'KONTROLLE: M um 3 Zeilennummern verschoben, 0 gemeinsame ueberholt',
    t('c0', 'M', 'c1'),
    t('c0', 'x1', 'x2', 'x3', 'M', 'c1'),
  ],
  [
    'KONTROLLE: M um 3 Zeilennummern verschoben, 1 gemeinsame ueberholt',
    t('c0', 'M', 'c1'),
    t('c0', 'x1', 'x2', 'c1', 'M'),
  ],
];
for (const [name, w, l] of bFaelle) zeigeKurz(fall(name, w, l, 'M'));
console.log('');

// ===========================================================================
// C — REALISTISCHE NOTIZFORMEN
// ===========================================================================
console.log('== C  Realistische Notizformen');

const NOTIZ = [
  '---',
  'tags: [projekt]',
  'status: offen',
  '---',
  '',
  '# Projekt Uferbau',
  '',
  '## Stand',
  '',
  'Der Bauantrag liegt beim Amt.',
  '',
  '## Aufgaben',
  '',
  '- [ ] Statik pruefen',
  '- [ ] Angebot einholen',
  '- [ ] Termin bestaetigen',
  '',
  '## Code',
  '',
  '```js',
  'const x = 1;',
  '```',
  '',
];

function ersetze(zeilen, idx, neu) {
  const k = zeilen.slice();
  k[idx] = neu;
  return k;
}
function einfuege(zeilen, idx, ...neu) {
  const k = zeilen.slice();
  k.splice(idx, 0, ...neu);
  return k;
}

const cFaelle = [
  [
    'je eine ANDERE Zeile geaendert (Zeile 9 / Zeile 15)',
    t(...ersetze(NOTIZ, 9, 'Der Bauantrag ist bewilligt.')),
    t(...ersetze(NOTIZ, 15, '- [x] Angebot einholen')),
    'Der Bauantrag ist bewilligt.',
  ],
  [
    'beide haengen einen Aufgabenpunkt an — VERSCHIEDENE',
    t(...einfuege(NOTIZ, 17, '- [ ] Kran bestellen')),
    t(...einfuege(NOTIZ, 17, '- [ ] Fenster messen')),
    '- [ ] Statik pruefen',
  ],
  [
    'beide haengen DENSELBEN Aufgabenpunkt an',
    t(...einfuege(NOTIZ, 17, '- [ ] Kran bestellen')),
    t(...einfuege(NOTIZ, 14, '- [ ] Kran bestellen')),
    '- [ ] Kran bestellen',
  ],
  [
    'Verlierer haengt einen neuen Abschnitt an (mit Leerzeilen)',
    t(...ersetze(NOTIZ, 2, 'status: laeuft')),
    t(...NOTIZ, '## Notizen', '', 'Nachtrag.', ''),
    '',
  ],
  [
    'beide setzen einen zweiten Codeblock',
    t(...einfuege(NOTIZ, 22, '```sh', 'ls -la', '```', '')),
    t(...einfuege(NOTIZ, 22, '```py', 'print(1)', '```', '')),
    '```',
  ],
];
for (const [name, w, l, marke] of cFaelle) {
  const r = fall(name, w, l, marke);
  const eigen = r.besitz.filter((z) => z.eigen).length;
  console.log(
    `  ${name.padEnd(58)} | Zeilen ${String(r.besitz.length).padStart(3)}` +
      ` | eigene Items ${String(eigen).padStart(3)}` +
      ` | Marke ${JSON.stringify(marke).padEnd(28)} Ziel ${r.imZiel}x ${r.eigeneKopie ? 'EIGEN' : 'ALIAS'} -> ${r.ueberlebt ? 'ueberlebt' : 'TOT'}`
  );
}
console.log('');

// ===========================================================================
// D — DER ALLTAGSFALL, ausfuehrlich
// ===========================================================================
console.log('== D  Alltagsfall: zwei Menschen, je eine andere Zeile');
zeigeLang(
  fall(
    'Alltagsfall (Gewinner Zeile 9, Verlierer Zeile 15)',
    t(...ersetze(NOTIZ, 9, 'Der Bauantrag ist bewilligt.')),
    t(...ersetze(NOTIZ, 15, '- [x] Angebot einholen')),
    '- [x] Angebot einholen'
  )
);

// Und die Gegenfrage: was passiert mit dem GRUNDTEXT im selben Lauf?
const dR = fall(
  'Alltagsfall, Blick auf den Grundtext',
  t(...ersetze(NOTIZ, 9, 'Der Bauantrag ist bewilligt.')),
  t(...ersetze(NOTIZ, 15, '- [x] Angebot einholen')),
  '- [ ] Statik pruefen'
);
console.log('   Grundtextzeile "- [ ] Statik pruefen" im selben Lauf:');
console.log(`     Ziel ${dR.imZiel}x, ${dR.eigeneKopie ? 'EIGENE KOPIE' : 'ALIAS'}, nach Loeschung durch den Gewinner: ${dR.ueberlebt ? 'ueberlebt' : 'TOT'}`);
console.log('');

// ===========================================================================
// F — DIE SCHADENSFORMEN, woertlich. Faelle, in denen eine Zeile, die der
// VERLIERER an dieser Stelle beigetragen hat, kein eigenes Item bekommt.
// ===========================================================================
console.log('== F  Schadensformen woertlich');

// F1: Der Verlierer setzt einen zweiten Codeblock, der Gewinner auch. Die
// SCHLUSSZEILE ``` ist zeichengleich — sie aliasiert.
zeigeLang(
  fall(
    'F1  zweiter Codeblock auf beiden Seiten (Schlusszaun ```)',
    t(...einfuege(NOTIZ, 22, '```sh', 'ls -la', '```', '')),
    t(...einfuege(NOTIZ, 22, '```py', 'print(1)', '```', '')),
    '```'
  )
);

// F2: Der Verlierer schiebt einen neuen Absatz MITTEN in die Notiz. Die dafuer
// getippte Leerzeile trifft auf die Leerzeilen des Gewinners.
zeigeLang(
  fall(
    'F2  neuer Absatz in der Mitte, mit eigener Leerzeile',
    t(...ersetze(NOTIZ, 2, 'status: laeuft')),
    t(...einfuege(NOTIZ, 10, '', 'Rueckfrage an das Amt.')),
    ''
  )
);

// F3: Beide Seiten tippen dieselbe Zeile an DERSELBEN Stelle — und aendern
// nebenbei je eine andere Stelle, damit die Texte ueberhaupt verschieden sind
// (sonst greift schon der Kurzschluss `winnerText === localText` an :1444).
zeigeLang(
  fall(
    'F3  beide tippen dieselbe Zeile an derselben Stelle',
    t(...ersetze(einfuege(NOTIZ, 16, '- [ ] Kran bestellen'), 2, 'status: laeuft')),
    t(...ersetze(einfuege(NOTIZ, 16, '- [ ] Kran bestellen'), 9, 'Der Bauantrag ist bewilligt.')),
    '- [ ] Kran bestellen'
  )
);

// F4: Nur der Verlierer tippt sie — der Gewinner hat sie aber woanders schon.
zeigeLang(
  fall(
    'F4  nur der Verlierer tippt sie, Gewinner hat sie schon woanders',
    t('# Liste', '- Milch', '- Brot', 'nur-W'),
    t('# Liste', '- Brot', '- Milch', 'nur-L'),
    '- Milch'
  )
);

// ===========================================================================
// G — Die beiden uebrigen Stellschrauben: VIELFACHHEIT und verschobener BLOCK,
// dazu die Gegenprobe auf einer grossen Notiz.
// ===========================================================================
console.log('== G1  Vielfachheit: wie oft steht die Zeile auf jeder Seite?');
for (const nw of [1, 2, 3]) {
  for (const nl of [1, 2, 3]) {
    const w = t('# Kopf', ...Array(nw).fill('L'), 'mitte', 'nur-W');
    const l = t('# Kopf', ...Array(nl).fill('L'), 'mitte', 'nur-L');
    const r = fall(`nw=${nw} nl=${nl}`, w, l, 'L');
    const eigen = r.vorkommen.filter((v) => v.eigen).length;
    console.log(
      `  Gewinner ${nw}x, lokal ${nl}x  ->  Ziel ${r.imZiel}x, davon eigene Items ${eigen}` +
        `   ${r.eigeneKopie ? 'EIGENE KOPIE' : 'ALIAS'}`
    );
  }
}
console.log('');

console.log('== G2  verschobener BLOCK (Liste umsortiert)');
zeigeLang(
  fall(
    'G2  Verlierer sortiert die Aufgabenliste um',
    t(...ersetze(NOTIZ, 2, 'status: laeuft')),
    t(
      ...NOTIZ.slice(0, 14),
      '- [ ] Termin bestaetigen',
      '- [ ] Statik pruefen',
      '- [ ] Angebot einholen',
      ...NOTIZ.slice(17)
    ),
    '- [ ] Termin bestaetigen'
  )
);

console.log('== G3  grosse Notiz (1.000 Zeilen), beide aendern je EINE Zeile');
{
  const gross = Array.from({ length: 1000 }, (_, i) => `zeile ${i}`);
  const r = fall(
    'G3',
    t(...ersetze(gross, 100, 'zeile 100 — vom Gewinner geaendert')),
    t(...ersetze(gross, 700, 'zeile 700 — vom Verlierer geaendert')),
    'zeile 500'
  );
  const eigen = r.besitz.filter((z) => z.eigen).length;
  console.log(`  Zeilen im Verlierer-Doc: ${r.besitz.length}, davon eigene Items: ${eigen}`);
  console.log(`  eigene Zeilen woertlich: ${JSON.stringify(r.besitz.filter((z) => z.eigen).map((z) => z.text))}`);
  console.log(`  Grundtextzeile "zeile 500": Ziel ${r.imZiel}x, ${r.eigeneKopie ? 'EIGEN' : 'ALIAS'}, nach Loeschung ${r.ueberlebt ? 'ueberlebt' : 'TOT'}`);
}
console.log('');

// ===========================================================================
// E — Anteil aliasierter Zeilen ueber die Notizformen
// ===========================================================================
console.log('== E  Wieviel des Verlierer-Docs traegt ueberhaupt eigene Items?');
for (const [name, w, l, marke] of cFaelle) {
  const r = fall(name, w, l, marke);
  const eigen = r.besitz.filter((z) => z.eigen).length;
  const anteil = ((100 * eigen) / r.besitz.length).toFixed(1);
  console.log(`  ${name.padEnd(58)} eigen ${String(eigen).padStart(3)}/${String(r.besitz.length).padStart(3)} = ${anteil.padStart(5)} %`);
}
