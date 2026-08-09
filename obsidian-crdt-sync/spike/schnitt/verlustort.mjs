// WO stirbt eine Grundtextzeile? Zaehlt ueber alle Seeds, in welchem Aufruf des
// Produktivcodes eine Zeile verschwindet, die VORHER auf BEIDEN Seiten stand.
//
//   SPIKE_BUNDLE=./real-neu.cjs node verlustort.mjs <N> <seeds> <detSeed> [eingriff]
//
// Kriterium (streng, damit es nichts erfindet): eine Grundtextzeile (`*-base-*`),
// die sowohl im hereingereichten `.md`-Text (`content`) ALS AUCH im Doc-Stand
// nach dem Fremd-Merge (`mergedText`) steht, fehlt im Rueckgabewert. So eine
// Zeile kann kein Merge legitim entfernen — niemand hat sie geloescht.
//
// `eingriff=zeilenweise` schaltet die Gegenprobe ein: `chooseLocalDiffBase`
// prueft dann zeilenweise statt auf dem geglaetteten Zeichen-Chunk, ob die `.md`
// den Doc-Vorlauf schon traegt. NUR im Spike, `src/` bleibt unberuehrt.
import { createRequire } from 'node:module';
import { buildScenario, Transport, rng } from './harness.mjs';
import * as S from './schnitte.mjs';

const require = createRequire(import.meta.url);
const det = require('./det-quelle.cjs');
const webcrypto = require('lib0/webcrypto');
det.zufallQuelleAn();
globalThis.crypto.getRandomValues = (arr) => webcrypto.getRandomValues(arr);
const R = require(process.env.SPIKE_BUNDLE ?? './real.cjs');

const N = Number(process.argv[2] ?? 3);
const SEEDS = Number(process.argv[3] ?? 40);
const DET = Number(process.argv[4] ?? 42);
const EINGRIFF = process.argv[5] ?? '';

const P = R.SyncHandler.prototype;
const zahl = { mfldRuf: 0, mfldTot: 0, mfldZeilen: 0, uniteRuf: 0, uniteTot: 0, lamRuf: 0, lamTot: 0, setRuf: 0, setTot: 0, setZeilen: 0, setBruch: 0, setDel: 0 };
const beispiele = [];

const basisZeilen = (t) => String(t ?? '').split('\n').filter((l) => /-base-\d+$/.test(l));

// --- unite (unionMerge) getrennt beobachten -------------------------------
const origUnite = P.unite;
let inUnite = false;
P.unite = function (notePath, other, local) {
  zahl.uniteRuf++;
  const erg = origUnite.call(this, notePath, other, local);
  const weg = basisZeilen(local).filter((z) => basisZeilen(other).includes(z) && !erg.split('\n').includes(z));
  if (weg.length) { zahl.uniteTot++; }
  inUnite = true;
  return erg;
};

// --- mergeForLocalDiff: der ganze lokale Merge ----------------------------
// Welche Basis hat `chooseLocalDiffBase` fuer den laufenden Aufruf geliefert?
let letzteBasis = null;
const origChoose0 = P.chooseLocalDiffBase;
P.chooseLocalDiffBase = function (...a) {
  const b = origChoose0.apply(this, a);
  letzteBasis = b;
  return b;
};

// Wie viele VERSCHIEDENE fremde Geraete haben Zeilen beigesteuert?
const geraete = (zeilen) => new Set(zeilen.map((l) => (l.match(/-D(\d+)-/) ?? [])[1]).filter((x) => x !== undefined));
const verteilung = { alle: new Map(), tot: new Map() };
const zaehleIn = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);

