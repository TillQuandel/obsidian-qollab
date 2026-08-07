// Belegt, aus welchem Codestand die veroeffentlichten N=2-Zahlen stammen.
// Faehrt NUR S3log, einmal mit dem Modul aus 83b3806 (Stand, unter dem
// ergebnis-kern.txt entstand) und einmal mit dem aus 28301c2 (Branch-Spitze).
import { buildScenario, run, score } from './harness.mjs';
import * as ALT from './schnitte-alt.mjs';
import * as NEU from './schnitte.mjs';

const SEEDS = Number(process.argv[2] ?? 40);
for (const [name, S] of [['83b3806 (alt)', ALT], ['28301c2 (Spitze)', NEU]]) {
  for (const mdModus of ['kopie', 'ueberschreiben']) {
    let v = 0, d = 0, div = 0, s = 0, unv = 0, nv = 0, nd = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const sc = buildScenario({ seed, nNotes: 10, devices: 2, editsPerDevice: 1, imprintWindow: 120 });
      const { devices } = await run({ scenario: sc, makeDevices: (t, x) => S.makeS3log(t, x), seed, settle: 10, mdModus });
      const r = score(sc, devices);
      v += r.verlust; d += r.verdopplung; div += r.divergent; nv += r.notesMitVerlust; nd += r.notesMitVerdopplung;
      if (r.verlust === 0 && r.verdopplung === 0 && r.divergent === 0) s++;
      for (const dev of devices) unv += dev.stats?.().unverwandt ?? 0;
    }
    console.log(`S3log ${name} ${mdModus.padEnd(15)} unverwandt=${unv} Verlust=${v} Verdopp=${d} N-Verl=${nv} N-Verd=${nd} diverg=${div} sauber=${s}/${SEEDS}`);
  }
}
