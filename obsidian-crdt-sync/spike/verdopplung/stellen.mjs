// WARUM: Die Endzustands-Metrik (`spike/schnitt/harness.mjs:176 score`) zaehlt
// nur, WIE OFT eine erwartete Zeile mehrfach dasteht — nicht WO. Fuer die
// Nutzerwirkung ist das der entscheidende Unterschied: eine Zeile, die
// unmittelbar unter ihrem Original steht, liest sich als Doppelung an Ort und
// Stelle; ein wiederholter Block am Textende liest sich als zweite Kopie der
// halben Notiz. `docs/produktziel.md` warnt ausdruecklich, dass die vorhandene
// Zahl beides vermengt.
//
// Der Lauf ist der aus `spike/schnitt/mehrfach.mjs` (gleiche Zellbasis, gleiche
// Seeds, gleicher Transport) — nur die Auswertung ist eine andere: statt einer
// Summe je Lauf werden die ZEILENINDIZES jedes Mehrfachvorkommens erhoben.
//
//   SPIKE_BUNDLE=../verdopplung/real-zaehl.cjs node stellen.mjs <N> <detSeed> [von] [bis]
//   (aus spike/schnitt/ heraus aufrufen; ZEIGE=<n> druckt n Endstaende woertlich)
//
// GEMESSEN, je Mehrfachvorkommen einer erwarteten Zeile:
//   abstand      Zeilenabstand zwischen dem Vorkommen und dem vorherigen
//   imSchwanz    liegt das zusaetzliche Vorkommen im maximalen Suffixblock,
//                dessen Zeilen ALLE auch vorher schon dastehen? (= „angehaengt")
//   relPos       Position des zusaetzlichen Vorkommens, 0 = Anfang, 1 = Ende
import { createRequire } from 'node:module';
import { buildScenario, Transport, rng, expectedTokens } from '../schnitt/harness.mjs';

const S = await import('../schnitt/schnitte.mjs');
const require = createRequire(import.meta.url);
const det = require('../schnitt/det-quelle.cjs');
const webcrypto = require('lib0/webcrypto');
det.zufallQuelleAn();
globalThis.crypto.getRandomValues = (arr) => webcrypto.getRandomValues(arr);
const PS = await import('../schnitt/patchsonde.mjs');
PS.sondeInstalliere(process.env.SPIKE_PATCH ?? 'dreiwege');

const N = Number(process.argv[2] ?? 4);
const DET = Number(process.argv[3] ?? 42);
const VON = Number(process.argv[4] ?? 1);
const BIS = Number(process.argv[5] ?? 20);
const NOTES = Number(process.env.SPIKE_NOTES ?? 10);
const BASELINES = Number(process.env.SPIKE_BASELINES ?? 8);
const EDITS = Number(process.env.SPIKE_EDITS ?? 1);
const MDMODUS = process.env.SPIKE_MDMODUS ?? 'kopie';
const ZEIGE = Number(process.env.ZEIGE ?? 0);
const NL = String.fromCharCode(10);

// Der maximale Suffixblock, dessen Zeilen alle schon vorher im Text stehen.
// Er ist die operationale Fassung von „als Block angehaengt".
function schwanzAb(zeilen) {
  const vorher = new Map();
  for (let i = 0; i < zeilen.length; i++) vorher.set(zeilen[i], (vorher.get(zeilen[i]) ?? 0) + 1);
  let i = zeilen.length;
  const gesehen = new Map();
  while (i > 0) {
    const z = zeilen[i - 1];
    if (z.length === 0) { i--; continue; }
    const benutzt = (gesehen.get(z) ?? 0) + 1;
    // Steht die Zeile VOR dem Schwanz noch mindestens einmal?
    if ((vorher.get(z) ?? 0) - benutzt < 1) break;
    gesehen.set(z, benutzt);
    i--;
  }
  return i; // Index, ab dem der wiederholte Schwanz beginnt
}

