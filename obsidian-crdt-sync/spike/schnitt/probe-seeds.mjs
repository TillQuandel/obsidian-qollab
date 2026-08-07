import { buildScenario, run, score } from './harness.mjs';
import * as S from './schnitte.mjs';
for (let seed = 1; seed <= 6; seed++) {
  const t0 = Date.now();
  const sc = buildScenario({ seed, nNotes: 10, devices: 3, editsPerDevice: 1, imprintWindow: 120 });
  const { devices } = await run({ scenario: sc, makeDevices: (t,x)=>S.makeS3log(t,x,{rollTicks:60}), seed, settle: 10, mdModus: 'kopie' });
  const r = score(sc, devices);
  console.log(`seed ${seed}: ${Date.now()-t0} ms  Knoten=${devices[0].stats().knoten}  Verlust=${r.verlust} Verdopp=${r.verdopplung} diverg=${r.divergent}`);
}
