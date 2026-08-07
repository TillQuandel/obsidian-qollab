// Woran waechst der Text bei N >= 3? Ein davongelaufener Lauf wird angehalten,
// sobald die Knotenkappe faellt, und der laengste Notiztext wird zerlegt:
// welche Zeilen stehen wie oft da, und sind die Geraete untereinander einig?
//
//   node mechanik.mjs <N> <seed> <knotenKappe>
import { buildScenario, Transport, rng } from './harness.mjs';
import * as S from './schnitte.mjs';

const N = Number(process.argv[2] ?? 3);
const SEED = Number(process.argv[3] ?? 1);
const KAPPE = Number(process.argv[4] ?? 300);

const sc = buildScenario({ seed: SEED, nNotes: 10, devices: N, editsPerDevice: 1, imprintWindow: 120 });
const r = rng(SEED ^ 0x5bf03635);
const tr = new Transport({ settle: 10, delay: 20, jitter: 10, r, mdModus: 'kopie' });
const devs = S.makeS3log(tr, sc, { rollTicks: 60 });
for (const d of devs) {
  for (const n of sc.notes) {
    d.seedFile(n.path, n.baseline);
    tr.letzterSyncStand.set(`${d.id}\0${n.path}`, n.baseline);
  }
}
let ei = 0, t = 0;
for (t = 0; t < 1200; t++) {
  while (ei < sc.events.length && sc.events[ei].at <= t) {
    const e = sc.events[ei++];
    await devs[e.dev].userEdit(e.note, e.token, e.pos);
  }
  for (const d of devs) await d.onTick(t);
  tr.step(devs);
  if (t % 30 === 0) {
    for (const d of devs) await d.poll();
    if (Math.max(...devs.map((d) => d.stats().knoten)) > KAPPE) break;
  }
}
const laengste = sc.notes.map((n) => [n, devs[0].currentText(n.path)]).sort((a, b) => b[1].length - a[1].length)[0];
const [note, text] = laengste;
const zeilen = text.split('\n').filter((l) => l.length);
const zaehl = new Map();
for (const l of zeilen) zaehl.set(l, (zaehl.get(l) ?? 0) + 1);
const texte = devs.map((d) => d.currentText(note.path));

console.log(`Abbruch bei t=${t}, Knoten=${devs.map((d) => d.stats().knoten).join('/')}`);
console.log(`Laengste Notiz: ${note.path}  Grundtext ${note.baseline.length} Zeichen / ${note.baseline.trim().split('\n').length} Zeilen`);
console.log(`Jetzt: ${text.length} Zeichen / ${zeilen.length} Zeilen, davon ${zaehl.size} verschiedene`);
console.log(`Geraetetexte untereinander verschieden: ${new Set(texte).size > 1 ? 'JA' : 'nein'} (Laengen ${texte.map((x) => x.length).join('/')})`);
console.log('\nHaeufigste Zeilen:');
for (const [l, c] of [...zaehl].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
  console.log(`  ${String(c).padStart(4)}x  ${l}`);
}
const erwartet = new Set(note.baseline.trim().split('\n'));
for (const e of sc.events) if (e.note === note.path) erwartet.add(e.token);
console.log(`\nErwartet waeren ${erwartet.size} verschiedene Zeilen, je genau einmal.`);
console.log(`Fehlend: ${[...erwartet].filter((x) => !zaehl.has(x)).length}, mehrfach: ${[...erwartet].filter((x) => (zaehl.get(x) ?? 0) > 1).length}`);
