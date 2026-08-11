// WARUM: Die Differenzmessungen zeigen, dass weder der `diffModus` noch
// `unionMerge` den Grossteil der Verdopplung erklaeren. Diese Messung schliesst
// den Kreis, statt weiter Kandidaten zu raten: Der Text eines Yjs-Docs kann sich
// nur auf ZWEI Wegen aendern —
//
//   1. `CrdtManager.setContent`  (src/crdt-manager.ts:364) setzt den Doc-Text
//      exakt auf den uebergebenen `content`. Steht darin schon eine Zeile
//      doppelt, hat sie der AUFRUFER mitgebracht (Merge-Ergebnis, .md-Text).
//      setContent selbst kann keine erfinden — der Doc traegt danach genau
//      `content`.
//   2. `CrdtManager.applyUpdate` (Yjs-Merge fremder Sidecars). Yjs dedupliziert
//      nach Item-ID, nicht nach Inhalt: hat ein zweites Geraet denselben Text
//      als EIGENE Ops materialisiert, stehen danach beide Fassungen im Doc.
//
// Gemessen wird deshalb je Aufruf die MEHRFACHNENNUNG (Summe n-1 ueber alle
// Zeilen mit n > 1) vor und nach dem Aufruf. Die beiden Summen zerlegen die
// Verdopplung erschoepfend nach Entstehungsweg. Die Instrumentierung sitzt auf
// dem Prototyp des geladenen Bundles; `src/` bleibt unberuehrt.
//
//   (aus spike/schnitt/ heraus, damit `schnitte.mjs` sein Bundle findet)
//   SPIKE_BASELINES=8 SPIKE_MDMODUS=kopie node ../verdopplung/herkunft.mjs 4 42 1 200
import { createRequire } from 'node:module';
import { buildScenario, Transport, rng, score } from '../schnitt/harness.mjs';

const require = createRequire(import.meta.url);
const det = require('../schnitt/det-quelle.cjs');
const webcrypto = require('lib0/webcrypto');
det.zufallQuelleAn();
globalThis.crypto.getRandomValues = (arr) => webcrypto.getRandomValues(arr);
// SPIKE_BUNDLE ist relativ zu `spike/schnitt/` gemeint (so liest es
// `schnitte.mjs:24`). Ein zweiter `require` mit Basis DORT laedt deshalb genau
// dasselbe Modulobjekt — sonst haenge ich meine Zaehler an einen zweiten,
// unbenutzten Prototyp und messe nichts.
const reqS = createRequire(new URL('../schnitt/anker.mjs', import.meta.url));
const R = reqS(process.env.SPIKE_BUNDLE ?? './real-neu.cjs');
const S = await import('../schnitt/schnitte.mjs');
const PS = await import('../schnitt/patchsonde.mjs');
PS.sondeInstalliere(process.env.SPIKE_PATCH ?? 'dreiwege');

const N = Number(process.argv[2] ?? 4);
const DET = Number(process.argv[3] ?? 42);
const VON = Number(process.argv[4] ?? 1);
const BIS = Number(process.argv[5] ?? 200);
const NOTES = Number(process.env.SPIKE_NOTES ?? 10);
const BASELINES = Number(process.env.SPIKE_BASELINES ?? 8);
const EDITS = Number(process.env.SPIKE_EDITS ?? 1);
const MDMODUS = process.env.SPIKE_MDMODUS ?? 'kopie';
const NL = String.fromCharCode(10);

function mehrfach(text) {
  const m = new Map();
  for (const z of text.split(NL)) {
    if (z.length === 0) continue;
    m.set(z, (m.get(z) ?? 0) + 1);
  }
  let s = 0;
  for (const n of m.values()) if (n > 1) s += n - 1;
  return s;
}

let z;
const frisch = () => {
  z = {
    setRuf: 0, setPlus: 0, setMinus: 0,
    setAusLokal: 0, setPlusAusLokal: 0,
    applyRuf: 0, applyPlus: 0, applyMinus: 0,
  };
};

// Laeuft gerade `applyLocalContent`? Dann stammt der Text aus
// `mergeForLocalDiff` (3-Wege-Merge, Vereinigung oder der gemergte Doc-Stand).
let inLokal = 0;
const SH = R.SyncHandler.prototype;
const origApply = SH.applyLocalContent;
SH.applyLocalContent = async function (...a) {
  inLokal++;
  try {
    return await origApply.apply(this, a);
  } finally {
    inLokal--;
  }
};

