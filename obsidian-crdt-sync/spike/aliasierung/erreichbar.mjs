// ERREICHBARKEIT DES SCHADENS — misst die zweite Haelfte der Kette.
//
// Die Aliasierung selbst ist gemessen (fremdes Item statt eigener Kopie). Hier
// geht es um die Frage danach: WAS toetet die aliasierte Zeile, und HEILT sie
// zwischendurch?
//
// Ausgefuehrt wird der echte Produktivcode: `CrdtManager.setContent`
// (src/crdt-manager.ts:364, Standardmodus 'zeile') und `unionMerge`
// (src/text-merge.ts:362). Nachgebaut ist nur der Schluss von `switchToGuid`
// (src/sync-handler.ts:1443-1454) und die Zustellung zwischen zwei Docs.
//
// Aufruf (aus obsidian-crdt-sync/):
//   node spike/aliasierung/bauen-erreichbar.mjs
//   SPIKE_DET=42 node spike/aliasierung/erreichbar.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
// BEWUSST ueber `require`: der Bundle laedt yjs ebenfalls als CJS. Ein
// zusaetzliches ESM-`import` waere eine ZWEITE Yjs-Instanz (Warnung „Yjs was
// already imported") und damit ein anderer Doc-Typ als der, den der
// Produktivcode benutzt.
const Y = require('yjs');
const { CrdtManager, unionMerge } = require('./real-erreichbar.cjs');

const DET = Number(process.env.SPIKE_DET ?? 42);
const P = 'n.md';

// --- Werkzeug -------------------------------------------------------------

// Ein Geraet: echter CrdtManager, feste clientID (damit Besitz ablesbar ist).
function geraet(clientID) {
  const cm = new CrdtManager();
  cm.applyUpdate(P, Y.encodeStateAsUpdate(new Y.Doc())); // legt den Doc an
  cm.docs.get(P).clientID = clientID;
  return {
    cm,
    doc: cm.docs.get(P),
    text: () => cm.getContent(P),
    setzen: (t) => cm.setContent(P, t), // DER Produktivpfad fuer jede Op
    stand: () => Y.encodeStateAsUpdate(cm.docs.get(P)),
    holen: (u) => cm.applyUpdate(P, u),
  };
}

// Besitzkarte: je LEBENDE Zeile die Menge der clientIDs, denen ihre Zeichen
// gehoeren. Gelesen an der Y.Text-Itemliste, nicht ueber eine Zeilenzaehlung.
function besitz(g) {
  const y = g.doc.getText('content');
  const zeichen = [];
  for (let item = y._start; item !== null; item = item.right) {
    if (item.deleted) continue;
    const inhalt = item.content.getContent();
    for (const c of inhalt) zeichen.push([c, item.id.client]);
  }
  const zeilen = [];
  let text = '';
  let clients = new Set();
  for (const [c, cl] of zeichen) {
    if (c === '\n') {
      zeilen.push({ zeile: text, clients });
      text = '';
      clients = new Set();
      continue;
    }
    text += c;
    clients.add(cl);
  }
  if (text.length > 0) zeilen.push({ zeile: text, clients });
  return zeilen;
}

function besitzerVon(g, zeile) {
  const t = besitz(g).filter((z) => z.zeile === zeile);
  if (t.length === 0) return null;
  return t.map((z) => [...z.clients].join('+')).join(' | ');
}

// Zahl der Items des Gewinners, die nach dem Wechsel GELOESCHT sind.
function geloeschteFremdItems(g, fremdClient) {
  const y = g.doc.getText('content');
  let n = 0;
  for (let item = y._start; item !== null; item = item.right) {
    if (item.deleted && item.id.client === fremdClient) n += item.length;
  }
  return n;
}

// Der Schluss von switchToGuid: Verlierer verwirft, uebernimmt den Gewinner-Doc
// und materialisiert die Vereinigung (sync-handler.ts:1443-1454).
function wechsel(winnerText, localText, wClient = 101, vClient = 202) {
  const w = geraet(wClient);
  w.setzen(winnerText);
  const v = geraet(vClient);
  v.holen(w.stand());
  const ziel = unionMerge(winnerText, localText); // = `unite` an :1454
  const vorher = v.text();
  if (ziel !== vorher) v.setzen(ziel); // :1444-Kurzschluss nachgebildet
  return { w, v, ziel, wClient, vClient };
}

// Zustellung in beide Richtungen bis Ruhe.
function abgleich(a, b) {
  a.holen(b.stand());
  b.holen(a.stand());
}

const zaehle = (t, z) => t.split('\n').filter((x) => x === z).length;

// --- Fixture: eine gewoehnliche Markdown-Notiz ---------------------------

const grund = [
  '---',
  'tags: [projekt]',
  'status: offen',
  '---',
  '',
  '# Projekt Uferbau',
  '',
  '## Stand',
  'Der Bauantrag liegt beim Amt.',
  '',
  '## Aufgaben',
  '- [ ] Statik pruefen',
  '- [ ] Angebot einholen',
  '- [ ] Termin bestaetigen',
  '',
];
const grundText = grund.join('\n');
const ersetze = (arr, alt, neu) => arr.map((z) => (z === alt ? neu : z));
const ohne = (arr, w) => arr.filter((z) => z !== w);

