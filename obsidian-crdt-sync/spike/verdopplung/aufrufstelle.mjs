// WARUM: `herkunft.mjs` hat gezeigt, dass die Verdopplung zu ~99 % in
// `CrdtManager.applyUpdate` sichtbar wird — dort ist aber kein Hebel, weil der
// Text zu diesem Zeitpunkt schon doppelt ist. Der Hebel muss VOR der
// Materialisierung greifen. Diese Messung schluesselt deshalb auf, WELCHE
// Aufrufstelle von `setContent` den Text materialisiert, der drueben zum
// Duplikat wird.
//
// DIE AUFRUFSTELLEN, im Produktivcode nachgezaehlt (`grep -rn 'setContent(' src/`,
// ausser der Definition selbst) — es sind genau drei:
//   sync-handler.ts:1307  Adopt-Zweig in `ensureDoc` (:1142)
//   sync-handler.ts:1454  `switchToGuid` (:1375), Kennungswechsel
//   sync-handler.ts:1703  `applyLocalContent` (:1688)
// Im Apparat kommt keine vierte hinzu: `makeS0real` (schnitte.mjs:143-416) fuehrt
// den ECHTEN SyncHandler; die apparat-eigenen `setContent`-Rufe in
// `schnitte.mjs:480-547` gehoeren zu `makeModelDevices` (:430) und laufen hier
// nicht mit. Belegt durch die Zaehlung unten: die Summe der drei Stellen deckt
// alle `setContent`-Rufe (`ohneRahmen` muss 0 sein).
//
// DIE MESSGROESSE — nicht „wie oft wird gerufen", sondern wie viel SCHAEDLICHER
// Text materialisiert wird:
//
//   neu          Zeilen, die dieser Aufruf dem eigenen Doc HINZUFUEGT
//                (Vielfachheit gegen den Doc-Stand davor). Nur sie bekommen
//                frische Yjs-Item-IDs.
//   schaedlich   davon die Zeilen, die auf MINDESTENS EINEM ANDEREN Geraet zu
//                diesem Zeitpunkt bereits im Doc stehen. Genau diese Einfuegung
//                kann der spaetere Merge nicht mehr zusammenfuehren (Yjs
//                dedupliziert nach Item-ID, nicht nach Inhalt) — sie IST das
//                kuenftige Duplikat.
//   selbst       davon die Zeilen, die schon im EIGENEN Doc stehen (Doppelung
//                ohne Zutun eines zweiten Geraets).
//
// Die Groesse zaehlt jedes Duplikat genau EINMAL — beim ZWEITEN Geraet, das
// denselben Inhalt materialisiert; beim ersten steht drueben ja noch nichts.
// Deshalb ist sie mit der Endzahl vergleichbar und nicht nur ein Ranking.
//
// Instrumentiert wird ausschliesslich auf den Prototypen des geladenen Bundles;
// `src/` bleibt unberuehrt.
//
//   (SPIKE_BUNDLE ist relativ zu spike/schnitt/ gemeint)
//   SPIKE_BUNDLE=./real-neu.cjs SPIKE_BASELINES=8 SPIKE_MDMODUS=kopie \
//     node --max-old-space-size=8192 aufrufstelle.mjs <N> <detSeed> [von] [bis]
import { createRequire } from 'node:module';
import { buildScenario, Transport, rng, score } from '../schnitt/harness.mjs';

const require = createRequire(import.meta.url);
const det = require('../schnitt/det-quelle.cjs');
const webcrypto = require('lib0/webcrypto');
det.zufallQuelleAn();
globalThis.crypto.getRandomValues = (arr) => webcrypto.getRandomValues(arr);
const reqS = createRequire(new URL('../schnitt/anker.mjs', import.meta.url));
const R = reqS(process.env.SPIKE_BUNDLE ?? './real-neu.cjs');
const S = await import('../schnitt/schnitte.mjs');
const PS = await import('../schnitt/patchsonde.mjs');
PS.sondeInstalliere(process.env.SPIKE_PATCH ?? 'dreiwege');

