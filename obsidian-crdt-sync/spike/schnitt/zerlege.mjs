// Einen EINZELNEN verlustbehafteten Fall Schritt fuer Schritt mitschreiben.
//
//   SPIKE_BUNDLE=./real-neu.cjs node zerlege.mjs <N> <seed> <detSeed> <notiz> [zeile]
//
// Gleicher Lauf wie `einzel.mjs` (Strom je Seed neu gesetzt), zusaetzlich ein
// Protokoll: jeder Aufruf der beiden Eingaenge des Produktivcodes
// (`applyLocalContent`, `loadAndMerge`) und der inneren Stationen wird mit
// Vorher/Nachher-Text protokolliert, gefiltert auf EINE Notiz.
//
// Die Instrumentierung sitzt auf `SyncHandler.prototype` — `src/` bleibt
// unangetastet.
import { createRequire } from 'node:module';
import { buildScenario, Transport, rng } from './harness.mjs';
import * as S from './schnitte.mjs';

const require = createRequire(import.meta.url);
const det = require('./det-quelle.cjs');
const webcrypto = require('lib0/webcrypto');
det.zufallQuelleAn();
globalThis.crypto.getRandomValues = (arr) => webcrypto.getRandomValues(arr);
const R = require(process.env.SPIKE_BUNDLE ?? './real.cjs');
const DMPZ = new (require('diff-match-patch').diff_match_patch)();

const N = Number(process.argv[2] ?? 3);
const SEED = Number(process.argv[3] ?? 1);
const DET = Number(process.argv[4] ?? 42);
const NOTIZ = process.argv[5] ?? 'n1.md';
const ZEILE = process.argv[6] ?? null;

let T = 0;
const idVon = new Map(); // handler -> devIndex
const kurz = (s) =>
  s === undefined || s === null ? String(s) : JSON.stringify(String(s)).replace(/\\n/g, '|');
const log = (...a) => console.log(`t=${String(T).padStart(4)}`, ...a);

function passtNotiz(p) {
  return typeof p === 'string' && p.includes(NOTIZ.replace(/\.md$/, ''));
}

function markiere(text) {
  if (!ZEILE || text === undefined || text === null) return '';
  return String(text).split('\n').includes(ZEILE) ? '' : '   <<< ZEILE FEHLT';
}

// --- Instrumentierung -------------------------------------------------------
const P = R.SyncHandler.prototype;
function wrap(name, vorher, nachher) {
  const orig = P[name];
  P[name] = function (...args) {
    const dev = idVon.get(this.clientId) ?? this.clientId;
    const v = vorher ? vorher.call(this, args) : null;
    const r = orig.apply(this, args);
    const fertig = (erg) => {
      if (nachher) nachher.call(this, dev, args, erg, v);
      return erg;
    };
    return r && typeof r.then === 'function' ? r.then(fertig) : fertig(r);
  };
}

wrap('applyLocalContent', null, function (dev, [path, text], erg) {
  if (!passtNotiz(path)) return;
  log(`D${dev} applyLocalContent(${path})`);
  log(`      ein  = ${kurz(text)}${markiere(text)}`);
  log(`      raus = ${kurz(erg)}${markiere(erg)}`);
});

wrap('loadAndMerge', null, function (dev, [note], erg) {
  if (!passtNotiz(note)) return;
  log(`D${dev} loadAndMerge(${note})`);
  log(`      raus = ${kurz(erg)}${markiere(erg)}`);
});

wrap('unite', null, function (dev, args, erg) {
  if (!args.some((a) => passtNotiz(a))) return;
  log(`D${dev}   unite(${args.map(kurz).join(', ')}) -> ${kurz(erg)}${markiere(erg)}`);
});

wrap('parkForeign', null, function (dev, args, erg) {
  if (!passtNotiz(args[0])) return;
  log(`D${dev}   parkForeign(${kurz(args[0])}, ${kurz(args[1])})${markiere(args[1])}`);
});

wrap('resolveParked', null, function (dev, args, erg) {
  if (!passtNotiz(args[0])) return;
  log(`D${dev}   resolveParked(${kurz(args[0])}) -> ${kurz(erg)}`);
});

wrap('tickParked', null, function (dev, args, erg) {
  const e = erg && erg.length ? erg.filter((x) => passtNotiz(x.path ?? x[0])) : [];
  if (!e.length) return;
  log(`D${dev}   tickParked -> ${JSON.stringify(e.map((x) => ({ p: x.path, t: kurz(x.text ?? x.content) })))}`);
});

wrap('switchToGuid', null, function (dev, args, erg) {
  if (!passtNotiz(args[0])) return;
  log(`D${dev}   switchToGuid(${kurz(args[0])}, guid=${kurz(args[1])})`);
});

wrap('ensureDoc', null, function (dev, args, erg) {
  if (!passtNotiz(args[0])) return;
  log(`D${dev}   ensureDoc(${kurz(args[0])})`);
});

wrap('mergeCompatible', null, function (dev, args, erg) {
  if (!passtNotiz(args[0])) return;
  log(`D${dev}   mergeCompatible(${kurz(args[0])}) -> ${kurz(erg)}`);
});

wrap('mergePendingForeign', function (args) {
  return passtNotiz(args[0]) ? this.crdtManager.getContent(args[0]) : null;
}, function (dev, args, erg, vorher) {
  if (!passtNotiz(args[0])) return;
  const nach = this.crdtManager.getContent(args[0]);
  log(`D${dev}   mergePendingForeign(${kurz(args[0])}) siblings=${erg?.length ?? 0}`);
  log(`      doc vor  = ${kurz(vorher)}${markiere(vorher)}`);
  log(`      doc nach = ${kurz(nach)}${markiere(nach)}`);
});