console.log(`# ERREICHBARKEIT — SPIKE_DET=${DET}, diffModus=${new CrdtManager().diffModus}`);
console.log('');

// =========================================================================
// PROBE 1 — Kann die Materialisierung an :1454 SELBST ein Gewinner-Item toeten?
// =========================================================================
console.log('## PROBE 1 — erzeugt setContent an :1454 Delete-Ops auf Gewinner-Items?');
{
  // Deterministischer Zufall wie spike/verdopplung/aufrufstelle.mjs:246
  let s = (DET ^ 0x9e3779b1) >>> 0;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const alphabet = ['a', 'b', 'c', 'd'];
  const folge = () => {
    const n = 1 + Math.floor(rnd() * 6);
    const z = [];
    for (let i = 0; i < n; i++) z.push(alphabet[Math.floor(rnd() * alphabet.length)]);
    return z.join('\n') + '\n';
  };
  let faelle = 0;
  let mitLoeschung = 0;
  let beispiel = null;
  for (let i = 0; i < 4000; i++) {
    const wt = folge();
    const lt = folge();
    if (wt === lt) continue;
    faelle++;
    const { v, wClient } = wechsel(wt, lt);
    const tot = geloeschteFremdItems(v, wClient);
    if (tot > 0) {
      mitLoeschung++;
      if (!beispiel) beispiel = [wt, lt, unionMerge(wt, lt), tot];
    }
  }
  console.log(`  Zufallspaare (Alphabet a-d, Laenge 1..6): ${faelle}`);
  console.log(`  davon mit geloeschten Gewinner-Zeichen an :1454: ${mitLoeschung}`);
  if (beispiel) console.log(`  Beispiel: ${JSON.stringify(beispiel)}`);

  // Gegenprobe: gemischte Zeilenenden (CRLF lokal, LF beim Gewinner)
  const wt = 'a\nb\nc\n';
  const lt = 'a\r\nb\r\nc\r\nd\r\n';
  const { v, wClient, ziel } = wechsel(wt, lt);
  console.log(
    `  GEGENPROBE CRLF: geloeschte Gewinner-Zeichen = ${geloeschteFremdItems(v, wClient)} ` +
      `(Ziel ${JSON.stringify(ziel)})`
  );
}
console.log('');

// =========================================================================
// PROBE 2 — F3: beide tippen dieselbe Zeile. Was toetet sie danach?
// =========================================================================
console.log('## PROBE 2 — der aliasierte Beitrag und seine Todesarten');
const ZEILE = '- [ ] Kran bestellen';
{
  // Gewinner: Grundtext + eigene Aenderung + ZEILE. Verlierer: Grundtext +
  // andere eigene Aenderung + dieselbe ZEILE an derselben Stelle.
  const winnerArr = ersetze(
    [...grund.slice(0, 14), ZEILE, ...grund.slice(14)],
    'Der Bauantrag liegt beim Amt.',
    'Der Bauantrag ist bewilligt.'
  );
  const localArr = ersetze(
    [...grund.slice(0, 14), ZEILE, ...grund.slice(14)],
    'status: offen',
    'status: laufend'
  );
  const winnerText = winnerArr.join('\n');
  const localText = localArr.join('\n');

  const lagen = [
    {
      name: 'a) Gewinner LOESCHT seine Zeile',
      tun: (w) => w.setzen(ohne(w.text().split('\n'), ZEILE).join('\n')),
    },
    {
      name: 'b) Gewinner AENDERT seine Zeile (kein Loeschwille)',
      tun: (w) =>
        w.setzen(
          w
            .text()
            .split('\n')
            .map((z) => (z === ZEILE ? ZEILE + ' (Firma Nord)' : z))
            .join('\n')
        ),
    },
    {
      name: 'c) Gewinner spielt einen ALTEN Stand zurueck (git checkout / Backup)',
      tun: (w) => w.setzen(grundText),
    },
  ];

  for (const lage of lagen) {
    const { w, v, wClient, vClient } = wechsel(winnerText, localText);
    const vor = besitzerVon(v, ZEILE);
    lage.tun(w);
    abgleich(w, v);
    const daV = zaehle(v.text(), ZEILE);
    const daW = zaehle(w.text(), ZEILE);
    console.log(
      `  ${lage.name}\n` +
        `     Besitzer der Zeile beim Verlierer vor dem Schlag: ${vor}` +
        ` (Gewinner=${wClient}, Verlierer=${vClient})\n` +
        `     danach: beim Verlierer ${daV}x, beim Gewinner ${daW}x  -> ${daV > 0 ? 'LEBT' : 'TOT'}`
    );
  }
}
console.log('');

