// WIRKSAMKEITSNACHWEIS fuer die Fidelitaet des Apparats.
//
//   SPIKE_BUNDLE=./real-neu.cjs node fidelitaet.mjs <N> <seeds> <detSeed>
//
// Zaehlt, welche Einstiegspunkte des Produktivcodes der Spike-Treiber ueberhaupt
// beruehrt. Der Zweck ist die GEGENPROBE: Ein Zaehler, der 0 meldet, ist nur dann
// eine Aussage, wenn danebenstehende Zaehler desselben Bauart-Musters ungleich 0
// melden. Sonst ist „wird nicht gerufen" von „mein Zaehler ist blind" nicht zu
// unterscheiden — in diesem Projekt waren nachweislich sechs Instrumente blind.
//
// Alle Zaehler sitzen auf DEMSELBEN Prototyp und werden auf DIESELBE Weise
// gesetzt. Sie sind damit gemeinsam blind oder gemeinsam sehend.
import { createRequire } from 'node:module';
import { buildScenario, Transport, rng } from './harness.mjs';

const require = createRequire(import.meta.url);
// Siehe bilanz-n.mjs: derselbe Treiber, wahlweise die Fassung vor dem Nachbau.
const S = await import(process.env.SPIKE_SCHNITTE ?? './schnitte.mjs');
const det = require('./det-quelle.cjs');
const webcrypto = require('lib0/webcrypto');
det.zufallQuelleAn();
globalThis.crypto.getRandomValues = (arr) => webcrypto.getRandomValues(arr);
const R = require(process.env.SPIKE_BUNDLE ?? './real.cjs');

const N = Number(process.argv[2] ?? 3);
const SEEDS = Number(process.argv[3] ?? 10);
const DET = Number(process.argv[4] ?? 42);

const P = R.SyncHandler.prototype;
const z = {
  applyLocalContent: 0,
  loadAndMerge: 0,
  noteLocalDiffBase: 0,
  'mergeForLocalDiff(imSweep=true)': 0,
  mergeForLocalDiff: 0,
  parkForeign: 0,
  tickParked: 0,
  hasAbortedRead: 0,
  pendingLocalContent: 0,
  noteUncapturedLocalContent: 0,
};
// Wirkt der Aufruf auch? Nicht nur zaehlen, sondern die Wirkung am Zustand
// pruefen: nach `noteLocalDiffBase(p, c)` muss `localDiffBase.get(p) === c` sein.
let basisGesetzt = 0;
let basisAbweichend = 0;

const patch = (obj, name, key = name) => {
  const orig = obj[name];
  if (typeof orig !== 'function') throw new Error(`kein ${name} auf dem Prototyp`);
  obj[name] = function (...a) {
    z[key]++;
    return orig.apply(this, a);
  };
};
for (const n of ['applyLocalContent', 'loadAndMerge', 'parkForeign', 'tickParked',
                 'hasAbortedRead', 'pendingLocalContent', 'noteUncapturedLocalContent']) {
  patch(P, n);
}
// Anhaengen der `.md`-Historie beim fruehestmoeglichen Handler-Kontakt; zugleich
// werden die Handler eingesammelt, damit die RUHELAGE geprueft werden kann.
const handlerSet = new Set();
for (const n of ['applyLocalContent', 'loadAndMerge']) {
  const o = P[n];
  P[n] = function (...a) { handlerSet.add(this); sicherHistorie(this.vault); return o.apply(this, a); };
}

const origNote = P.noteLocalDiffBase;
P.noteLocalDiffBase = function (notePath, content) {
  z.noteLocalDiffBase++;
  const erg = origNote.call(this, notePath, content);
  if (this.localDiffBase.get(notePath) === content) basisGesetzt++;
  else basisAbweichend++;
  return erg;
};

const origMFLD = P.mergeForLocalDiff;
P.mergeForLocalDiff = function (notePath, content, imSweep) {
  z.mergeForLocalDiff++;
  if (imSweep === true) z['mergeForLocalDiff(imSweep=true)']++;
  return origMFLD.call(this, notePath, content, imSweep);
};

// DIE eigentliche Groesse der Fidelitaetsluecke: Ist die Diff-Basis ein Text, der
// in dieser `.md` jemals gestanden hat? `localDiffBase` heisst „zuletzt gesehener
// .md-Stand". Ohne `noteLocalDiffBase` nach dem Write-Back bleibt sie auf dem
// Stand VOR dem Write stehen — dann rechnet `chooseLocalDiffBase` gegen einen
// Text, den die Datei nie getragen hat.
//
// Dafuer wird jeder `.md`-Stand mitgeschrieben: `_textFiles.set` des jeweiligen
// Vault-Mocks wird beim ersten Handler-Aufruf umhuellt und legt jede Fassung in
// eine Historie je Pfad. (Die Bundle-Exporte selbst sind Getter ohne Setter —
// `makeVaultMock` laesst sich nicht ersetzen.) Die Ausgangstexte des Szenarios
// werden vorab eingetragen, damit die vor dem Anhaengen geschriebene erste
// Fassung nicht als „nie dagewesen" zaehlt.
const instrumentiert = new WeakSet();
let basisTexte = new Map();
function sicherHistorie(v) {
  if (!v || !v._textFiles) return undefined;
  if (!instrumentiert.has(v)) {
    instrumentiert.add(v);
    const hist = new Map();
    v.__historie = hist;
    const merke = (p, t) => {
      let s = hist.get(p);
      if (!s) hist.set(p, (s = new Set()));
      s.add(t);
    };
    for (const [p, t] of v._textFiles) merke(p, t);
    for (const [p, t] of basisTexte) merke(p, t);
    const set = v._textFiles.set.bind(v._textFiles);
    v._textFiles.set = (p, t) => { merke(p, t); return set(p, t); };
  }
  return v.__historie;
}

