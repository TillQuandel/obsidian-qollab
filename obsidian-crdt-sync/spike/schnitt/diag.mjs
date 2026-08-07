// Einzellauf zum Nachsehen: EINE Notiz, je ein Edit pro Geraet — der reine
// Erstkontakt. Zeigt Endtexte statt Summen, damit sichtbar ist, ob der Treiber
// dem Produktionscode gerecht wird.
import { buildScenario, run, score, expectedTokens } from './harness.mjs';
import * as S from './schnitte.mjs';

const seed = Number(process.argv[2] ?? 1);
const mdModus = process.argv[3] ?? 'kopie';
const fenster = Number(process.argv[4] ?? 5);
const scenario = buildScenario({ seed, nNotes: 1, baseLines: 5, editsPerDevice: 1, devices: 2, imprintWindow: fenster });
console.log('Ereignisse:', scenario.events.map((e) => `t=${e.at} D${e.dev} +${e.token}`).join('  '));
console.log('Basis:', JSON.stringify(scenario.notes[0].baseline));

for (const [name, mk] of [
  ['S0real', (t, s) => S.makeS0real(t, s)],
  ['S1real', (t, s) => S.makeS1real(t, s)],
  ['S0mod', (t, s) => S.makeS0mod(t, s)],
  ['S2frei', (t, s) => S.makeS2vault(t, s, { variante: 'frei' })],
  ['S3log', (t, s) => S.makeS3log(t, s)],
]) {
  const { devices, transport } = await run({ scenario, makeDevices: mk, seed, settle: 10, mdModus });
  const s = score(scenario, devices);
  console.log(`\n--- ${name}  Verlust=${s.verlust} Verdopplung=${s.verdopplung} divergent=${s.divergent} Konfliktkopien=${transport.konfliktkopien}`);
  for (const d of devices) console.log(`  ${d.id}: ${JSON.stringify(d.currentText('n0.md'))}`);
}
console.log('\nErwartet:', [...expectedTokens(scenario).get('n0.md')].join(' | '));
