// Die DRITTE Untervariante zaehlen: die nicht-idempotente Ersetzung.
//
//   SPIKE_BUNDLE=./real-neu.cjs node mehrfach.mjs <N> <detSeed> [von] [bis] [modus]
//
// modus: 'zeichen' (Standard, = Produktivcode) | 'zeile' (HEBEL A: der Diff in
//        `setContent` wird an Zeilengrenzen ausgerichtet) | 'tor' (HEBEL B:
//        `istEigen` zusaetzlich an den Doc-Stand gebunden) | 'zeile+tor' (beide).
//        Die Hebel selbst liegen in `hebel.mjs`.
//
// GEMESSEN WIRD, je Lauf und ueber alle Notizen:
//   torKollision  ein per Transport GELIEFERTES .md passiert das Herkunftstor als
//                 „eigen" (Inhaltsgleichheit mit dem eigenen letzten Stand) und
//                 loest dabei eine Doc-Aenderung aus
//   ersetzung     ein setContent aus `applyLocalContent`, dessen Op-Folge sowohl
//                 DELETE als auch INSERT enthaelt (also eine Ersetzung ist)
//   kreuzend      davon: eine DELETE-Op enthaelt ein '\n' UND verschluckt dabei
//                 eine GRUNDTEXT-Zeile, die im Ergebnis wieder dasteht — die
//                 Zeile wird also geloescht und zeichengleich neu eingefuegt
//   mehrfach      Zahl der (Notiz, vorher, nachher)-Tripel, die von >= 2
//                 VERSCHIEDENEN Geraeten gerechnet werden (nicht-idempotent!)
//   mehrfachKreuz davon die kreuzenden — die vermutete Schadensbedingung
//   WEG           Zeilen des Ausgangstextes, die bei Geraet 0 am Ende fehlen
//
// Die Instrumentierung sitzt auf `SyncHandler.prototype` bzw. dem Geraeteobjekt
// des Spikes. `src/` bleibt unangetastet.
import { createRequire } from 'node:module';
import { buildScenario, Transport, rng, score } from './harness.mjs';
const S = await import(process.env.SPIKE_SCHNITTE ?? './schnitte.mjs');

const require = createRequire(import.meta.url);
const det = require('./det-quelle.cjs');
const webcrypto = require('lib0/webcrypto');
det.zufallQuelleAn();
globalThis.crypto.getRandomValues = (arr) => webcrypto.getRandomValues(arr);
const R = require(process.env.SPIKE_BUNDLE ?? './real.cjs');
const DMP = new (require('diff-match-patch').diff_match_patch)();
const H = await import('./hebel.mjs');
// Die patch_apply-Sonde. Ohne SPIKE_PATCH zaehlt sie nur mit und aendert nichts
// — belegt durch den Kalibrierungslauf gegen `ergebnis-achsen-2026-08-10.txt`.
// Die apparat-eigene DMP-Instanz oben bleibt unberuehrt: sie ruft `diff_main`,
// nie `match_main` oder `patch_apply`.
const PS = await import('./patchsonde.mjs');
PS.sondeInstalliere(process.env.SPIKE_PATCH ?? 'bestand');

const N = Number(process.argv[2] ?? 4);
const DET = Number(process.argv[3] ?? 42);
const VON = Number(process.argv[4] ?? 1);
const BIS = Number(process.argv[5] ?? 40);
const MODUS = process.argv[6] ?? 'zeichen';
// --- Szenario-Achsen, ab 2026-08-10 parametrierbar --------------------------
// Bisher standen `nNotes`, `baseLines`, `editsPerDevice` und `mdModus` fest im
// Treiber. Die Standardwerte sind WORTGLEICH die bisherigen — ein Lauf ohne
// gesetzte Variablen misst also unveraendert die Lage aus `ergebnis-einbau-
// 2026-08-10.txt`. Belegt durch Nachmessung derselben Zellen (siehe
// `ergebnis-achsen-2026-08-10.txt`, Block „KALIBRIERUNG").
const NOTES = Number(process.env.SPIKE_NOTES ?? 10);
const BASELINES = Number(process.env.SPIKE_BASELINES ?? 8);
const EDITS = Number(process.env.SPIKE_EDITS ?? 1);
const MDMODUS = process.env.SPIKE_MDMODUS ?? 'kopie';
const NL = String.fromCharCode(10);
const SEP = String.fromCharCode(0);

// --- Die Hebel --------------------------------------------------------------
// Wortgleich zum bisherigen Inline-Block, nur ausgelagert: `zeile` ist Hebel A.
// `tor` ist Hebel B und wird VOR der Tor-Probe unten installiert, damit
// `torProbe`/`davonEigen` das WIRKSAME Tor zaehlen und nicht das darunter.
const HEBEL = new Set(MODUS.split('+'));
if (HEBEL.has('zeile')) H.installiereA(R, DMP);
if (HEBEL.has('tor')) H.installiereB(R);

