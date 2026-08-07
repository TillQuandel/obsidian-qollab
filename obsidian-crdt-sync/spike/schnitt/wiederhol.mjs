// Streubreite eines Schnitts ueber mehrere identische Laeufe.
//   node wiederhol.mjs <schnitt> <wdh> <seeds> <geraete> <mdModus>
// Noetig, weil `new Y.Doc()` eine ZUFAELLIGE clientID zieht: jeder Schnitt mit
// Yjs streut von Lauf zu Lauf, S3log (ohne Yjs) nicht.
import { buildScenario, run, score } from './harness.mjs';
import * as S from './schnitte.mjs';

const NAME = process.argv[2] ?? 'S0real';
const WDH = Number(process.argv[3] ?? 5);
const SEEDS = Number(process.argv[4] ?? 40);
const GER = Number(process.argv[5] ?? 2);
const MD = process.argv[6] ?? 'kopie';
const mk = { S0real: S.makeS0real, S1real: S.makeS1real, S3log: S.makeS3log }[NAME];

for (let w = 1; w <= WDH; w++) {
  let v = 0, d = 0, div = 0, s = 0, unv = 0, erst = 0, nv = 0, nd = 0;
  const t0 = Date.now();
  for (let seed = 1; seed <= SEEDS; seed++) {
    const sc = buildScenario({ seed, nNotes: 10, devices: GER, editsPerDevice: 1, imprintWindow: 120 });
    const { devices } = await run({ scenario: sc, makeDevices: (t, x) => mk(t, x), seed, settle: 10, mdModus: MD });
    const r = score(sc, devices);
    v += r.verlust; d += r.verdopplung; div += r.divergent; nv += r.notesMitVerlust; nd += r.notesMitVerdopplung;
    if (r.verlust === 0 && r.verdopplung === 0 && r.divergent === 0) s++;
    for (const dev of devices) { const st = dev.stats?.() ?? {}; unv += st.unverwandt ?? 0; erst += st.erstkontakt ?? 0; }
  }
  console.log(`${NAME} N=${GER} ${MD} Lauf ${w}: Erstk=${erst + unv} Verlust=${v} Verdopp=${d} N-Verl=${nv} N-Verd=${nd} diverg=${div} sauber=${s}/${SEEDS}  (${Date.now() - t0} ms)`);
}