const origMFLD = P.mergeForLocalDiff;
P.mergeForLocalDiff = async function (notePath, content, imSweep) {
  zahl.mfldRuf++;
  inUnite = false;
  letzteBasis = null;
  // Doc-Stand nach dem Fremd-Merge kann erst innen ermittelt werden; deshalb
  // hier den Doc-Stand VOR und NACH dem Aufruf nehmen und zusaetzlich `content`.
  const erg = await origMFLD.call(this, notePath, content, imSweep);
  const docNach = this.crdtManager.getContent(notePath);
  const ergZ = new Set(String(erg).split('\n'));
  // Zeilen, die content hatte und die im Doc-Stand nach dem Merge stehen
  // (docNach ist der fremd-gemergte Stand, solange setContent noch nicht lief —
  // mergeForLocalDiff schreibt den Doc nicht).
  const weg = basisZeilen(content).filter((z) => !ergZ.has(z));
  // Wie viele verschiedene FREMDE Geraete stehen im Doc-Vorlauf gegenueber der
  // Diff-Basis? Genau das ist der Stoff, aus dem der Zeichen-Patch seinen
  // Kontext verliert. `letzteBasis === null` = Adopt-Zweig (kein 3-Wege-Merge).
  if (letzteBasis !== null && !inUnite) {
    const basisZ = new Set(String(letzteBasis).split('\n'));
    const vorlauf = docNach.split('\n').filter((z) => z && !basisZ.has(z));
    const k = geraete(vorlauf).size;
    zaehleIn(verteilung.alle, k);
    if (weg.length) zaehleIn(verteilung.tot, k);
  }
  if (weg.length) {
    zahl.mfldTot++;
    zahl.mfldZeilen += weg.length;
    if (beispiele.length < 3) beispiele.push({ notePath, content, docNach, erg, weg, ueberUnite: inUnite });
  }
  return erg;
};

const origTick = P.tickParked;
let tickRuf = 0;
P.tickParked = function (...a) { tickRuf++; return origTick.apply(this, a); };
globalThis.__tick = () => tickRuf;

// --- loadAndMerge ---------------------------------------------------------
const origLAM = P.loadAndMerge;
P.loadAndMerge = async function (notePath) {
  zahl.lamRuf++;
  const vor = this.crdtManager.hasDoc(notePath) ? this.crdtManager.getContent(notePath) : '';
  const erg = await origLAM.call(this, notePath);
  if (typeof erg === 'string') {
    const ergZ = new Set(erg.split('\n'));
    const weg = basisZeilen(vor).filter((z) => !ergZ.has(z));
    if (weg.length) zahl.lamTot++;
  }
  return erg;
};

// --- setContent: HIER wird die Loesch-Op geboren --------------------------
// Nur `setContent` erzeugt lokale Ops. Verschwindet eine Grundtextzeile hier aus
// dem Doc, ist genau in diesem Aufruf die Loesch-Op entstanden, die danach zu
// allen Peers wandert. Jedes spaetere Verschwinden ist nur noch ihre Zustellung.
// Zusaetzlich: Wie oft erzeugt `setContent` eine Op, die eine ZEILENGRENZE
// ueberschreitet — also Zeichen einer Zeile loescht/einfuegt, ohne die ganze
// Zeile zu meinen? Genau solche Ops nehmen einer unberuehrten Zeile ihre
// Item-Identitaet. Der Diff wird hier mit denselben Mitteln nachgerechnet
// (`diff_main` + `diff_cleanupSemantic` = Standard 'semantisch').
const DMP2 = new (require('diff-match-patch').diff_match_patch)();
function zeilenbruch(vor, neu) {
  if (vor === neu) return { bruch: 0, hatDelete: false };
  const d = DMP2.diff_main(vor, neu);
  DMP2.diff_cleanupSemantic(d);
  let pos = 0, n = 0, del = false;
  for (const [op, t] of d) {
    if (op === 0) { pos += t.length; continue; }
    const startOk = pos === 0 || vor[pos - 1] === '\n';
    const endOk = t.endsWith('\n') || (op === -1 ? pos + t.length === vor.length : false);
    if (!startOk || !endOk) n++;
    if (op === -1) { del = true; pos += t.length; }
  }
  return { bruch: n, hatDelete: del };
}

