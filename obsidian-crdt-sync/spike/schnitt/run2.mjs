// Zusatzmessungen im reinen CRDT-Pfad (.md-Kanal = Konfliktkopie):
//   A) Roll-Intervall der Segmente gegen den Erstkontakt-Schaden
//   B) Das dritte und vierte Replikat
import { buildScenario, run, score } from './harness.mjs';
import * as S from './schnitte.mjs';

const SEEDS = Number(process.argv[2] ?? 20);
const NNOTES = Number(process.argv[3] ?? 10);
const teil = process.argv[4] ?? 'ab';
const fmt = (n, w) => String(n).padStart(w);

async function messe(mk, { seeds = SEEDS, nNotes = NNOTES, devices = 2 } = {}) {
  let verlust = 0, verdopplung = 0, nv = 0, nd = 0, divergent = 0, sauber = 0;
  let dateien = 0, unverwandt = 0, erst = 0, transfers = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const sc = buildScenario({ seed, nNotes, devices, editsPerDevice: 1, imprintWindow: 120 });
    const { devices: devs, transport } = await run({ scenario: sc, makeDevices: mk, seed, settle: 10, mdModus: 'kopie' });
    const s = score(sc, devs);
    verlust += s.verlust; verdopplung += s.verdopplung;
    nv += s.notesMitVerlust; nd += s.notesMitVerdopplung; divergent += s.divergent;
    if (s.verlust === 0 && s.verdopplung === 0 && s.divergent === 0) sauber++;
    transfers += transport.transfers;
    for (const d of devs) {
      const st = d.stats?.() ?? {};
      dateien += st.dateien ?? 0; unverwandt += st.unverwandt ?? 0; erst += st.erstkontakt ?? 0;
    }
  }
  return { verlust, verdopplung, nv, nd, divergent, sauber, seeds, dateien, unverwandt, erst, transfers };
}

if (teil.includes('a')) {
  console.log(`\nA) Segment-Roll-Intervall gegen Erstkontakt-Schaden — ECHTER CODE, 2 Geraete`);
  console.log(`   ${SEEDS} Seeds x ${NNOTES} Notizen. Ein Tick = eine Sekunde.\n`);
  console.log('   Ablage'.padEnd(38), 'Erstk.'.padStart(7), 'Verlust'.padStart(8), 'Verdopp'.padStart(8),
    'N-Verd'.padStart(7), 'sauber'.padStart(8), 'Dateien'.padStart(8), 'Transf'.padStart(7));
  console.log('   ' + '-'.repeat(38 + 7 * 3 + 8 * 4));
  for (const [name, mk] of [
    ['Sidecar je Notiz (Ist)', (t, s) => S.makeS0real(t, s)],
    ['Segment, Roll  30 s', (t, s) => S.makeS1real(t, s, { rollTicks: 30 })],
    ['Segment, Roll 120 s', (t, s) => S.makeS1real(t, s, { rollTicks: 120 })],
    ['Segment, Roll 900 s (15 min, GH-12)', (t, s) => S.makeS1real(t, s, { rollTicks: 900 })],
    ['Segment, kein Roll', (t, s) => S.makeS1real(t, s, { rollTicks: 1e9 })],
  ]) {
    const r = await messe(mk);
    console.log('  ', name.padEnd(38), fmt(r.erst, 7), fmt(r.verlust, 8), fmt(r.verdopplung, 8),
      fmt(r.nd, 7), fmt(`${r.sauber}/${r.seeds}`, 8), fmt(r.dateien, 8), fmt(r.transfers, 7));
  }
}

if (teil.includes('b')) {
  console.log(`\nB) Das dritte und vierte Replikat`);
  console.log(`   ${SEEDS} Seeds x ${NNOTES} Notizen\n`);
  console.log('   Schnitt'.padEnd(38), 'N'.padStart(3), 'Erstk./unv'.padStart(11), 'Verlust'.padStart(8),
    'Verdopp'.padStart(8), 'diverg'.padStart(7), 'sauber'.padStart(8));
  console.log('   ' + '-'.repeat(38 + 3 + 11 + 8 * 2 + 7 + 8 + 6));
  for (const n of [2, 3, 4]) {
    for (const [name, mk] of [
      ['Sidecar je Notiz (Ist, echt)', (t, s) => S.makeS0real(t, s)],
      ['Segmente je Geraet (echt)', (t, s) => S.makeS1real(t, s)],
      ['Zustands-Log (S3)', (t, s) => S.makeS3log(t, s)],
    ]) {
      const r = await messe(mk, { devices: n });
      console.log('  ', name.padEnd(38), fmt(n, 3), fmt(r.erst + r.unverwandt, 11), fmt(r.verlust, 8),
        fmt(r.verdopplung, 8), fmt(r.divergent, 7), fmt(`${r.sauber}/${r.seeds}`, 8));
    }
    console.log('');
  }
}
console.log('');
