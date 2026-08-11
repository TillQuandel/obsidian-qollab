// WIE OFT wird bei `switchToGuid` ein lokaler Beitrag OHNE eigene Kopie
// materialisiert?
//
// DIE STELLE (`src/sync-handler.ts:1443-1454`):
//   const winnerText = this.crdtManager.getContent(notePath);
//   if (winnerText === localText) return;
//   this.crdtManager.setContent(notePath, this.unite(notePath, winnerText, localText));
// `unite` ruft `unionMerge(other, local)` (`src/text-merge.ts:362`), das ueber
// einen ZEILEN-Diff arbeitet. Steht eine gemeinsame Zeile auf beiden Seiten an
// derselben Stelle, traegt die Vereinigung sie EINMAL — `setContent` sieht sie
// dann als unveraendert und erzeugt KEIN eigenes Item. Der lokale Beitrag haengt
// danach an einem fremden Item des Gewinners.
//
// GEMESSEN WIRD AM ITEM, nicht am Text (`besitz.mjs`): nach `setContent` traegt
// der Doc Gewinner-Ops (fremde clientIDs) und die frischen Ops dieses Geraets
// (die clientID des Docs). Gegenprobe, dass das Instrument den Unterschied
// ueberhaupt sieht: `probe-instrument.mjs`.
//
// KALIBRIERUNG gegen eine veroeffentlichte Zahl: `ruf` und `neu` fuer
// `switchToGuid` muessen `spike/verdopplung/ergebnis-aufrufstelle*.txt`
// reproduzieren (Z0: ruf=2183 neu=3178), ebenso `verdopp`/`verlust` der Zelle.
// `neu` ist dort die MENGEN-Vorhersage max(0, n_ziel - n_doc) je Zeile; sie
// steht hier neben der am Item gemessenen Zahl eigener Vorkommen. Weichen
// beide ab, ist die Mengenrechnung ein schlechter Stellvertreter — genau das
// ist mitzumessen.
//
//   (SPIKE_BUNDLE ist relativ zu spike/schnitt/ gemeint)
//   SPIKE_DET=42 SPIKE_BASELINES=8 SPIKE_MDMODUS=kopie \
//     node --max-old-space-size=8192 spike/aliasierung/lauf.mjs <N> <det> [von] [bis]
import { createRequire } from 'node:module';
import { buildScenario, Transport, rng, score } from '../schnitt/harness.mjs';
import { zeilenBesitz, zaehleZeilen, clientsImDoc, zeilenArt } from './besitz.mjs';

const require = createRequire(import.meta.url);
const det = require('../schnitt/det-quelle.cjs');
const webcrypto = require('lib0/webcrypto');
det.zufallQuelleAn();
globalThis.crypto.getRandomValues = (arr) => webcrypto.getRandomValues(arr);
// Dasselbe Modulobjekt, das `schnitte.mjs` benutzt — sonst wuerden hier fremde
// Prototypen instrumentiert und die Wrapper liefen nie. `schnitte.mjs` loest
// `SPIKE_BUNDLE` relativ zu `spike/schnitt/` auf; der Anker hier tut dasselbe.
// Ohne gesetzte Variable faellt `schnitte.mjs` auf `./real.cjs` (Stand vor dem
// 05.08.) zurueck — deshalb wird sie hier gesetzt, nicht nur gelesen.
process.env.SPIKE_BUNDLE ??= '../aliasierung/real-alias.cjs';
const reqS = createRequire(new URL('../schnitt/anker.mjs', import.meta.url));
const R = reqS(process.env.SPIKE_BUNDLE);
const S = await import('../schnitt/schnitte.mjs');

const N = Number(process.argv[2] ?? 4);
const DET = Number(process.env.SPIKE_DET ?? process.argv[3] ?? 42);
const VON = Number(process.argv[4] ?? 1);
const BIS = Number(process.argv[5] ?? 200);
const NOTES = Number(process.env.SPIKE_NOTES ?? 10);
const BASELINES = Number(process.env.SPIKE_BASELINES ?? 8);
const EDITS = Number(process.env.SPIKE_EDITS ?? 1);
const MDMODUS = process.env.SPIKE_MDMODUS ?? 'kopie';
const ZELLE = process.env.SPIKE_ZELLE ?? '?';
let dumpRest = Number(process.env.SPIKE_DUMP ?? 0);

