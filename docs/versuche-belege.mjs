// versuche-belege.mjs — haelt jede Zahl der Registratur gegen ihre Quellen.
//
// AUFRUF:  node docs/versuche-belege.mjs [--alle]
//          --alle zeigt auch die Eintraege ohne Befund.
//
// WOZU
// `versuche.yaml` ist aus Prosa zusammengetragen. Ihr ganzer Wert liegt darin,
// dass die Zahlen stimmen — eine Registratur mit falschen Zahlen ist schlimmer
// als keine, weil sie Nachschlagen ersetzt. Von Hand geprueft waren neun von
// 48 Eintraegen; dieses Skript prueft alle.
//
// VERFAHREN
// Aus jeder `kennzahl` werden Zahl-Token gezogen (`344/400`, `8.640`, `42 %`,
// `-18,3 %`) und in den Quelldateien gesucht, jeweils in mehreren Schreibweisen
// (mit und ohne Tausenderpunkt, Komma und Punkt als Dezimaltrenner). Wird ein
// Token nirgends gefunden, ist das ein Befund.
//
// WAS ES NICHT PRUEFT — ausdruecklich, damit niemand mehr hineinliest:
//   - Die ZUORDNUNG. Steht `74` in einer Quelle, gilt es als belegt, auch wenn
//     es dort zu einem anderen Kandidaten gehoert. Ein sauberer Lauf heisst
//     "keine erfundene Zahl", nicht "jede Zahl am richtigen Eintrag".
//   - VOLLSTAENDIGKEIT. Ein Versuch, der gar nicht eingetragen ist, faellt hier
//     nicht auf. Das bleibt die schwerere Luecke, und dagegen hilft nur Lesen.
//   - Eintraege ohne Zahl (`kennzahl: analytisch`) — dort gibt es nichts zu
//     halten.
//
// GEGENPROBE: Die neun von Hand geprueften Eintraege (K-02, K-05, K-06, M-01,
// M-02, T-04, K-14, A-01, K-13) muessen sauber durchgehen. Melden sie Befunde,
// produziert der Pruefer Falsch-Positive und ist unbrauchbar, bevor er
// irgendetwas ueber die uebrigen 39 sagt.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, YAML_PFAD } from './versuche-ansicht.mjs';

const HIER = dirname(fileURLToPath(import.meta.url));
const REPO = join(HIER, '..');
const DOKU = process.env.QOLLAB_DOKU_DIR ?? join(REPO, '..', 'obsidian-qollab-doku', 'sdd');
// Kein hartcodierter Pfad: Der Wissenspool liegt bei jedem woanders. Fehlt die
// Variable, wird er uebersprungen und das im Kopf gemeldet — ein stiller
// Ausfall waere schlimmer, weil der Lauf dann faelschlich gruen aussaehe.
const VAULT = process.env.QOLLAB_WIKI_DIR ?? '';

// Bereits von Hand gegen die Quellen geprueft — die Kalibrierung des Pruefers.
const GEPRUEFT = ['K-02', 'K-05', 'K-06', 'M-01', 'M-02', 'T-04', 'K-14', 'A-01', 'K-13'];

function quellen() {
  const dateien = [join(REPO, 'docs', 'produktziel.md'), join(REPO, 'README.md')];
  for (const [ordner, filter] of [[DOKU, (n) => n.endsWith('.md')], [VAULT, (n) => n.startsWith('CRDT-') || n.startsWith('Schreibherkunft') || n.startsWith('Nicht-idempotente')]]) {
    if (!existsSync(ordner)) continue;
    for (const n of readdirSync(ordner)) if (filter(n)) dateien.push(join(ordner, n));
  }
  return dateien;
}

const TEXT = quellen().map((d) => {
  try { return readFileSync(d, 'utf8'); } catch { return ''; }
}).join('\n');

/** Alle Schreibweisen, unter denen ein Token in einer Quelle stehen kann. */
function varianten(tok) {
  const v = new Set([tok]);
  v.add(tok.replace(/\./g, ''));           // 8.640 -> 8640
  v.add(tok.replace(/\./g, ' '));          // gesperrt gesetzt
  if (/,/.test(tok)) v.add(tok.replace(',', '.'));   // 18,3 -> 18.3
  if (/\d\.\d/.test(tok)) v.add(tok.replace('.', ',')); // 18.3 -> 18,3
  return [...v];
}

/**
 * Steht das Token als eigenstaendige Zahl im Text — nicht als Teilstueck einer
 * groesseren?
 *
 * DIE ERSTE FASSUNG BENUTZTE HIER `TEXT.includes(tok)` UND WAR DAMIT BLIND:
 * Die Mutationsprobe ersetzte "8 Tests" durch "93 Tests", und der Pruefer
 * meldete nichts — die Ziffernfolge 93 steckt in 200 Dateien in irgendeiner
 * groesseren Zahl, einer Zeilennummer oder einem Datum. Die 0 Befunde des
 * ersten Laufs waren fuer kurze Zahlen wertlos.
 */