// --- Zaehlwerk --------------------------------------------------------------
let z;
function frisch() {
  z = {
    zustellungen: 0, torKollision: 0, torProbe: 0, torProbeEigen: 0,
    setC: 0, ersetzung: 0, kreuzend: 0,
    tripel: new Map(), // key -> Set(clientId)
    kreuzKey: new Set(),
  };
}

// Laeuft gerade eine Zustellung aus dem Transport? (clientId -> bool)
const ausSofort = new Map();
// notePath -> Menge der Grundtextzeilen dieses Laufs.
const BASIS = new Map();

// DIE TOR-PROBE. `istEigen` (write-provenance.ts:141) wird im Spike-Treiber
// ausschliesslich aus `verarbeiteLokal` gerufen. Laeuft gerade das Abarbeiten
// ZUGESTELLTER Dateien (`_sofort`-Drain in `onTick`), dann ist der gepruefte Text
// per Konstruktion ein FREMDER — sagt das Tor dort „eigen", ist das eine
// Inhaltskollision und keine echte Eigenherkunft.
if (R.WriteProvenance) {
  const WP = R.WriteProvenance.prototype;
  const origIst = WP.istEigen;
  WP.istEigen = function (pfad, text) {
    const e = origIst.call(this, pfad, text);
    if (z && drainAktiv) { z.torProbe++; if (e) z.torProbeEigen++; }
    return e;
  };
}
let drainAktiv = false;

const P = R.SyncHandler.prototype;
const origMerge = P.mergeForLocalDiff;
P.mergeForLocalDiff = async function (notePath, content, imSweep) {
  const erg = await origMerge.call(this, notePath, content, imSweep);
  if (typeof erg === 'string' && this.crdtManager.hasDoc(notePath)) {
    // Der Doc-Stand UNMITTELBAR vor `setContent` (sync-handler.ts:1703).
    const vor = this.crdtManager.getContent(notePath);
    if (vor !== erg) {
      z.setC++;
      const d = DMP.diff_main(vor, erg);
      DMP.diff_cleanupSemantic(d);
      const hatDel = d.some(([o]) => o === -1);
      const hatIns = d.some(([o]) => o === 1);
      const key = `${notePath}${SEP}${vor}${SEP}${erg}`;
      if (hatDel && hatIns) {
        z.ersetzung++;
        const nachZ = new Set(erg.split(NL));
        const basis = BASIS.get(notePath) ?? new Set();
        // Grundtextzeilen, die vorher UND nachher dastehen — sie duerfen von
        // keiner DELETE-Op angefasst werden.
        const ueberlebt = [...new Set(vor.split(NL))].filter(
          (l) => l.length > 0 && nachZ.has(l) && basis.has(l)
        );
        const kreuzt = d.some(
          ([o, t]) => o === -1 && t.includes(NL) && ueberlebt.some((l) => t.includes(l))
        );
        if (kreuzt) { z.kreuzend++; z.kreuzKey.add(key); }
      }
      if (!z.tripel.has(key)) z.tripel.set(key, new Set());
      z.tripel.get(key).add(this.clientId);
      if (ausSofort.get(this.clientId)) z.torKollision++;
    }
  }
  return erg;
};