const CP = R.CrdtManager.prototype;
const origSet = CP.setContent;
const setOrte = new Map();
globalThis.__seed = 0;
CP.setContent = function (notePath, text) {
  zahl.setRuf++;
  const vor = this.hasDoc(notePath) ? this.getContent(notePath) : '';
  const zb = zeilenbruch(vor, text);
  if (zb.bruch > 0) zahl.setBruch++;
  if (zb.hatDelete) zahl.setDel++;
  const erg = origSet.call(this, notePath, text);
  const nach = this.getContent(notePath);
  const nachZ = new Set(nach.split('\n'));
  const weg = basisZeilen(vor).filter((z) => !nachZ.has(z));
  if (weg.length) {
    zahl.setTot++;
    zahl.setZeilen += weg.length;
    // Aufrufstelle aus dem Stack — es gibt genau drei (sync-handler.ts 1307,
    // 1454, 1703). Der Bundle ist unminifiziert, die Funktionsnamen stehen drin.
    const st = new Error().stack ?? '';
    const ort =
      /switchToGuid/.test(st) ? 'switchToGuid:1454'
      : /ensureDoc/.test(st) ? 'ensureDoc:1307'
      : /applyLocalContent/.test(st) ? 'applyLocalContent:1703'
      : 'unbekannt';
    setOrte.set(`seed=${globalThis.__seed} ${ort} ${notePath} ${weg.join(',')}`, (setOrte.get(ort) ?? 0) + weg.length);
  }
  return erg;
};

// --- Gegenprobe A: kein Fuzz in patch_apply -------------------------------
// `threeWayMerge` ist der EINZIGE Ort im Produktivcode, der `patch_apply`
// benutzt, und `patch_apply` ist der einzige Ort, der `match_main` ruft. Wird
// `match_main` auf exaktes Suchen zurueckgeschnitten, kann ein Hunk nicht mehr
// an eine falsche Stelle wandern — er faellt dann aus. `unionMerge` und der
// Zeichen-Diff in crdt-manager.ts benutzen `diff_main`, nicht `match_main`, und
// bleiben unberuehrt. Chirurgischer geht es nicht.
if (EINGRIFF === 'kein-fuzz') {
  const DMPmod = require('diff-match-patch');
  DMPmod.diff_match_patch.prototype.match_main = function (text, pattern, loc) {
    return text.indexOf(pattern);
  };
}

// --- Gegenprobe B: zeilenweise Enthaltensein-Pruefung ---------------------
if (EINGRIFF === 'zeilenweise') {
  const origChoose = P.chooseLocalDiffBase;
  P.chooseLocalDiffBase = function (notePath, content, docBeforeMerge, mergedText) {
    const lastSeen = this.localDiffBase.get(notePath);
    if (lastSeen === undefined) return docBeforeMerge;
    const lead = R.insertedTexts(lastSeen, mergedText);
    if (lead.length === 0) return lastSeen;
    // EINZIGE Aenderung gegenueber src/sync-handler.ts:1893: statt zu fragen, ob
    // der geglaettete Zeichen-Chunk woertlich in der .md steht, wird jede ZEILE
    // des Chunks einzeln geprueft. Ein Chunk wie "D0-3\nn1-base-2\nn1-D0-6"
    // steht nie woertlich in der .md, seine Zeilen aber sehr wohl.
    const trifft = lead.some((l) =>
      l.split('\n').filter((z) => z.trim() !== '').some((z) => content.split('\n').includes(z))
    );
    return trifft ? docBeforeMerge : lastSeen;
  };
}