const N = Number(process.argv[2] ?? 4);
const DET = Number(process.argv[3] ?? 42);
const VON = Number(process.argv[4] ?? 1);
const BIS = Number(process.argv[5] ?? 200);
const NOTES = Number(process.env.SPIKE_NOTES ?? 10);
const BASELINES = Number(process.env.SPIKE_BASELINES ?? 8);
const EDITS = Number(process.env.SPIKE_EDITS ?? 1);
const MDMODUS = process.env.SPIKE_MDMODUS ?? 'kopie';
const UNTERDRUECKE = process.env.UNTERDRUECKE ?? 'nichts';
const NL = String.fromCharCode(10);

function zaehle(text) {
  const m = new Map();
  for (const z of text.split(NL)) {
    if (z.length === 0) continue;
    m.set(z, (m.get(z) ?? 0) + 1);
  }
  return m;
}

// --- Rahmenverfolgung -------------------------------------------------------
// Je Handler ein eigener Stapel: der INNERSTE gewrappte Rahmen ist die
// Aufrufstelle, der AEUSSERSTE der Einstieg des Apparats. Pro Handler, weil im
// Treiber mehrere Geraete ueber `await` verschraenkt laufen koennen — ein
// globaler Stapel wuerde Rahmen fremder Geraete mitzaehlen.
const stapelVon = new WeakMap(); // handler -> string[]
const managerZuHandler = new Map(); // CrdtManager -> handler
let alleManager = [];

// Aufrufstellen (enthalten je ein `setContent`) und Einstiege (Apparat ->
// Handler). Beide werden gewrappt; die Trennung macht erst die Kreuztabelle
// „Einstieg > Stelle" moeglich.
const STELLEN = ['ensureDoc', 'switchToGuid', 'applyLocalContent'];
const EINSTIEGE = ['loadAndMerge', 'tickParked', 'parkForeign', 'mergeForLocalDiff', 'mergePendingForeign', 'unite'];

const SH = R.SyncHandler.prototype;
for (const name of [...STELLEN, ...EINSTIEGE]) {
  const orig = SH[name];
  if (typeof orig !== 'function') {
    console.log(`# WARNUNG: ${name} ist keine Methode des Bundles — nicht gewrappt`);
    continue;
  }
  SH[name] = function (...a) {
    let st = stapelVon.get(this);
    if (!st) {
      st = [];
      stapelVon.set(this, st);
    }
    if (!managerZuHandler.has(this.crdtManager)) {
      managerZuHandler.set(this.crdtManager, this);
      alleManager.push(this.crdtManager);
    }
    st.push(name);
    const raus = () => {
      const i = st.lastIndexOf(name);
      if (i >= 0) st.splice(i, 1);
    };
    let erg;
    try {
      erg = orig.apply(this, a);
    } catch (e) {
      raus();
      throw e;
    }
    if (erg && typeof erg.then === 'function') return erg.then((v) => (raus(), v), (e) => { raus(); throw e; });
    raus();
    return erg;
  };
}

let z;
const frisch = () => {
  z = { stelle: new Map(), kreuz: new Map(), ohneRahmen: 0, applyPlus: 0, wegRuf: 0, wegZeilen: 0 };
};
const buche = (map, key, feld, wert) => {
  let e = map.get(key);
  if (!e) {
    e = { ruf: 0, neu: 0, schaedlich: 0, schaedlichTok: 0, selbst: 0 };
    map.set(key, e);
  }
  e[feld] += wert;
};
const FELDER = ['ruf', 'neu', 'schaedlich', 'schaedlichTok', 'selbst'];

