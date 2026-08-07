// Ein einzelner Lauf von probe-n mit Fortschrittsausgabe — um zu sehen, OB
// N=3 haengt oder nur langsam ist.  node probe-n1.mjs <N> <seed> <maxTicks>
import { buildScenario, Transport, rng, score } from './harness.mjs';
import * as S from './schnitte.mjs';
const N = Number(process.argv[2] ?? 3);
const SEED = Number(process.argv[3] ?? 1);
const MAX = Number(process.argv[4] ?? 1200);
const sc = buildScenario({ seed: SEED, nNotes: 10, devices: N, editsPerDevice: 1, imprintWindow: 120 });
const r = rng(SEED ^ 0x5bf03635);
const tr = new Transport({ settle: 10, delay: 20, jitter: 10, r, mdModus: 'kopie' });
const devs = S.makeS3log(tr, sc, { rollTicks: 60 });
for (const d of devs) for (const n of sc.notes) { d.seedFile(n.path, n.baseline); tr.letzterSyncStand.set(`${d.id}\0${n.path}`, n.baseline); }
let ei = 0, t0 = Date.now();
for (let t = 0; t < MAX; t++) {
  while (ei < sc.events.length && sc.events[ei].at <= t) { const e = sc.events[ei++]; await devs[e.dev].userEdit(e.note, e.token, e.pos); }
  for (const d of devs) await d.onTick(t);
  tr.step(devs);
  if (t % 30 === 0) {
    for (const d of devs) await d.poll();
    const st = devs.map((d) => d.stats());
    const laengen = sc.notes.map((n) => devs[0].currentText(n.path).length);
    console.log(`t=${t} ${Date.now() - t0}ms Knoten=${st.map(x=>x.knoten).join('/')} unverw=${st.map(x=>x.unverwandt).join('/')} maxLen=${Math.max(...laengen)} pending=${tr.pending.size} inFlight=${tr.inFlight.length} offen=${sc.events.length - ei}`);
  }
}
const rr = score(sc, devs);
console.log(`ENDE nach ${Date.now() - t0} ms: Verlust=${rr.verlust} Verdopp=${rr.verdopplung} diverg=${rr.divergent}`);