function stehtImText(tok) {
  return varianten(tok).some((x) => {
    const esc = x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?<![\\d.,/])${esc}(?![\\d.,/])`).test(TEXT);
  });
}

/**
 * Ist ein Token ueberhaupt aussagekraeftig?
 *
 * Zweistellige Ganzzahlen sind es nicht: Es gibt nur 90 davon, und in einem
 * Korpus dieser Groesse kommt jede vor. Sie als "belegt" zu zaehlen faerbt den
 * Bericht gruen, ohne etwas zu pruefen — genau der Fehler, den die
 * Mutationsprobe aufgedeckt hat. Sie werden deshalb ausgewiesen statt gewertet.
 */
function istStark(tok) {
  if (tok.includes('/')) return true;                 // Bruch, z.B. 344/400
  if (/[.,]/.test(tok)) return true;                  // 8.640 oder 18,3
  return tok.replace(/\D/g, '').length >= 3;          // ab dreistellig
}

/** Zieht die pruefbaren Zahl-Token aus einer Kennzahl. */
function tokens(kennzahl) {
  const roh = [];
  // Brueche zuerst, damit 344/400 nicht als zwei Zahlen zerfaellt.
  const brueche = kennzahl.match(/\d[\d.]*\s*\/\s*\d[\d.]*/g) ?? [];
  let rest = kennzahl;
  for (const b of brueche) { roh.push(b.replace(/\s+/g, '')); rest = rest.replace(b, ' '); }
  for (const z of rest.match(/\d[\d.,]*/g) ?? []) {
    const t = z.replace(/[.,]$/, '');
    // Einstellige Zahlen sind als Beleg wertlos (kommen ueberall vor) und
    // Jahreszahlen ebenfalls.
    if (t.length < 2 || /^20\d\d$/.test(t)) continue;
    // Aufzaehlungen wie `N=2,3,4` sind keine Zahl. Erkennbar an mehr als einem
    // Trenner mit durchweg einstelligen Gruppen — echte Zahlen haben entweder
    // dreistellige Gruppen (8.640) oder genau einen Dezimaltrenner (18,3).
    // Ohne diese Zeile meldete der Pruefer T-05 als Befund, obwohl dort nichts
    // falsch ist.
    const gruppen = t.split(/[.,]/);
    if (gruppen.length > 2 && gruppen.every((g) => g.length <= 1)) continue;
    roh.push(t);
  }
  return [...new Set(roh)];
}

const { versuche } = parse(readFileSync(YAML_PFAD, 'utf8'));
const alle = process.argv.includes('--alle');
let befunde = 0;
let geprueftMitBefund = [];
let ohneZahl = 0;

console.log('Registratur — Belegprobe der Kennzahlen');
if (!VAULT) {
  console.log('HINWEIS: QOLLAB_WIKI_DIR ist nicht gesetzt — der Wissenspool wird nicht durchsucht.');
  console.log('         Zahlen, die NUR in der Vault-Note stehen, melden dann faelschlich als Befund.');
} else if (!existsSync(VAULT)) {
  console.log(`HINWEIS: QOLLAB_WIKI_DIR zeigt auf '${VAULT}' — Pfad existiert nicht.`);
}
console.log('='.repeat(78));

let schwachNur = 0;
for (const v of versuche) {
  const alleToks = tokens(String(v.kennzahl ?? ''));
  const toks = alleToks.filter(istStark);
  const schwach = alleToks.filter((t) => !istStark(t));
  if (!alleToks.length) { ohneZahl++; if (alle) console.log(`  ${v.id}  (keine pruefbare Zahl)`); continue; }
  if (!toks.length) {
    schwachNur++;
    if (alle) console.log(`  ${v.id}  nur schwache Token (${schwach.join(', ')}) — nicht aussagekraeftig`);
    continue;
  }
  const fehlend = toks.filter((t) => !stehtImText(t));
  if (fehlend.length) {
    befunde++;
    if (GEPRUEFT.includes(v.id)) geprueftMitBefund.push(v.id);
    console.log(`  BEFUND ${v.id}  nicht auffindbar: ${fehlend.join(', ')}`);
    console.log(`         kennzahl: ${v.kennzahl}`);
  } else if (alle) {
    console.log(`  ok     ${v.id}  ${toks.length} Zahl(en) belegt`);
  }
}

console.log('='.repeat(78));
console.log(`${versuche.length} Eintraege · ${ohneZahl} ohne Zahl · ${schwachNur} nur mit schwachen Token · ${befunde} Befund(e)`);
console.log(`geprueft wurden damit ${versuche.length - ohneZahl - schwachNur} Eintraege.`);
if (geprueftMitBefund.length) {
  console.log(`WARNUNG: ${geprueftMitBefund.join(', ')} sind von Hand geprueft und melden trotzdem — der Pruefer produziert Falsch-Positive.`);
  process.exit(2);
}
console.log('Kalibrierung: die neun von Hand geprueften Eintraege sind sauber.');
console.log('Grenze: geprueft wird die EXISTENZ jeder Zahl in den Quellen, nicht ihre Zuordnung.');
process.exit(befunde > 0 ? 1 : 0);