wrap('mergeForLocalDiff', null, function (dev, args, erg) {
  if (!passtNotiz(args[0])) return;
  log(`D${dev}   mergeForLocalDiff -> ${kurz(erg)}${markiere(erg)}`);
});

wrap('chooseLocalDiffBase', null, function (dev, args, erg) {
  if (!passtNotiz(args[0])) return;
  log(`D${dev}   chooseLocalDiffBase -> ${kurz(erg)}${markiere(erg)}`);
});

// Jede Anwendung eines fremden Yjs-Updates auf den Doc.
const CP = R.CrdtManager.prototype;
for (const m of ['applyUpdate', 'mergeAndGet', 'setContent']) {
  const orig = CP[m];
  CP[m] = function (...args) {
    const p = args[0];
    if (!passtNotiz(p)) return orig.apply(this, args);
    const vor = this.hasDoc(p) ? this.getContent(p) : '(kein Doc)';
    if (m === 'setContent' && this.hasDoc(p) && vor !== args[1]) {
      // Die Op-Folge, die dieser setContent-Aufruf gleich ins Yjs-Doc schreibt —
      // mit denselben Mitteln nachgerechnet (Standard-Modus 'semantisch').
      const dd = DMPZ.diff_main(vor, args[1]);
      DMPZ.diff_cleanupSemantic(dd);
      log(`        [ops] ${dd.map(([o, t]) => (o === 0 ? '=' : o === 1 ? '+' : '-') + JSON.stringify(t).replace(/\\n/g, '|')).join(' ')}`);
    }
    const r = orig.apply(this, args);
    const nach = this.getContent(p);
    if (vor !== nach) log(`        [crdt.${m}] ${kurz(vor)}${markiere(vor)}\n                -> ${kurz(nach)}${markiere(nach)}`);
    return r;
  };
}

// --- Lauf -------------------------------------------------------------------
det.setzeZufallSeed((DET ^ (SEED * 0x9e3779b1)) | 0);
const sc = buildScenario({ seed: SEED, nNotes: 10, devices: N, editsPerDevice: 1, imprintWindow: 120 });
const r = rng(SEED ^ 0x5bf03635);
const tr = new Transport({ settle: 10, delay: 20, jitter: 10, r, mdModus: 'kopie' });

// clientId -> Index, damit das Protokoll D0/D1/D2 statt Hex zeigt.
const devs = S.makeS0real(tr, sc);
sc.deviceIds.forEach((id, i) => idVon.set(id, i));
for (const d of devs) {
  for (const n of sc.notes) {
    d.seedFile(n.path, n.baseline);
    tr.letzterSyncStand.set(`${d.id}\0${n.path}`, n.baseline);
  }
}

// Transportzustellungen mitschreiben.
const origStep = tr.step.bind(tr);
tr.step = (devices) => {
  const vorher = tr.inFlight.filter((f) => f.arriveAt <= tr.tick + 1);
  const n = origStep(devices);
  for (const f of vorher) {
    if (passtNotiz(f.path)) {
      log(`ZUSTELLUNG ${f.path} von ${devices.findIndex((d) => d.id === f.owner) >= 0 ? 'D' + devices.findIndex((d) => d.id === f.owner) : f.owner}` +
        (f.path.endsWith('.md') ? ` text=${kurz(new TextDecoder ? f.bytes : f.bytes)}${markiere(f.bytes)}` : ` (${f.bytes.length} B)`));
    }
  }
  return n;
};

const stand = devs.map(() => null);
function snapshot(wo) {
  for (let i = 0; i < devs.length; i++) {
    const t = devs[i].currentText(NOTIZ);
    if (t !== stand[i]) {
      log(`   TEXT D${i} nach ${wo}: ${kurz(t)}${markiere(t)}`);
      stand[i] = t;
    }
  }
}

let ei = 0;
for (T = 0; T < 1200; T++) {
  while (ei < sc.events.length && sc.events[ei].at <= T) {
    const e = sc.events[ei++];
    if (e.note === NOTIZ) log(`EDIT D${e.dev} ${e.note} token=${e.token} pos=${e.pos.toFixed(3)}`);
    await devs[e.dev].userEdit(e.note, e.token, e.pos);
    snapshot('userEdit');
  }
  for (const d of devs) await d.onTick(T);
  snapshot('onTick');
  tr.step(devs);
  snapshot('transport');
  if (T % 30 === 0) {
    for (const d of devs) await d.poll();
    snapshot('poll');
  }
  if (ei >= sc.events.length && tr.quiet()) {
    let ruhe = 0;
    for (; ruhe < 61 && tr.quiet(); ruhe++) tr.step(devs);
    if (ruhe >= 61) break;
  }
}
for (let i = 0; i < 6; i++) {
  for (const d of devs) await d.onTick(tr.tick, true);
  snapshot('nachlauf-onTick');
  for (let k = 0; k < 35; k++) tr.step(devs);
  snapshot('nachlauf-transport');
  for (const d of devs) await d.poll();
  snapshot('nachlauf-poll');
}

console.log('\n=== ENDE ===');
for (let i = 0; i < devs.length; i++) console.log(`D${i}: ${kurz(devs[i].currentText(NOTIZ))}`);
const basis = sc.notes.find((n) => n.path === NOTIZ).baseline;
const da = new Set(devs[0].currentText(NOTIZ).split('\n'));
console.log('Fehlende Grundtextzeilen bei D0:', basis.trim().split('\n').filter((z) => !da.has(z)).join(', ') || '(keine)');