// --- Rahmenverfolgung, wortgleich uebernommen aus `spike/verdopplung/
// aufrufstelle.mjs:82-125`: je Handler ein eigener Stapel, weil im Treiber
// mehrere Geraete ueber `await` verschraenkt laufen. Der INNERSTE gewrappte
// Rahmen ist die Aufrufstelle.
const stapelVon = new WeakMap();
const managerZuHandler = new Map();
const STELLEN = ['ensureDoc', 'switchToGuid', 'applyLocalContent'];
const SH = R.SyncHandler.prototype;
for (const name of [...STELLEN, 'unite']) {
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
    if (!managerZuHandler.has(this.crdtManager)) managerZuHandler.set(this.crdtManager, this);
    st.push(name);
    const raus = () => {
      const i = st.lastIndexOf(name);
      if (i >= 0) st.splice(i, 1);
    };
    // `unite` ist synchron und liefert die Vereinigung: hier werden die drei
    // Texte des Aufrufs festgehalten, damit `setContent` gleich weiss, was der
    // LOKALE Anteil war. Ohne das kennt es nur Doc-Stand und Ergebnis.
    let erg;
    try {
      erg = orig.apply(this, a);
    } catch (e) {
      raus();
      throw e;
    }
    if (name === 'unite' && innerste(st) === 'switchToGuid') {
      letzteVereinigung.set(this, { pfad: a[0], other: a[1], local: a[2], merged: erg });
    }
    if (erg && typeof erg.then === 'function') return erg.then((v) => (raus(), v), (e) => { raus(); throw e; });
    raus();
    return erg;
  };
}
const letzteVereinigung = new WeakMap();
function innerste(st) {
  for (let i = st.length - 1; i >= 0; i--) if (STELLEN.includes(st[i])) return st[i];
  return null;
}

let z;
const frisch = () => {
  z = {
    ruf: 0,           // setContent-Aufrufe unter `switchToGuid`, die etwas aendern
    rufLeer: 0,       // … die nichts aendern (vor === content)
    ohneVereinigung: 0, // … ohne passenden `unite`-Datensatz (muss 0 sein)
    kollision: 0,     // eigene clientID lag schon vor `setContent` im Doc (muss 0 sein)
    rekonAbweichung: 0, // Itemrekonstruktion != Doc-Text (muss 0 sein)
    neuMenge: 0,      // Mengen-Vorhersage max(0, n_ziel - n_doc) — Spalte `neu`
    eigenItems: 0,    // am Item gemessen: Ergebniszeilen ganz aus eigenen Ops
    fremdItems: 0,    // … ganz aus fremden Ops
    gemischtItems: 0, // … aus beidem (Zeichen-Diff hat die Zeile aufgebrochen)
    lokalZeilen: 0,   // materialisierte lokale Zeilenvorkommen insgesamt
    lokalMit: 0,      // davon mit eigener Kopie
    lokalOhne: 0,     // davon OHNE eigene Kopie  <- die gesuchte Zahl
    // Verschaerfung: `ohne` allein unterscheidet nicht, ob das Geraet fuer
    // DIESEN Inhalt ueberhaupt kein eigenes Item hat (`ganz` — der Gewinner
    // haelt alles) oder ob nur eines von mehreren Vorkommen mitreitet und
    // daneben ein eigenes Item steht (`teil` — ein Delete des Gewinners laesst
    // dann eine Kopie stehen).
    lokalOhneGanz: 0,
    lokalOhneTeil: 0,
    ohneNichtImGewinner: 0, // davon: Inhalt steht NICHT im winnerText
    art: new Map(),   // Art -> { mit, ohne, ohneGanz }
  };
};
const bucheArt = (schluessel, feld, wert) => {
  let e = z.art.get(schluessel);
  if (!e) {
    e = { mit: 0, ohne: 0, ohneGanz: 0 };
    z.art.set(schluessel, e);
  }
  e[feld] += wert;
};

let eigenDevVon = new Map(); // clientId -> Geraeteindex