let chooseRuf = 0, chooseNieDagewesen = 0, chooseLastSeen = 0, chooseDoc = 0;
const origChoose = P.chooseLocalDiffBase;
P.chooseLocalDiffBase = function (notePath, content, docBeforeMerge, mergedText) {
  chooseRuf++;
  const lastSeen = this.localDiffBase.get(notePath);
  const hist = sicherHistorie(this.vault)?.get(notePath);
  if (lastSeen !== undefined && hist !== undefined && !hist.has(lastSeen)) chooseNieDagewesen++;
  const b = origChoose.call(this, notePath, content, docBeforeMerge, mergedText);
  if (b === lastSeen) chooseLastSeen++;
  else chooseDoc++;
  return b;
};

let grundWeg = 0;
const pfadSumme = new Map();
const ruhe = { gleich: 0, abweichend: 0, ohneBasis: 0 };
for (let seed = 1; seed <= SEEDS; seed++) {
  det.setzeZufallSeed((DET ^ (seed * 0x9e3779b1)) | 0);
  const sc = buildScenario({ seed, nNotes: 10, devices: N, editsPerDevice: 1, imprintWindow: 120 });
  basisTexte = new Map(sc.notes.map((n) => [n.path, n.baseline]));
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
    for (const zz of n.baseline.trim().split('\n')) if (!da.has(zz)) grundWeg++;
  }
  for (const d of devs)
    for (const [k, v] of Object.entries(d.stats().pfad ?? {}))
      pfadSumme.set(k, (pfadSumme.get(k) ?? 0) + v);
  // DIE RUHELAGE. `localDiffBase` heisst laut sync-handler.ts:350/1718 „zuletzt
  // gesehener .md-Stand". Nach Ablauf des Szenarios ist nichts mehr in Bewegung
  // (kein Parkplatz, kein Abbruch — beide Zaehler oben stehen auf 0), also MUSS
  // die Basis je Notiz genau der .md dieses Geraets entsprechen. Jede Abweichung
  // ist genau die Fidelitaetsluecke, um die es geht.
  for (const h of handlerSet) {
    for (const n of sc.notes) {
      const b = h.localDiffBase.get(n.path);
      if (b === undefined) { ruhe.ohneBasis++; continue; }
      if (b === h.vault._textFiles.get(n.path)) ruhe.gleich++;
      else ruhe.abweichend++;
    }
  }
  handlerSet.clear();
}

console.log(`FIDELITAET N=${N} Seeds=${SEEDS} DET=${DET} Bundle=${process.env.SPIKE_BUNDLE ?? './real.cjs'}`);
console.log(`  GRUNDTEXT-WEG = ${grundWeg}`);
for (const [k, v] of Object.entries(z)) console.log(`  ${k.padEnd(34)} ${String(v).padStart(6)}`);
console.log(`  noteLocalDiffBase wirksam (Map traegt den Wert)   ${String(basisGesetzt).padStart(6)}`);
console.log(`  noteLocalDiffBase unwirksam                       ${String(basisAbweichend).padStart(6)}`);
console.log(`  chooseLocalDiffBase Aufrufe                       ${String(chooseRuf).padStart(6)}`);
console.log(`    Basis stand NIE in dieser .md                   ${String(chooseNieDagewesen).padStart(6)}`);
console.log(`    Ergebnis = lastSeen / docBeforeMerge            ${String(chooseLastSeen).padStart(6)} / ${chooseDoc}`);
console.log(`  RUHELAGE (Basis == .md dieses Geraets)            ${String(ruhe.gleich).padStart(6)}`);
console.log(`  RUHELAGE ABWEICHEND                               ${String(ruhe.abweichend).padStart(6)}`);
console.log(`  RUHELAGE ohne Basis-Eintrag                       ${String(ruhe.ohneBasis).padStart(6)}`);
if (pfadSumme.size) {
  console.log('  Zweige des nachgebildeten Produktivpfads (0 = im Szenario unerreichbar):');
  for (const [k, v] of pfadSumme) console.log(`    ${k.padEnd(20)} ${String(v).padStart(6)}`);
}
