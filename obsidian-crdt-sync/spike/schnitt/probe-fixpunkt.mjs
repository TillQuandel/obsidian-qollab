// Waechst der Zustands-DAG bei 3 Geraeten unbegrenzt weiter, obwohl niemand
// mehr tippt? Das waere der Bruch beim dritten Replikat.
import { buildScenario, Transport, rng } from './harness.mjs';
import * as S from './schnitte.mjs';
const N = Number(process.argv[2] ?? 3);
const sc = buildScenario({ seed: 1, nNotes: 2, baseLines: 5, devices: N, editsPerDevice: 1, imprintWindow: 40 });
const r = rng(99);
const tr = new Transport({ settle: 10, delay: 20, jitter: 10, r, mdModus: 'kopie' });
const devs = S.makeS3log(tr, sc);
for (const d of devs) for (const n of sc.notes) { d.seedFile(n.path, n.baseline); tr.letzterSyncStand.set(`${d.id}\0${n.path}`, n.baseline); }
let ei = 0;
for (let t = 0; t < 900; t++) {
  while (ei < sc.events.length && sc.events[ei].at <= t) { const e = sc.events[ei++]; await devs[e.dev].userEdit(e.note, e.token, e.pos); }
  for (const d of devs) await d.onTick(t);
  tr.step(devs);
  if (t % 30 === 0) {
    for (const d of devs) await d.poll();
    if (t >= 120) {
      const knoten = devs.map((d) => d.stats().knoten).join('/');
      const texte = new Set(devs.map((d) => d.currentText('n0.md')));
      console.log(`t=${t}  Knoten je Geraet: ${knoten}  verschiedene Endtexte: ${texte.size}  Ereignisse offen: ${sc.events.length - ei}`);
    }
  }
}
