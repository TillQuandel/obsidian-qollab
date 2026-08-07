// Waechst der Text bei 3 Geraeten unbegrenzt? (Die von der Vorarbeit gemessene
// diff3-Explosion — hier MIT Abstammungshashes.)
import { buildScenario, Transport, rng } from './harness.mjs';
import * as S from './schnitte.mjs';
const N = Number(process.argv[2] ?? 3);
const sc = buildScenario({ seed: 1, nNotes: 10, devices: N, editsPerDevice: 1, imprintWindow: 120 });
const r = rng(7);
const tr = new Transport({ settle: 10, delay: 20, jitter: 10, r, mdModus: 'kopie' });
const devs = S.makeS3log(tr, sc, { rollTicks: 60 });
for (const d of devs) for (const n of sc.notes) { d.seedFile(n.path, n.baseline); tr.letzterSyncStand.set(`${d.id}\0${n.path}`, n.baseline); }
let ei = 0;
for (let t = 0; t < 400; t++) {
  while (ei < sc.events.length && sc.events[ei].at <= t) { const e = sc.events[ei++]; await devs[e.dev].userEdit(e.note, e.token, e.pos); }
  for (const d of devs) await d.onTick(t);
  tr.step(devs);
  if (t % 30 === 0) {
    const t0 = Date.now();
    for (const d of devs) await d.poll();
    const laengen = sc.notes.map((n) => devs[0].currentText(n.path).length);
    console.log(`t=${t} pollzeit=${Date.now()-t0}ms  max Textlaenge=${Math.max(...laengen)}  Summe=${laengen.reduce((a,b)=>a+b,0)}  Knoten=${devs[0].stats().knoten}`);
  }
}
