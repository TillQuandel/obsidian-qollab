// Einen EINZELNEN Seed isoliert und reproduzierbar fahren.
//
//   node einzel.mjs <schnitt> <N> <seed> [detSeed]
//   node einzel.mjs <schnitt> <N> scan  [detSeed] [seedsVon] [seedsBis]
//
// WARUM DIESE DATEI EXISTIERT: `SPIKE_DET` in `bilanz-n.mjs` setzt den Zustand
// EINMAL vor der Schleife — alle 40 Seeds teilen einen Zufallsstrom, Seed n
// haengt also von allem ab, was die Seeds davor gezogen haben. Ein einzelner
// verlustbehafteter Fall laesst sich damit nicht herausschneiden. Hier wird der
// Strom VOR JEDEM Seed neu gesetzt (auf `detSeed ^ seed`), damit ein Seed allein
// dieselbe Zahl gibt wie in einem Scan ueber alle Seeds.
//
// FOLGE, ausdruecklich: Die Zahlen hier sind NICHT mit denen aus `bilanz-n.mjs`
// vergleichbar — dort teilt sich alles einen Strom, hier nicht. Das ist ein
// Diagnosewerkzeug, kein Messwerkzeug. Fuer Raten weiter ueber `bilanz-n.mjs`.
import { createRequire } from 'node:module';
import { buildScenario, Transport, rng, score } from './harness.mjs';
// BEFUND 2026-08-09: Hier stand `import * as S from './schnitte.mjs'` — statisch.
// `SPIKE_SCHNITTE` wurde also STILL IGNORIERT, und jeder „Vorher"-Lauf ueber
// dieses Werkzeug (auch die davon abhaengigen `verlustort.mjs`/`zerlege.mjs`) hat
// in Wahrheit den AKTUELLEN Treiber gefahren. Dieselbe Klasse Blindheit wie die
// sechs bereits aktenkundigen Instrumente.
const S = await import(process.env.SPIKE_SCHNITTE ?? './schnitte.mjs');

const require = createRequire(import.meta.url);
const det = require('./det-quelle.cjs');
const webcrypto = require('lib0/webcrypto');
det.zufallQuelleAn();
globalThis.crypto.getRandomValues = (arr) => webcrypto.getRandomValues(arr);

const NAME = process.argv[2] ?? 'S0real';
const N = Number(process.argv[3] ?? 3);
const ARG = process.argv[4] ?? '1';
const DET = Number(process.argv[5] ?? 42);
const VON = Number(process.argv[6] ?? 1);
const BIS = Number(process.argv[7] ?? 40);

const mk = { S0real: S.makeS0real, S1real: S.makeS1real }[NAME];

export async function laufe(seed, detSeed, { spur = null } = {}) {
  det.setzeZufallSeed((detSeed ^ (seed * 0x9e3779b1)) | 0);
  const sc = buildScenario({ seed, nNotes: 10, devices: N, editsPerDevice: 1, imprintWindow: 120 });
  const r = rng(seed ^ 0x5bf03635);
  const tr = new Transport({ settle: 10, delay: 20, jitter: 10, r, mdModus: 'kopie' });
  const devs = mk(tr, sc);
  if (spur) spur.attach({ sc, tr, devs });
  for (const d of devs) {
    for (const n of sc.notes) {
      d.seedFile(n.path, n.baseline);
      tr.letzterSyncStand.set(`${d.id}\0${n.path}`, n.baseline);
    }
  }
  let ei = 0;
  for (let t = 0; t < 1200; t++) {
    if (spur) spur.t = t;
    while (ei < sc.events.length && sc.events[ei].at <= t) {
      const e = sc.events[ei++];
      if (spur) spur.ereignis(`t=${t} EDIT dev${e.dev} ${e.note} token=${e.token} pos=${e.pos.toFixed(3)}`);
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
  const rr = score(sc, devs);
  const fehlend = [];
  for (const n of sc.notes) {
    const da = new Set(devs[0].currentText(n.path).split('\n'));
    for (const z of n.baseline.trim().split('\n')) if (!da.has(z)) fehlend.push(`${n.path}:${z}`);
  }
  return { sc, tr, devs, rr, fehlend };
}

if (ARG === 'scan') {
  let gesamt = 0;
  for (let seed = VON; seed <= BIS; seed++) {
    const { rr, fehlend } = await laufe(seed, DET);
    gesamt += fehlend.length;
    if (fehlend.length) console.log(`seed=${seed} GRUNDTEXT-WEG=${fehlend.length} verlust=${rr.verlust} div=${rr.divergent}  ${fehlend.join(' ')}`);
  }
  console.log(`— DET=${DET} N=${N} Seeds ${VON}..${BIS}: GRUNDTEXT-WEG gesamt = ${gesamt}`);
} else {
  const seed = Number(ARG);
  const { rr, fehlend, devs, sc } = await laufe(seed, DET);
  console.log(`DET=${DET} N=${N} seed=${seed}: GRUNDTEXT-WEG=${fehlend.length} verlust=${rr.verlust} verdopp=${rr.verdopplung} div=${rr.divergent}`);
  for (const f of fehlend) console.log(`  FEHLT ${f}`);
  console.log(`clientIds: ${devs.map((d) => d.id).join(' ')}`);
  if (fehlend.length) {
    const note = fehlend[0].split(':')[0];
    console.log(`\n--- ${note} Endtext Geraet 0 ---\n${devs[0].currentText(note)}`);
    for (let i = 1; i < devs.length; i++) {
      console.log(`--- Geraet ${i} gleich? ${devs[i].currentText(note) === devs[0].currentText(note) ? 'ja' : 'NEIN'}`);
    }
    console.log(`--- Basis ---\n${sc.notes.find((n) => n.path === note).baseline}`);
    console.log('--- Ereignisse dieser Notiz ---');
    for (const e of sc.events) if (e.note === note) console.log(`  at=${e.at} dev${e.dev} ${e.token} pos=${e.pos.toFixed(3)}`);
  }
}
