// Erreicht ein Schnitt einen Fixpunkt, nachdem der letzte Nutzer-Edit vorbei ist?
//
//   node wachstum.mjs <schnitt> <N> <seeds> <nNotes> <maxTicks> <knotenKappe> <budgetMs>
//
// Nach dem Praegefenster (120 Ticks) tippt niemand mehr. Jede weitere Aenderung
// am Text ist damit vom Merge erzeugt.
//
// Abbruch DETERMINISTISCH ueber die Knotenzahl, nicht ueber die Uhr: der Lauf
// bricht ab, sobald ein Geraet mehr als <knotenKappe> Zustandsknoten fuehrt.
// Konvergente Laeufe liegen bei 32-65 Knoten, davongelaufene bei mehreren
// tausend — die Kappe trennt beide Klassen mit grossem Abstand und ist auf jeder
// Maschine gleich. Der Uhr-Budget ist nur ein Notausgang fuer die Schnitte ohne
// Knotenzaehler (S0real/S1real).
//
// Ausgaben:
//   letzteAend  letzter Tick, an dem sich irgendein Geraetetext aenderte
//   Fixpunkt    seit >= 300 Ticks unveraendert UND alle Ereignisse durch
//   Len120/End  laengster Notiztext bei t=120 bzw. am Ende (Grundtext: 80)
import { buildScenario, Transport, rng } from './harness.mjs';
import * as S from './schnitte.mjs';

const NAME = process.argv[2] ?? 'S3log';
const N = Number(process.argv[3] ?? 3);
const SEEDS = Number(process.argv[4] ?? 40);
const NN = Number(process.argv[5] ?? 10);
const MAX = Number(process.argv[6] ?? 1200);
const KAPPE = Number(process.argv[7] ?? 800);
const BUDGET = Number(process.argv[8] ?? 20000);
const ROLL = Number(process.argv[9] ?? 60);
const mk = {
  S0real: S.makeS0real,
  S1real: S.makeS1real,
  S3log: (t, x) => S.makeS3log(t, x, { rollTicks: ROLL }),
}[NAME];

let fix = 0, kappe = 0, budget = 0, offen = 0;
const laengen = [];
for (let seed = 1; seed <= SEEDS; seed++) {
  const sc = buildScenario({ seed, nNotes: NN, devices: N, editsPerDevice: 1, imprintWindow: 120 });
  const r = rng(seed ^ 0x5bf03635);
  const tr = new Transport({ settle: 10, delay: 20, jitter: 10, r, mdModus: 'kopie' });
  const devs = mk(tr, sc);
  for (const d of devs) {
    for (const n of sc.notes) {
      d.seedFile(n.path, n.baseline);
      tr.letzterSyncStand.set(`${d.id}\0${n.path}`, n.baseline);
    }
  }
  const schnapp = () => devs.map((d) => sc.notes.map((n) => d.currentText(n.path)).join(' ')).join('');
  const maxLen = () => Math.max(...sc.notes.map((n) => devs[0].currentText(n.path).length));
  const knoten = () => Math.max(...devs.map((d) => d.stats().knoten ?? 0));
  let ei = 0, letzte = 0, vorher = schnapp(), len120 = 0, t = 0, grund = '';
  const t0 = Date.now();
  for (t = 0; t < MAX; t++) {
    while (ei < sc.events.length && sc.events[ei].at <= t) {
      const e = sc.events[ei++];
      await devs[e.dev].userEdit(e.note, e.token, e.pos);
    }
    for (const d of devs) await d.onTick(t);
    tr.step(devs);
    if (t % 30 === 0) {
      for (const d of devs) await d.poll();
      const jetzt = schnapp();
      if (jetzt !== vorher) { letzte = t; vorher = jetzt; }
      if (t === 120) len120 = maxLen();
      if (knoten() > KAPPE) { grund = 'KNOTENKAPPE'; break; }
      if (Date.now() - t0 > BUDGET) { grund = 'UHRBUDGET  '; break; }
    }
  }
  const stabil = !grund && ei >= sc.events.length && t - letzte >= 300;
  if (stabil) fix++;
  else if (grund === 'KNOTENKAPPE') kappe++;
  else if (grund === 'UHRBUDGET  ') budget++;
  else offen++;
  laengen.push(maxLen());
  const unverw = devs.reduce((a, d) => a + (d.stats().unverwandt ?? 0), 0);
  console.log(
    `${NAME} N=${N} seed ${String(seed).padStart(2)}: ` +
    `t=${String(t).padStart(4)} ${grund || 'durchgelaufen'} ` +
    `letzteAend=t${String(letzte).padStart(4)} Fixpunkt=${stabil ? 'JA ' : 'NEIN'} ` +
    `Len120=${String(len120).padStart(4)} LenEnd=${String(maxLen()).padStart(6)} ` +
    `Knoten=${String(knoten()).padStart(5)} unverw=${unverw} (${Date.now() - t0} ms)`
  );
}
laengen.sort((a, b) => a - b);
console.log(
  `ERGEBNIS ${NAME} N=${N} Notizen=${NN} Seeds=${SEEDS}: ` +
  `Fixpunkt ${fix}/${SEEDS}, Knotenkappe ${kappe}/${SEEDS}, Uhrbudget ${budget}/${SEEDS}, ` +
  `ohne Fixpunkt durchgelaufen ${offen}/${SEEDS} | LenEnd Median ${laengen[Math.floor(SEEDS / 2)]}, Max ${laengen[SEEDS - 1]}`
);
