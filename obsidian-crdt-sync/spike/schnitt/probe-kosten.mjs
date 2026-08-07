// Wie teuer wird der Zustands-DAG mit der Geraetezahl? Ein Seed, gleiche Notizzahl.
import { buildScenario, run, score } from './harness.mjs';
import * as S from './schnitte.mjs';
for (const n of [2, 3, 4]) {
  const t0 = Date.now();
  const sc = buildScenario({ seed: 1, nNotes: 10, devices: n, editsPerDevice: 1, imprintWindow: 120 });
  const { devices } = await run({ scenario: sc, makeDevices: (t,x)=>S.makeS3log(t,x,{rollTicks:60}), seed: 1, settle: 10, mdModus: 'kopie' });
  const r = score(sc, devices);
  const knoten = devices.map(d=>d.stats().knoten).join('/');
  console.log(`N=${n}: ${Date.now()-t0} ms  Knoten=${knoten}  Verlust=${r.verlust} Verdopp=${r.verdopplung} diverg=${r.divergent}`);
}