// Grundtextzeilen je Notiz. WARUM die Trennung: Die Stellen-Messung der
// Vorrunde hat gezeigt, dass am Ende AUSSCHLIESSLICH Bearbeitungs-Tokens doppelt
// stehen, nie eine Grundtextzeile (0 von 358). Grundtext materialisiert jede Tuer
// staendig mit — er kollidiert rechnerisch, wird aber vom Tie-Break fast immer
// wieder eingesammelt. `schaedlichTok` zaehlt deshalb nur die Zeilen, die in der
// beobachteten Schadensklasse ueberhaupt vorkommen.
const BASIS = new Map();

const CP = R.CrdtManager.prototype;
const origSet = CP.setContent;
CP.setContent = function (pfad, content) {
  const vor = this.hasDoc(pfad) ? this.getContent(pfad) : '';
  if (vor === content) return origSet.call(this, pfad, content);

  const h = managerZuHandler.get(this);
  const st = h ? stapelVon.get(h) : undefined;
  // Der innerste Rahmen, der eine Aufrufstelle IST.
  let stelle = null;
  if (st) for (let i = st.length - 1; i >= 0; i--) if (STELLEN.includes(st[i])) { stelle = st[i]; break; }
  const einstieg = st && st.length > 0 ? st[0] : '(kein Rahmen)';
  if (stelle === null) z.ohneRahmen++;
  const key = stelle ?? '(unbekannt)';
  const kkey = `${einstieg} > ${key}`;

  const cVor = zaehle(vor);
  const cNeu = zaehle(content);
  const cAndere = [];
  for (const m of alleManager) {
    if (m === this) continue;
    if (!m.hasDoc(pfad)) continue;
    cAndere.push(zaehle(m.getContent(pfad)));
  }
  const basis = BASIS.get(pfad);
  let neu = 0, schaedlich = 0, schaedlichTok = 0, selbst = 0;
  for (const [zeile, n] of cNeu) {
    const hatte = cVor.get(zeile) ?? 0;
    const plus = n - hatte;
    if (plus <= 0) continue;
    neu += plus;
    let drueben = 0;
    for (const c of cAndere) drueben = Math.max(drueben, c.get(zeile) ?? 0);
    if (drueben > 0) {
      const s = Math.min(plus, drueben);
      schaedlich += s;
      if (!basis || !basis.has(zeile)) schaedlichTok += s;
    }
    if (hatte > 0) selbst += plus;
  }
  for (const [m, k] of [[z.stelle, key], [z.kreuz, kkey]]) {
    buche(m, k, 'ruf', 1);
    buche(m, k, 'neu', neu);
    buche(m, k, 'schaedlich', schaedlich);
    buche(m, k, 'schaedlichTok', schaedlichTok);
    buche(m, k, 'selbst', selbst);
  }

  // GEGENPROBE (UNTERDRUECKE=<stelle>|alle): genau die als `schaedlich`
  // gezaehlten Zeilen werden dieser Aufrufstelle weggenommen, bevor sie
  // materialisiert. Das ist KEIN Fix-Vorschlag — es ist ein ORAKEL-Arm: er
  // benutzt Wissen ueber den Stand der anderen Geraete, das ein echtes Geraet
  // nicht hat. Sein Zweck ist allein, den Indikator zu eichen: faellt die
  // Endzahl `verdopp` um so viel, wie der Indikator dieser Tuer zuschreibt,
  // misst er das Richtige; faellt sie kaum, ueberschaetzt er sie.
  if (schaedlich > 0 && (UNTERDRUECKE === 'alle' || UNTERDRUECKE === key)) {
    const rest = new Map();
    for (const c of cAndere) for (const [zeile, n] of c) rest.set(zeile, Math.max(rest.get(zeile) ?? 0, n));
    const lauf = new Map();
    const raus = [];
    for (const roh of content.split(NL)) {
      if (roh.length > 0) {
        const nBisher = (lauf.get(roh) ?? 0) + 1;
        lauf.set(roh, nBisher);
        const hatte = cVor.get(roh) ?? 0;
        // Nur die UEBERZAEHLIGEN Vorkommen streichen, die drueben schon stehen.
        if (nBisher > hatte && (rest.get(roh) ?? 0) > 0) continue;
      }
      raus.push(roh);
    }
    z.wegRuf++;
    z.wegZeilen += content.split(NL).length - raus.length;
    return origSet.call(this, pfad, raus.join(NL));
  }
  return origSet.call(this, pfad, content);
};