const CP = R.CrdtManager.prototype;
const origSet = CP.setContent;
CP.setContent = function (pfad, content) {
  const h = managerZuHandler.get(this);
  const st = h ? stapelVon.get(h) : undefined;
  if (!st || innerste(st) !== 'switchToGuid') return origSet.call(this, pfad, content);

  const vor = this.hasDoc(pfad) ? this.getContent(pfad) : '';
  if (vor === content) {
    z.rufLeer++;
    return origSet.call(this, pfad, content);
  }
  const v = letzteVereinigung.get(h);
  if (!v || v.pfad !== pfad || v.merged !== content || v.other !== vor) {
    z.ohneVereinigung++;
    return origSet.call(this, pfad, content);
  }
  z.ruf++;

  const doc = this.docs.get(pfad);
  const eigenClient = doc.clientID;
  if (clientsImDoc(doc).has(eigenClient)) z.kollision++;

  const erg = origSet.call(this, pfad, content);

  const besitz = zeilenBesitz(doc.getText('content'), eigenClient);
  if (besitz.map((b) => b.zeile).join('\n') !== this.getContent(pfad).replace(/\n$/, ''))
    z.rekonAbweichung++;

  // Ergebniszeilen nach Besitz.
  const mEigen = new Map();
  for (const b of besitz) {
    if (b.zeile.length === 0) continue;
    let art;
    if (b.fremd === 0 && b.eigen > 0) {
      art = 'eigen';
      z.eigenItems++;
    } else if (b.eigen === 0) {
      art = 'fremd';
      z.fremdItems++;
    } else {
      art = 'gemischt';
      z.gemischtItems++;
    }
    if (art === 'eigen') mEigen.set(b.zeile, (mEigen.get(b.zeile) ?? 0) + 1);
  }

  const mVor = zaehleZeilen(vor);
  const mZiel = zaehleZeilen(content);
  const mLokal = zaehleZeilen(v.local);
  // Spalte `neu` aus `aufrufstelle.mjs:174-188` — die reine Mengenrechnung.
  for (const [zeile, n] of mZiel) {
    const plus = n - (mVor.get(zeile) ?? 0);
    if (plus > 0) z.neuMenge += plus;
  }

  const eigenDev = eigenDevVon.get(h.clientId) ?? -1;
  for (const [zeile, nL] of mLokal) {
    const eigenOut = mEigen.get(zeile) ?? 0;
    const mit = Math.min(nL, eigenOut);
    const ohne = nL - mit;
    z.lokalZeilen += nL;
    z.lokalMit += mit;
    z.lokalOhne += ohne;
    if (eigenOut === 0) z.lokalOhneGanz += ohne;
    else z.lokalOhneTeil += ohne;
    if (ohne > 0 && !mVor.has(zeile)) z.ohneNichtImGewinner += ohne;
    const a = zeilenArt(zeile);
    const schluessel =
      a.art === 'basis'
        ? 'grundtext'
        : a.art === 'token'
          ? a.dev === eigenDev
            ? 'token-eigenes-geraet'
            : 'token-fremdes-geraet'
          : 'sonstiges';
    if (mit > 0) bucheArt(schluessel, 'mit', mit);
    if (ohne > 0) {
      bucheArt(schluessel, 'ohne', ohne);
      if (eigenOut === 0) bucheArt(schluessel, 'ohneGanz', ohne);
      // SPIKE_DUMP=<n>: die ersten n Faelle der schaerfsten Klasse im Klartext.
      // Ohne sie bleibt „die 71 sind weitergereichte Kopien" eine Behauptung.
      if (schluessel === 'token-eigenes-geraet' && dumpRest > 0) {
        dumpRest--;
        console.log(
          `# DUMP eigenes Token "${zeile}" ohne eigenes Item (Geraet ${eigenDev}, ${pfad})\n` +
            `#   winner ${JSON.stringify(vor)}\n` +
            `#   local  ${JSON.stringify(v.local)}\n` +
            `#   ziel   ${JSON.stringify(content)}`
        );
      }
    }
  }
  return erg;
};

async function laufe(seed) {
  managerZuHandler.clear();
  det.setzeZufallSeed((DET ^ (seed * 0x9e3779b1)) | 0);
  const sc = buildScenario({
    seed,
    nNotes: NOTES,
    baseLines: BASELINES,
    devices: N,
    editsPerDevice: EDITS,
    imprintWindow: 120,
  });
  eigenDevVon = new Map(sc.deviceIds.map((id, i) => [id, i]));
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
  return score(sc, devs);
}

frisch();
let gVerdopp = 0;
let gVerlust = 0;
const t0 = Date.now();
for (let seed = VON; seed <= BIS; seed++) {
  const rr = await laufe(seed);
  gVerdopp += rr.verdopplung;
  gVerlust += rr.verlust;
}
const s = ((Date.now() - t0) / 1000).toFixed(1);
const anteil = (a, b) => (b === 0 ? '—' : `${((100 * a) / b).toFixed(1)} %`);

console.log(
  `== aliasierung Z${ZELLE} N=${N} DET=${DET} Seeds ${VON}..${BIS}` +
    ` [notizen=${NOTES} basis=${BASELINES} edits=${EDITS} md=${MDMODUS}` +
    ` diff=${process.env.QOLLAB_DIFF_MODUS ?? 'STANDARD'} s=${s}]` +
    `: verdopp=${gVerdopp} verlust=${gVerlust}`
);
console.log(
  `   switchToGuid:1454  ruf=${z.ruf} rufLeer=${z.rufLeer}` +
    ` neu(Menge)=${z.neuMenge} eigenItems=${z.eigenItems} fremdItems=${z.fremdItems}` +
    ` gemischtItems=${z.gemischtItems}`
);
console.log(
  `   Kontrollen: ohneVereinigung=${z.ohneVereinigung} kollision=${z.kollision}` +
    ` rekonAbweichung=${z.rekonAbweichung} ohneAberNichtImGewinner=${z.ohneNichtImGewinner}`
);
console.log(
  `   lokale Zeilenvorkommen materialisiert=${z.lokalZeilen}` +
    `  mit eigener Kopie=${z.lokalMit} (${anteil(z.lokalMit, z.lokalZeilen)})` +
    `  OHNE=${z.lokalOhne} (${anteil(z.lokalOhne, z.lokalZeilen)})` +
    `  davon ganz ohne eigenes Item=${z.lokalOhneGanz} teils=${z.lokalOhneTeil}`
);
for (const [k, e] of [...z.art].sort((a, b) => b[1].ohne - a[1].ohne)) {
  const ges = e.mit + e.ohne;
  console.log(
    `     ${k.padEnd(22)} lokal=${String(ges).padStart(7)}` +
      ` mit=${String(e.mit).padStart(7)} ohne=${String(e.ohne).padStart(7)} (${anteil(e.ohne, ges)})` +
      ` davon ganz=${String(e.ohneGanz).padStart(6)}`
  );
}