async function laufe(seed) {
  det.setzeZufallSeed((DET ^ (seed * 0x9e3779b1)) | 0);
  const sc = buildScenario({ seed, nNotes: NOTES, baseLines: BASELINES, devices: N, editsPerDevice: EDITS, imprintWindow: 120 });
  const r = rng(seed ^ 0x5bf03635);
  const tr = new Transport({ settle: 10, delay: 20, jitter: 10, r, mdModus: MDMODUS });
  const devs = S.makeS0real(tr, sc);
  for (const d of devs) {
    for (const n of sc.notes) {
      d.seedFile(n.path, n.baseline);
      tr.letzterSyncStand.set(`${d.id}\0${n.path}`, n.baseline);
    }
  }
  let ei = 0;
  for (let t = 0; t < 1200; t++) {
    while (ei < sc.events.length && sc.events[ei].at <= t) {
      const e = sc.events[ei++];
      await devs[e.dev].userEdit(e.note, e.token, e.pos);
    }
    for (const d of devs) await d.onTick(t);
    tr.step(devs);
    if (t % 30 === 0) for (const d of devs) await d.poll();
    if (ei >= sc.events.length && tr.quiet()) {
      let ruhe = 0;
      for (; ruhe < 61 && tr.quiet(); ruhe++) tr.step(devs);
      if (ruhe >= 61) break;
    }
  }
  for (let i = 0; i < 6; i++) {
    for (const d of devs) await d.onTick(tr.tick, true);
    for (let k = 0; k < 35; k++) tr.step(devs);
    for (const d of devs) await d.poll();
  }

  const exp = expectedTokens(sc);
  const faelle = [];
  for (const n of sc.notes) {
    const text = devs[0].currentText(n.path);
    const zeilen = text.split(NL);
    const stellen = new Map();
    zeilen.forEach((z, i) => {
      if (z.length === 0) return;
      if (!stellen.has(z)) stellen.set(z, []);
      stellen.get(z).push(i);
    });
    const ab = schwanzAb(zeilen);
    for (const tok of exp.get(n.path)) {
      const idx = stellen.get(tok);
      if (!idx || idx.length < 2) continue;
      for (let k = 1; k < idx.length; k++) {
        faelle.push({
          seed,
          note: n.path,
          token: tok,
          erst: idx[0],
          zweit: idx[k],
          abstand: idx[k] - idx[k - 1],
          imSchwanz: idx[k] >= ab,
          relPos: zeilen.length > 1 ? idx[k] / (zeilen.length - 1) : 0,
          laenge: zeilen.length,
          grund: tok.includes('-base-') && !tok.includes('|'),
        });
      }
    }
    if (ZEIGE > 0 && zeilen.some((z, i) => z.length > 0 && stellen.get(z).length > 1)) {
      if (gezeigt < ZEIGE) {
        gezeigt++;
        console.log(`--- seed=${seed} ${n.path} zeilen=${zeilen.length} schwanzAb=${ab} ---`);
        zeilen.forEach((z, i) => {
          const mehr = z.length > 0 && stellen.get(z).length > 1;
          console.log(`  ${String(i).padStart(3)}${mehr ? ' *' : '  '} ${z}`);
        });
      }
    }
  }
  return faelle;
}

let gezeigt = 0;
const alle = [];
const t0 = Date.now();
for (let seed = VON; seed <= BIS; seed++) alle.push(...(await laufe(seed)));

const hist = new Map();
for (const f of alle) {
  const k = f.abstand === 1 ? '1' : f.abstand <= 3 ? '2-3' : f.abstand <= 10 ? '4-10' : '>10';
  hist.set(k, (hist.get(k) ?? 0) + 1);
}
const imSchwanz = alle.filter((f) => f.imSchwanz).length;
const grund = alle.filter((f) => f.grund).length;
const relSpaet = alle.filter((f) => f.relPos > 0.9).length;
console.log(
  `== stellen N=${N} DET=${DET} Seeds ${VON}..${BIS}` +
    ` [notizen=${NOTES} basis=${BASELINES} edits=${EDITS} md=${MDMODUS}` +
    ` diff=${process.env.QOLLAB_DIFF_MODUS ?? 'STANDARD'} s=${((Date.now() - t0) / 1000).toFixed(1)}]` +
    `: dup=${alle.length} davonGrundtext=${grund} imSchwanz=${imSchwanz}` +
    ` relPos>0.9=${relSpaet}` +
    ` | abstand ${[...hist].map(([k, v]) => `${k}:${v}`).join(' ')}`
);