let grundWeg = 0;
for (let seed = 1; seed <= SEEDS; seed++) {
  globalThis.__seed = seed;
  det.setzeZufallSeed((DET ^ (seed * 0x9e3779b1)) | 0);
  const sc = buildScenario({ seed, nNotes: 10, devices: N, editsPerDevice: 1, imprintWindow: 120 });
  const r = rng(seed ^ 0x5bf03635);
  const tr = new Transport({ settle: 10, delay: 20, jitter: 10, r, mdModus: 'kopie' });
  const devs = S.makeS0real(tr, sc);
  for (const d of devs) for (const n of sc.notes) { d.seedFile(n.path, n.baseline); tr.letzterSyncStand.set(`${d.id}\0${n.path}`, n.baseline); }
  let ei = 0;
  for (let t = 0; t < 1200; t++) {
    while (ei < sc.events.length && sc.events[ei].at <= t) { const e = sc.events[ei++]; await devs[e.dev].userEdit(e.note, e.token, e.pos); }
    for (const d of devs) await d.onTick(t);
    tr.step(devs);
    if (t % 30 === 0) for (const d of devs) await d.poll();
    if (ei >= sc.events.length && tr.quiet()) { let ruhe = 0; for (; ruhe < 61 && tr.quiet(); ruhe++) tr.step(devs); if (ruhe >= 61) break; }
  }
  for (let i = 0; i < 6; i++) { for (const d of devs) await d.onTick(tr.tick, true); for (let k = 0; k < 35; k++) tr.step(devs); for (const d of devs) await d.poll(); }
  for (const n of sc.notes) {
    const da = new Set(devs[0].currentText(n.path).split('\n'));
    for (const z of n.baseline.trim().split('\n')) if (!da.has(z)) { grundWeg++; console.log(`  [seed=${seed}] fehlt ${n.path}:${z}`); }
  }
}

console.log(`N=${N} Seeds=${SEEDS} DET=${DET} Eingriff=${EINGRIFF || '(keiner)'}`);
console.log(`  GRUNDTEXT-WEG am Ende         = ${grundWeg}`);
console.log(`  mergeForLocalDiff: ${zahl.mfldRuf} Aufrufe, davon ${zahl.mfldTot} mit toter Grundtextzeile (${zahl.mfldZeilen} Zeilen)`);
console.log(`  unite/unionMerge : ${zahl.uniteRuf} Aufrufe, davon ${zahl.uniteTot} mit toter Grundtextzeile`);
console.log(`  loadAndMerge     : ${zahl.lamRuf} Aufrufe, davon ${zahl.lamTot} mit toter Grundtextzeile`);
console.log(`  crdt.setContent  : ${zahl.setRuf} Aufrufe, davon ${zahl.setTot} mit GEBORENER Loesch-Op auf Grundtext (${zahl.setZeilen} Zeilen)`);
console.log(`  tickParked       : ${globalThis.__tick()} Aufrufe`);
console.log(`  crdt.setContent  : ${zahl.setBruch} Aufrufe mit ZEILENGRENZEN-UEBERSCHREITENDER Op, ${zahl.setDel} Aufrufe mit ueberhaupt einer DELETE-Op`);
for (const [ort, n] of setOrte) console.log(`      davon ueber ${ort}: ${n} Zeilen`);
console.log('  3-Wege-Zweig nach Zahl VERSCHIEDENER fremder Geraete im Doc-Vorlauf:');
for (const k of [...verteilung.alle.keys()].sort()) {
  console.log(`      ${k} Geraet(e): ${String(verteilung.alle.get(k)).padStart(5)} Aufrufe, davon ${verteilung.tot.get(k) ?? 0} mit totem Grundtext`);
}
for (const b of beispiele) {
  console.log(`\n  BEISPIEL ${b.notePath} tot=${b.weg.join(',')} ueberUnite=${b.ueberUnite}`);
  console.log(`    content = ${JSON.stringify(b.content).replace(/\\n/g, '|')}`);
  console.log(`    docNach = ${JSON.stringify(b.docNach).replace(/\\n/g, '|')}`);
  console.log(`    erg     = ${JSON.stringify(b.erg).replace(/\\n/g, '|')}`);
}
