import { buildScenario, run, score } from './harness.mjs';
import * as S from './schnitte.mjs';
for (const n of [2, 3, 4]) {
  let v=0,d=0,div=0,s=0,unv=0,nd=0; const t0=Date.now();
  for (let seed=1; seed<=15; seed++) {
    const sc = buildScenario({ seed, nNotes: 10, devices: n, editsPerDevice: 1, imprintWindow: 120 });
    const { devices } = await run({ scenario: sc, makeDevices: (t,x)=>S.makeS3log(t,x,{rollTicks:60}), seed, settle: 10, mdModus: 'kopie' });
    const r = score(sc, devices);
    v+=r.verlust; d+=r.verdopplung; div+=r.divergent; nd+=r.notesMitVerdopplung;
    if (r.verlust===0&&r.verdopplung===0&&r.divergent===0) s++;
    for (const dev of devices) unv += dev.stats?.().unverwandt ?? 0;
  }
  console.log(`S3log N=${n}: unverwandt=${unv} Verlust=${v} Verdopp=${d} N-Verd=${nd} diverg=${div} sauber=${s}/15  (${Date.now()-t0} ms)`);
}