// Kontrollgroesse aus dem Vorlauf: die Verdopplung, die `applyUpdate` einbringt.
function mehrfach(text) {
  const m = zaehle(text);
  let s = 0;
  for (const n of m.values()) if (n > 1) s += n - 1;
  return s;
}
const origUpd = CP.applyUpdate;
CP.applyUpdate = function (pfad, update) {
  const dVor = this.hasDoc(pfad) ? mehrfach(this.getContent(pfad)) : 0;
  const erg = origUpd.call(this, pfad, update);
  const dNach = mehrfach(this.getContent(pfad));
  if (dNach > dVor) z.applyPlus += dNach - dVor;
  return erg;
};

async function laufe(seed) {
  frisch();
  managerZuHandler.clear();
  alleManager = [];
  det.setzeZufallSeed((DET ^ (seed * 0x9e3779b1)) | 0);
  const sc = buildScenario({ seed, nNotes: NOTES, baseLines: BASELINES, devices: N, editsPerDevice: EDITS, imprintWindow: 120 });
  BASIS.clear();
  for (const n of sc.notes) BASIS.set(n.path, new Set(n.baseline.trim().split(NL)));
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
  return { rr: score(sc, devs), z };
}

const gStelle = new Map();
const gKreuz = new Map();
let gVerdopp = 0, gVerlust = 0, gOhne = 0, gApply = 0, gWegRuf = 0, gWegZeilen = 0;
const t0 = Date.now();
for (let seed = VON; seed <= BIS; seed++) {
  const o = await laufe(seed);
  gVerdopp += o.rr.verdopplung;
  gVerlust += o.rr.verlust;
  gOhne += o.z.ohneRahmen;
  gApply += o.z.applyPlus;
  gWegRuf += o.z.wegRuf;
  gWegZeilen += o.z.wegZeilen;
  for (const [m, g] of [[o.z.stelle, gStelle], [o.z.kreuz, gKreuz]]) {
    for (const [k, e] of m) for (const f of FELDER) buche(g, k, f, e[f]);
  }
}

const kopf =
  `== aufrufstelle N=${N} DET=${DET} Seeds ${VON}..${BIS}` +
  ` [notizen=${NOTES} basis=${BASELINES} edits=${EDITS} md=${MDMODUS}` +
  ` diff=${process.env.QOLLAB_DIFF_MODUS ?? 'STANDARD'} patch=${process.env.SPIKE_PATCH ?? 'dreiwege'}` +
  ` s=${((Date.now() - t0) / 1000).toFixed(1)} unterdrueckt=${UNTERDRUECKE}]` +
  `: verdopp=${gVerdopp} verlust=${gVerlust} applyPlus=${gApply} ohneRahmen=${gOhne}` +
  ` wegRuf=${gWegRuf} wegZeilen=${gWegZeilen}`;
console.log(kopf);
const zeile = (k, e) =>
  `   ${k.padEnd(42)} ruf=${String(e.ruf).padStart(7)} neu=${String(e.neu).padStart(7)}` +
  ` schaedlich=${String(e.schaedlich).padStart(6)} davonToken=${String(e.schaedlichTok).padStart(5)}` +
  ` selbst=${String(e.selbst).padStart(5)}`;
console.log('  -- nach Aufrufstelle (innerster Rahmen) --');
for (const [k, e] of [...gStelle].sort((a, b) => b[1].schaedlich - a[1].schaedlich)) console.log(zeile(k, e));
console.log('  -- nach Einstieg > Aufrufstelle --');
for (const [k, e] of [...gKreuz].sort((a, b) => b[1].schaedlich - a[1].schaedlich)) console.log(zeile(k, e));
