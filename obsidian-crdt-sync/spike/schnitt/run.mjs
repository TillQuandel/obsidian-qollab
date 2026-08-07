// Kernmessung: derselbe Erstkontakt, verschiedene Schnitte.
//
//   node spike/run.mjs [seeds] [nNotes] [fenster]
//
// Drei Zahlen je Schnitt, strikt getrennt:
//   Erstk.  wie oft ist ueberhaupt eine unverwandte Kette aufgetroffen
//   Verlust wie viele erwartete Zeilen fehlen am Ende
//   Verdopp wie viele Zeilen stehen oefter da als erwartet
import { buildScenario, run, score } from './harness.mjs';
import * as S from './schnitte.mjs';

const SEEDS = Number(process.argv[2] ?? 40);
const NNOTES = Number(process.argv[3] ?? 10);
const FENSTER = Number(process.argv[4] ?? 120);

const schnitte = [
  ['S0real  Sidecar je Notiz je Geraet  [ECHTER CODE]', (t, s) => S.makeS0real(t, s)],
  ['S1real  Segmente je Geraet (GH-12)  [ECHTER CODE]', (t, s) => S.makeS1real(t, s)],
  ['S2frei  Vault-Doc, beide praegen unabhaengig', (t, s) => S.makeS2vault(t, s, { variante: 'frei' })],
  ['S2einr  Vault-Doc + Einrichtung/Verweigerung', (t, s) => S.makeS2vault(t, s, { variante: 'einrichtung' })],
  ['S3log   Zustands-Log, inhaltsadressiert', (t, s) => S.makeS3log(t, s)],
];

const fmt = (n, w = 6) => String(n).padStart(w);

for (const mdModus of ['kopie', 'ueberschreiben']) {
  console.log(`\n=== ${SEEDS} Seeds x ${NNOTES} Notizen, je 1 Edit pro Geraet, Praegefenster ${FENSTER} Ticks`);
  console.log(
    mdModus === 'kopie'
      ? '    .md-Kanal: Konfliktkopie — der Sync fasst eine lokal geaenderte Datei nicht an'
      : '    .md-Kanal: Ueberschreiben — der Sync ueberschreibt die lokale Datei'
  );
  console.log(
    '\n' + 'Schnitt'.padEnd(50),
    'Erstk.'.padStart(7), 'Verlust'.padStart(8), 'Verdopp'.padStart(8),
    'N-Verl'.padStart(7), 'N-Verd'.padStart(7), 'diverg'.padStart(7), 'sauber'.padStart(8)
  );
  console.log('-'.repeat(50 + 7 * 4 + 8 * 3 + 8));
  for (const [name, mk] of schnitte) {
    let verlust = 0, verdopplung = 0, nv = 0, nd = 0, divergent = 0, sauber = 0, erst = 0, unv = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const scenario = buildScenario({
        seed, nNotes: NNOTES, devices: 2, editsPerDevice: 1, imprintWindow: FENSTER,
      });
      const { devices } = await run({ scenario, makeDevices: mk, seed, settle: 10, mdModus });
      const s = score(scenario, devices);
      verlust += s.verlust; verdopplung += s.verdopplung;
      nv += s.notesMitVerlust; nd += s.notesMitVerdopplung; divergent += s.divergent;
      if (s.verlust === 0 && s.verdopplung === 0 && s.divergent === 0) sauber++;
      for (const d of devices) {
        const st = d.stats?.() ?? {};
        erst += st.erstkontakt ?? 0;
        unv += st.unverwandt ?? 0;
      }
    }
    console.log(
      name.padEnd(50), fmt(erst + unv, 7), fmt(verlust, 8), fmt(verdopplung, 8),
      fmt(nv, 7), fmt(nd, 7), fmt(divergent, 7), fmt(`${sauber}/${SEEDS}`, 8)
    );
  }
  console.log(`\nVerlust/Verdopplung in ZEILEN ueber ${SEEDS * NNOTES} Notizen; N-Verl/N-Verd = Notizen mit`);
  console.log('mindestens einem Vorfall; diverg = Notizen mit verschiedenem Endtext auf den Geraeten.');
}
console.log('');
