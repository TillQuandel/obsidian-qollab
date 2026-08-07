// Bilanz je Geraetezahl — mit Knotenkappe, damit auch die davongelaufenen
// Laeufe terminieren, und mit GETRENNTER Ausweisung beider Klassen.
//
//   node bilanz-n.mjs <schnitt> <N> <seeds> <knotenKappe>
//
// Der Treiber bildet `harness.run()` Schritt fuer Schritt nach (gleiche
// Tickzahl, gleiches Pollintervall, gleicher Nachlauf) und ergaenzt nur den
// Abbruch bei ueberschrittener Knotenzahl. Ohne ihn terminieren die
// davongelaufenen Seeds nicht — genau daran ist der Batch-Lauf 2026-08-03
// gescheitert.
//
// Zahlen werden NICHT ueber beide Klassen gemittelt: „konvergent" und
// „gekappt" stehen getrennt, weil ein gekappter Lauf mitten im Wachstum
// bewertet wird und seine Verdopplungszahl damit eine Untergrenze ist.
import { buildScenario, Transport, rng, score } from './harness.mjs';
import * as S from './schnitte.mjs';

const NAME = process.argv[2] ?? 'S3log';
const N = Number(process.argv[3] ?? 3);
const SEEDS = Number(process.argv[4] ?? 40);
const KAPPE = Number(process.argv[5] ?? 800);
const ROLL = Number(process.argv[6] ?? 60);
const mk = {
  S0real: S.makeS0real,
  S1real: S.makeS1real,
  S3log: (t, x) => S.makeS3log(t, x, { rollTicks: ROLL }),
}[NAME];

const klasse = { konv: leer(), kapp: leer() };
function leer() {
  return { n: 0, verlust: 0, grund: 0, verdopp: 0, div: 0, sauber: 0, unverw: 0, erst: 0, bytes: 0, transfers: 0, dateien: 0, len: 0 };
}

for (let seed = 1; seed <= SEEDS; seed++) {
  const sc = buildScenario({ seed, nNotes: 10, devices: N, editsPerDevice: 1, imprintWindow: 120 });
  const r = rng(seed ^ 0x5bf03635);
  const tr = new Transport({ settle: 10, delay: 20, jitter: 10, r, mdModus: 'kopie' });
  const devs = mk(tr, sc);
  for (const d of devs) {
    for (const n of sc.notes) {
      d.seedFile(n.path, n.baseline);
      tr.letzterSyncStand.set(`${d.id}\0${n.path}`, n.baseline);
    }
  }
  const knoten = () => Math.max(...devs.map((d) => d.stats().knoten ?? 0));
  let ei = 0, gekappt = false;
  for (let t = 0; t < 1200; t++) {
    while (ei < sc.events.length && sc.events[ei].at <= t) {
      const e = sc.events[ei++];
      await devs[e.dev].userEdit(e.note, e.token, e.pos);
    }
    for (const d of devs) await d.onTick(t);
    tr.step(devs);
    if (t % 30 === 0) {
      for (const d of devs) await d.poll();
      if (knoten() > KAPPE) { gekappt = true; break; }
    }
    if (ei >= sc.events.length && tr.quiet()) {
      // gleicher Abbruch wie harness.run(): Ruhe ueber 2 Pollintervalle
      let ruhe = 0;
      for (; ruhe < 61 && tr.quiet(); ruhe++) tr.step(devs);
      if (ruhe >= 61) break;
    }
  }
  if (!gekappt) {
    for (let i = 0; i < 6 && !gekappt; i++) {
      for (const d of devs) await d.onTick(tr.tick, true);
      for (let k = 0; k < 35; k++) tr.step(devs);
      for (const d of devs) await d.poll();
      if (knoten() > KAPPE) gekappt = true;
    }
  }
  const rr = score(sc, devs);
  // Strenger Grundtext-Verlust: eine Zeile des Ausgangstextes fehlt am Ende.
  // Diese Zeilen hat niemand angefasst — sie zu verlieren ist das K.o.-Kriterium.
  let grundWeg = 0;
  for (const n of sc.notes) {
    const da = new Set(devs[0].currentText(n.path).split('\n'));
    for (const z of n.baseline.trim().split('\n')) if (!da.has(z)) grundWeg++;
  }
  const k = gekappt ? klasse.kapp : klasse.konv;
  k.n++;
  k.verlust += rr.verlust; k.grund += grundWeg; k.verdopp += rr.verdopplung; k.div += rr.divergent;
  if (rr.verlust === 0 && rr.verdopplung === 0 && rr.divergent === 0) k.sauber++;
  k.unverw += devs.reduce((a, d) => a + (d.stats().unverwandt ?? 0), 0);
  k.erst += devs.reduce((a, d) => a + (d.stats().erstkontakt ?? 0), 0);
  k.bytes += tr.bytesTransferred; k.transfers += tr.transfers;
  k.dateien += devs.reduce((a, d) => a + (d.stats().dateien ?? 0), 0);
  k.len += Math.max(...sc.notes.map((n) => devs[0].currentText(n.path).length));
}

const zeile = (t, k) =>
  `${NAME} N=${N} ${t.padEnd(10)} Seeds=${String(k.n).padStart(2)}/${SEEDS}` +
  (k.n === 0 ? '' :
    `  Verlust=${String(k.verlust).padStart(4)} GRUNDTEXT-WEG=${String(k.grund).padStart(4)} Verdopp=${String(k.verdopp).padStart(5)}` +
    ` diverg=${String(k.div).padStart(3)} sauber=${k.sauber}/${k.n} unverw=${String(k.unverw).padStart(3)} erstk=${String(k.erst).padStart(4)}` +
    `  | Uebertragungen=${String(Math.round(k.transfers / k.n)).padStart(5)} kB=${String(Math.round(k.bytes / k.n / 1024)).padStart(5)}` +
    ` Dateien=${String(Math.round(k.dateien / k.n)).padStart(4)} maxLen=${String(Math.round(k.len / k.n)).padStart(5)} (je Seed)`);
console.log(zeile('konvergent', klasse.konv));
console.log(zeile('gekappt', klasse.kapp));
