// r14-items.mjs — Wer hat die verklebte Zeile in r14 geschrieben?
//
// `verify.js` liefert pro ZEILE die beteiligten clientIDs. Fuer die verklebte
// Zeile `B2-<RunId>BBB-<RunId>` meldet es ZWEI — sie ist also nicht von einem
// Geraet getippt, sondern aus Items beider zusammengefuegt. Alle anderen Zeilen
// tragen genau eine.
//
// Dieses Instrument geht eine Ebene tiefer: Es laeuft die Y.Text-Itemkette ab
// und zeigt fuer JEDES Item (client, clock, geloescht?, Inhalt). Damit ist
// ablesbar, welche Operation welches Textstueck eingefuegt hat — und ob die
// zweite `BBB-`-Instanz ein NEUES Item ist (dann hat jemand sie materialisiert)
// oder dasselbe Item an anderer Stelle (dann waere es eine Verschiebung).
//
// Warum das die offene Frage von X-08 beantwortet: Ein einstufiger
// threeWayMerge ueber die naheliegende Basis erzeugt den gemessenen Text nicht.
// Die Itemkette sagt, WER geschrieben hat, statt zu raten, WELCHE Funktion lief.
//
// Aufruf (aus obsidian-crdt-sync/):
//   node spike/duplikat-mb/r14-items.mjs <vaultPfad> [<note>]
// Beispiel mit der gesicherten Evidenz:
//   node spike/duplikat-mb/r14-items.mjs ../obsidian-qollab-doku/sdd/runs/r14-evidenz/vault-b

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
let Y;
try {
  Y = require_('yjs');
} catch {
  console.error('yjs nicht ladbar. Aus obsidian-crdt-sync/ aufrufen oder NODE_PATH setzen.');
  process.exit(1);
}

const vault = process.argv[2];
const note = process.argv[3] ?? 'Meetingprotokoll.md';
if (!vault) {
  console.error('Aufruf: node r14-items.mjs <vaultPfad> [<note>]');
  process.exit(1);
}

// QLB2: Magic(4) + FNV-1a(4) + GUID(16) = Kopf 24. QLB1: Magic(4) + GUID(16) = 20.
// Headerlose Dateien sind v0.1 — alles ist Update. Siehe state-file.ts und
// harness/verify.js (dort mit Nachweispruefung; die ist hier nicht noetig, weil
// wir eine bereits gesicherte Evidenz lesen und nicht das Produkt bewerten).
function ladeUpdate(bytes) {
  const magic = Buffer.from(bytes.slice(0, 4)).toString('latin1');
  if (magic === 'QLB2' && bytes.length >= 24) return { format: 'QLB2', update: bytes.slice(24) };
  if (magic === 'QLB1' && bytes.length >= 20) return { format: 'QLB1', update: bytes.slice(20) };
  return { format: 'headerlos', update: bytes };
}

const qDir = path.join(vault, '.qollab');
if (!fs.existsSync(qDir)) {
  console.error(`Kein .qollab unter ${vault}`);
  process.exit(1);
}
const dateien = fs
  .readdirSync(qDir)
  .filter((n) => n.startsWith(note + '.') && n.endsWith('.yjs'))
  .sort();

console.log(`Vault : ${vault}`);
console.log(`Notiz : ${note}`);
console.log(`Hilfsdateien: ${dateien.length}`);

const doc = new Y.Doc();
for (const d of dateien) {
  const bytes = new Uint8Array(fs.readFileSync(path.join(qDir, d)));
  const { format, update } = ladeUpdate(bytes);
  console.log(`  ${d.padEnd(46)} ${String(bytes.length).padStart(4)} B  ${format}`);
  try {
    Y.applyUpdate(doc, update);
  } catch (e) {
    console.log(`    applyUpdate fehlgeschlagen: ${e.message}`);
  }
}

const ytext = doc.getText('content');
console.log(`\nText: ${ytext.length} Zeichen`);

// --- Die Itemkette --------------------------------------------------------
// Jedes Item traegt (client, clock) als Identitaet und ein Stueck Inhalt.
// Geloeschte Items bleiben als Tombstone in der Kette stehen; sie zaehlen nicht
// zum Text, sind aber fuer die Frage "wer hat wann was eingefuegt" wichtig.
console.log('\n--- Itemkette (in Dokumentreihenfolge) --------------------------');
console.log('  #   client        clock  del  Inhalt');
let item = ytext._start;
let i = 0;
const proClient = new Map();
while (item) {
  const inhalt = item.content?.str ?? `<${item.content?.constructor?.name ?? '?'}>`;
  const sichtbar = JSON.stringify(inhalt);
  console.log(
    `  ${String(i).padStart(2)}  ${String(item.id.client).padStart(11)}  ${String(item.id.clock).padStart(5)}  ` +
      `${item.deleted ? ' J ' : ' - '}  ${sichtbar}`
  );
  if (!item.deleted && typeof inhalt === 'string') {
    proClient.set(item.id.client, (proClient.get(item.id.client) ?? 0) + inhalt.length);
  }
  item = item.right;
  i++;
}

console.log('\n--- Lebende Zeichen je Client ----------------------------------');
for (const [c, n] of [...proClient.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(c).padStart(11)}  ${String(n).padStart(4)} Zeichen`);
}

// --- Die verklebte Stelle -------------------------------------------------
// Gesucht ist die Zeile, in der zwei Marker ohne Umbruch aufeinandertreffen.
const text = ytext.toString();
const zeilen = text.split('\n');
const verklebt = zeilen.findIndex((z) => /-\d{8}-\d{6}[A-Z]/.test(z));
console.log('\n--- Befund -----------------------------------------------------');
if (verklebt === -1) {
  console.log('  Keine verklebte Zeile gefunden (zwei Marker ohne Umbruch dazwischen).');
} else {
  console.log(`  Verklebte Zeile ${verklebt + 1}: ${JSON.stringify(zeilen[verklebt])}`);
  // Zeichenbereich der Zeile im Gesamttext bestimmen.
  const start = zeilen.slice(0, verklebt).reduce((n, z) => n + z.length + 1, 0);
  const ende = start + zeilen[verklebt].length;
  console.log(`  Zeichen ${start}..${ende}`);
  // Noch einmal durch die Kette, nur fuer diesen Bereich.
  let pos = 0;
  let it = ytext._start;
  console.log('  Items, die diese Zeile bilden:');
  while (it) {
    if (!it.deleted && typeof it.content?.str === 'string') {
      const len = it.content.str.length;
      const von = pos;
      const bis = pos + len;
      if (bis > start && von < ende) {
        const teil = it.content.str.slice(Math.max(0, start - von), Math.min(len, ende - von));
        console.log(
          `    client ${String(it.id.client).padStart(11)} clock ${String(it.id.clock).padStart(5)}  ${JSON.stringify(teil)}`
        );
      }
      pos = bis;
    }
    it = it.right;
  }
}