const CP = R.CrdtManager.prototype;
const origSet = CP.setContent;
CP.setContent = function (pfad, content) {
  const vor = this.hasDoc(pfad) ? this.getContent(pfad) : '';
  const dVor = mehrfach(vor);
  const dNeu = mehrfach(content);
  const erg = origSet.call(this, pfad, content);
  if (vor !== content) {
    z.setRuf++;
    if (dNeu > dVor) z.setPlus += dNeu - dVor;
    if (dNeu < dVor) z.setMinus += dVor - dNeu;
    if (inLokal > 0) {
      z.setAusLokal++;
      if (dNeu > dVor) z.setPlusAusLokal += dNeu - dVor;
    }
  }
  return erg;
};

const origUpd = CP.applyUpdate;
CP.applyUpdate = function (pfad, update) {
  const vor = this.hasDoc(pfad) ? this.getContent(pfad) : '';
  const dVor = mehrfach(vor);
  const erg = origUpd.call(this, pfad, update);
  const nach = this.getContent(pfad);
  const dNach = mehrfach(nach);
  z.applyRuf++;
  if (dNach > dVor) z.applyPlus += dNach - dVor;
  if (dNach < dVor) z.applyMinus += dVor - dNach;
  return erg;
};

async function laufe(seed) {
  frisch();
  det.setzeZufallSeed((DET ^ (seed * 0x9e3779b1)) | 0);
  const sc = buildScenario({ seed, nNotes: NOTES, baseLines: BASELINES, devices: N, editsPerDevice: EDITS, imprintWindow: 120 });
  const r = rng(seed ^ 0x5bf03635);
  const tr = new Transport({ settle: 10, delay: 20, jitter: 10, r, mdModus: MDMODUS });
  const devs = S.makeS0real(tr, sc);
  for (const d of devs) {
    for (const n of sc.notes) {
      d.seedFile(n.path, n.baseline);
      tr.letzterSyncStand.set(`${d.id}\0${n.path}`, n.baseline);
    }
  }
  let ei = 0;
  for (let t = 0; t < 1200; t++) {
    while (ei < sc.events.length && sc.events[ei].at <= t) {
      const e = sc.events[ei++];
      await devs[e.dev].userEdit(e.note, e.token, e.pos);
    }
    for (const d of devs) await d.onTick(t);
    tr.step(devs);
    if (t % 30 === 0) for (const d of devs) await d.poll();
    if (ei >= sc.events.length && tr.quiet()) {
      let ruhe = 0;
      for (; ruhe < 61 && tr.quiet(); ruhe++) tr.step(devs);
      if (ruhe >= 61) break;
    }
  }
  for (let i = 0; i < 6; i++) {
    for (const d of devs) await d.onTick(tr.tick, true);
    for (let k = 0; k < 35; k++) tr.step(devs);
    for (const d of devs) await d.poll();
  }
  return { rr: score(sc, devs), z: { ...z } };
}

const g = { setRuf: 0, setPlus: 0, setMinus: 0, setAusLokal: 0, setPlusAusLokal: 0, applyRuf: 0, applyPlus: 0, applyMinus: 0 };
let gVerdopp = 0, gVerlust = 0;
const t0 = Date.now();
for (let seed = VON; seed <= BIS; seed++) {
  const o = await laufe(seed);
  for (const k of Object.keys(g)) g[k] += o.z[k];
  gVerdopp += o.rr.verdopplung;
  gVerlust += o.rr.verlust;
}
console.log(
  `== herkunft N=${N} DET=${DET} Seeds ${VON}..${BIS}` +
    ` [notizen=${NOTES} basis=${BASELINES} edits=${EDITS} md=${MDMODUS}` +
    ` diff=${process.env.QOLLAB_DIFF_MODUS ?? 'STANDARD'} patch=${process.env.SPIKE_PATCH ?? 'dreiwege'}` +
    ` s=${((Date.now() - t0) / 1000).toFixed(1)}]` +
    `: verdopp=${gVerdopp} verlust=${gVerlust}` +
    ` | setContent ruf=${g.setRuf} plus=${g.setPlus} minus=${g.setMinus}` +
    ` (davon ausApplyLocal ruf=${g.setAusLokal} plus=${g.setPlusAusLokal})` +
    ` | applyUpdate ruf=${g.applyRuf} plus=${g.applyPlus} minus=${g.applyMinus}`
);