// --- Lauf -------------------------------------------------------------------
async function laufe(seed, detSeed) {
  frisch();
  det.setzeZufallSeed((detSeed ^ (seed * 0x9e3779b1)) | 0);
  const sc = buildScenario({ seed, nNotes: NOTES, baseLines: BASELINES, devices: N, editsPerDevice: EDITS, imprintWindow: 120 });
  const r = rng(seed ^ 0x5bf03635);
  const tr = new Transport({ settle: 10, delay: 20, jitter: 10, r, mdModus: MDMODUS });
  BASIS.clear();
  for (const n of sc.notes) BASIS.set(n.path, new Set(n.baseline.trim().split(NL)));
  const devs = S.makeS0real(tr, sc);
  for (const d of devs) {
    const origTick = d.onTick.bind(d);
    d.onTick = async (t, f) => {
      if (d._sofort.length > 0) { ausSofort.set(d.id, true); drainAktiv = true; z.zustellungen += d._sofort.length; }
      const rr = await origTick(t, f);
      ausSofort.set(d.id, false); drainAktiv = false;
      return rr;
    };
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
  const rr = score(sc, devs);
  // Gegenprobe zum Tor-Hebel: parkt er am Ende alles weg? `parkOffen` > 0 hiesse,
  // ein Stand hat den Lauf nie erreicht; `torFremd` ist die Zahl der Parkvorgaenge.
  let parkOffen = 0, torFremd = 0, torEigen = 0;
  let yjsBytes = 0, yjsDateien = 0, yjsItems = 0;
  for (const d of devs) {
    const s = d.stats();
    parkOffen += s.parkOffen;
    torFremd += s.pfad.torFremd;
    torEigen += s.pfad.torEigen;
    yjsBytes += s.yjs?.bytes ?? 0;
    yjsDateien += s.yjs?.dateien ?? 0;
    yjsItems += s.yjs?.items ?? 0;
  }
  const fehlend = [];
  for (const n of sc.notes) {
    const da = new Set(devs[0].currentText(n.path).split(NL));
    for (const zl of n.baseline.trim().split(NL)) if (!da.has(zl)) fehlend.push(`${n.path}:${zl}`);
  }
  let mehrfach = 0, mehrfachKreuz = 0;
  for (const [key, set] of z.tripel) {
    if (set.size < 2) continue;
    mehrfach++;
    if (!z.kreuzKey.has(key)) continue;
    mehrfachKreuz++;
    if (process.env.ZEIGE_KEY) {
      const [p, vorT, nachT] = key.split(SEP);
      console.log(`  [key] seed=${seed} ${p} geraete=${set.size}`);
      console.log(`    vor  = ${JSON.stringify(vorT).split('\\n').join('|')}`);
      console.log(`    nach = ${JSON.stringify(nachT).split('\\n').join('|')}`);
    }
  }
  return { fehlend, rr, mehrfach, mehrfachKreuz, z, parkOffen, torFremd, torEigen, yjsBytes, yjsDateien, yjsItems };
}

let gWeg = 0, gMehr = 0, gMehrK = 0, gKreuz = 0, gErs = 0, gKoll = 0, gZu = 0;
let gVerlust = 0, gVerdopp = 0, gDiv = 0, gTP = 0, gTPE = 0;
let gPark = 0, gFremd = 0, gEigen = 0;
let gYB = 0, gYD = 0, gYI = 0;
const t0 = Date.now();
for (let seed = VON; seed <= BIS; seed++) {
  const o = await laufe(seed, DET);
  gWeg += o.fehlend.length; gMehr += o.mehrfach; gMehrK += o.mehrfachKreuz;
  gKreuz += o.z.kreuzend; gErs += o.z.ersetzung; gKoll += o.z.torKollision; gZu += o.z.zustellungen;
  gVerlust += o.rr.verlust; gVerdopp += o.rr.verdopplung; gDiv += o.rr.divergent;
  gTP += o.z.torProbe; gTPE += o.z.torProbeEigen;
  gPark += o.parkOffen; gFremd += o.torFremd; gEigen += o.torEigen;
  gYB += o.yjsBytes; gYD += o.yjsDateien; gYI += o.yjsItems;
  if (o.z.kreuzend && process.env.ZEIGE_KREUZ)
    console.log(`  [kreuz] seed=${seed} kreuzend=${o.z.kreuzend} mehrfachKreuz=${o.mehrfachKreuz} WEG=${o.fehlend.length}`);
  if (o.fehlend.length || o.mehrfachKreuz)
    console.log(
      `seed=${seed} WEG=${o.fehlend.length} mehrfachKreuz=${o.mehrfachKreuz} mehrfach=${o.mehrfach}` +
      ` kreuzend=${o.z.kreuzend} ersetzung=${o.z.ersetzung} torKoll=${o.z.torKollision}` +
      (o.fehlend.length ? `  ${o.fehlend.join(' ')}` : '')
    );
}
console.log(
  `== N=${N} DET=${DET} Seeds ${VON}..${BIS} modus=${MODUS}` +
  ` [notizen=${NOTES} basis=${BASELINES} edits=${EDITS} md=${MDMODUS} diff=${process.env.QOLLAB_DIFF_MODUS ?? 'STANDARD'} patch=${process.env.SPIKE_PATCH ?? 'bestand'} s=${((Date.now() - t0) / 1000).toFixed(1)}]` +
  `: WEG=${gWeg} mehrfachKreuz=${gMehrK}` +
  ` mehrfach=${gMehr} kreuzend=${gKreuz} ersetzung=${gErs} torKollision=${gKoll} zustellungen=${gZu}` +
  ` | verlust=${gVerlust} verdopp=${gVerdopp} div=${gDiv} | torProbe=${gTP} davonEigen=${gTPE} parkOffen=${gPark} torFremd=${gFremd} torEigen=${gEigen}` +
  ` | yjsKB=${(gYB / 1024).toFixed(1)} yjsDateien=${gYD} yjsItems=${gYI}` +
  ` | ${PS.sondeZeile()}` +
  (HEBEL.has('tor')
    ? ` | hebelB ${Object.entries(H.bZaehler).map(([k, v]) => `${k}=${v}`).join(' ')}`
    : '')
);