// =========================================================================
// PROBE 3 — HEILT die Aliasierung durch spaetere eigene Edits?
// =========================================================================
console.log('## PROBE 3 — heilt ein spaeterer eigener Edit den Alias?');
{
  const winnerArr = ersetze(
    [...grund.slice(0, 14), ZEILE, ...grund.slice(14)],
    'Der Bauantrag liegt beim Amt.',
    'Der Bauantrag ist bewilligt.'
  );
  const localArr = ersetze(
    [...grund.slice(0, 14), ZEILE, ...grund.slice(14)],
    'status: offen',
    'status: laufend'
  );
  const winnerText = winnerArr.join('\n');
  const localText = localArr.join('\n');

  const edits = [
    {
      name: 'a) Verlierer editiert eine ANDERE Zeile (10 Runden)',
      tun: (v) => {
        for (let i = 0; i < 10; i++) {
          v.setzen(
            v
              .text()
              .split('\n')
              .map((z) => (z.startsWith('- [ ] Statik') ? `- [ ] Statik pruefen ${i}` : z))
              .join('\n')
          );
        }
      },
      pruefZeile: ZEILE,
    },
    {
      name: 'b) Verlierer editiert GENAU DIESE Zeile (Haken setzen)',
      tun: (v) =>
        v.setzen(
          v
            .text()
            .split('\n')
            .map((z) => (z === ZEILE ? '- [x] Kran bestellen' : z))
            .join('\n')
        ),
      pruefZeile: '- [x] Kran bestellen',
    },
    {
      name: 'c) Verlierer haengt weiter unten Text an',
      tun: (v) => v.setzen(v.text() + '\n## Notizen\nAnruf am Montag\n'),
      pruefZeile: ZEILE,
    },
  ];

  for (const e of edits) {
    const { w, v, wClient, vClient } = wechsel(winnerText, localText);
    e.tun(v);
    const besitzerNach = besitzerVon(v, e.pruefZeile);
    // Gewinner sieht den Stand und loescht dann SEINE Fassung der Zeile
    w.holen(v.stand());
    w.setzen(ohne(w.text().split('\n'), ZEILE).join('\n'));
    abgleich(w, v);
    const daV = zaehle(v.text(), e.pruefZeile);
    console.log(
      `  ${e.name}\n` +
        `     Besitzer von ${JSON.stringify(e.pruefZeile)} nach dem Edit: ${besitzerNach}` +
        ` (Gewinner=${wClient}, Verlierer=${vClient})\n` +
        `     nach der Loeschung durch den Gewinner: ${daV}x -> ${daV > 0 ? 'LEBT' : 'TOT'}`
    );
  }
}
console.log('');

// =========================================================================
// PROBE 4 — Reihenfolge: Loeschung VOR dem Wechsel
// =========================================================================
console.log('## PROBE 4 — dieselbe Loeschung, aber VOR dem Wechsel');
{
  const winnerArr = ersetze(
    [...grund.slice(0, 14), ZEILE, ...grund.slice(14)],
    'Der Bauantrag liegt beim Amt.',
    'Der Bauantrag ist bewilligt.'
  );
  const localArr = ersetze(
    [...grund.slice(0, 14), ZEILE, ...grund.slice(14)],
    'status: offen',
    'status: laufend'
  );
  // Der Gewinner hat seine Zeile schon geloescht, BEVOR der Verlierer wechselt:
  // sein Stand traegt sie nicht mehr.
  const winnerText = ohne(winnerArr, ZEILE).join('\n');
  const localText = localArr.join('\n');
  const { w, v, wClient, vClient } = wechsel(winnerText, localText);
  const b = besitzerVon(v, ZEILE);
  abgleich(w, v);
  console.log(
    `  Besitzer der Zeile beim Verlierer: ${b} (Gewinner=${wClient}, Verlierer=${vClient})`
  );
  console.log(
    `  Endstand: Verlierer ${zaehle(v.text(), ZEILE)}x, Gewinner ${zaehle(w.text(), ZEILE)}x` +
      ` -> ${zaehle(v.text(), ZEILE) > 0 ? 'LEBT (Wiederbelebung)' : 'TOT'}`
  );
}
console.log('');

// =========================================================================
// PROBE 5 — die Gegenrichtung: gemeinsame Grundtextzeile, gemeinsam geloescht
// =========================================================================
console.log('## PROBE 5 — Gegenrichtung: was kostet es, wenn NICHT aliasiert wird?');
{
  const winnerText = ersetze(grund, 'status: offen', 'status: laufend').join('\n');
  const localText = ersetze(
    grund,
    'Der Bauantrag liegt beim Amt.',
    'Der Bauantrag ist bewilligt.'
  ).join('\n');
  const { w, v, wClient } = wechsel(winnerText, localText);
  const karte = besitz(v);
  const fremd = karte.filter((z) => z.clients.size === 1 && z.clients.has(wClient)).length;
  console.log(`  Zeilen im Verlierer-Doc: ${karte.length}, davon ganz beim Gewinner: ${fremd}`);
  // Der Gewinner loescht eine gewoehnliche Grundtextzeile
  w.holen(v.stand());
  w.setzen(ohne(w.text().split('\n'), '- [ ] Statik pruefen').join('\n'));
  abgleich(w, v);
  console.log(
    `  Gewinner loescht "- [ ] Statik pruefen": beim Verlierer danach ` +
      `${zaehle(v.text(), '- [ ] Statik pruefen')}x, konvergent=${v.text() === w.text()}`
  );
}
