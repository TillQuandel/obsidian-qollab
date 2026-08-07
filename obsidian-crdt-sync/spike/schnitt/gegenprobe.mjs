// GEGENPROBE zum Zaehler `unverwandt`.
//
// Der Befund „0 unverwandte Ketten" ist nur etwas wert, wenn der Zaehler
// ueberhaupt feuern KANN. Deshalb dieselbe Messung ein zweites Mal mit einer
// EINZIGEN geaenderten Zeile (`schnitte-mut.mjs`): der Genesis-Knoten wird auf
// dem Text NACH der eigenen Eingabe gebildet statt auf dem zuletzt sauber
// gesehenen Dateistand. Damit ist die Inhaltsadressierung ausgehebelt — zwei
// Geraete kommen auf verschiedene Wurzeln, und der Zaehler MUSS anschlagen.
//
//   node gegenprobe.mjs <seeds> <N>
import { buildScenario, run, score } from './harness.mjs';
import * as ECHT from './schnitte.mjs';
import * as MUT from './schnitte-mut.mjs';

const SEEDS = Number(process.argv[2] ?? 40);
const N = Number(process.argv[3] ?? 2);

for (const [name, S] of [['Kandidat  (inhaltsadressierter Genesis)', ECHT], ['Mutation  (Genesis nach der Eingabe)  ', MUT]]) {
  let unv = 0, v = 0, d = 0, div = 0, s = 0, seedsMitUnv = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const sc = buildScenario({ seed, nNotes: 10, devices: N, editsPerDevice: 1, imprintWindow: 120 });
    const { devices } = await run({ scenario: sc, makeDevices: (t, x) => S.makeS3log(t, x), seed, settle: 10, mdModus: 'kopie' });
    const r = score(sc, devices);
    v += r.verlust; d += r.verdopplung; div += r.divergent;
    if (r.verlust === 0 && r.verdopplung === 0 && r.divergent === 0) s++;
    const u = devices.reduce((a, dev) => a + (dev.stats?.().unverwandt ?? 0), 0);
    unv += u;
    if (u > 0) seedsMitUnv++;
  }
  console.log(`${name} N=${N}: unverwandt=${unv} (in ${seedsMitUnv}/${SEEDS} Seeds) Verlust=${v} Verdopp=${d} diverg=${div} sauber=${s}/${SEEDS}`);
}
