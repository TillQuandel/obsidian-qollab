// t04-achsen.mjs — Traegt der zeilenweise 3-Wege-Merge (T-04) auch auf den
// drei Achsen, an denen der Fix vom 2026-08-10 (T-05) NICHT trug?
//
// DIE OFFENE FRAGE. `docs/produktziel.md` fuehrt unter „Wo der Fix NICHT
// traegt" eine Tabelle vom 2026-08-10:
//
//   N = 5, 6, 8                  nein - Verlust in allen 8 Zellen
//   grosse Notizen (200/1000)    nein - Fix dort wirkungslos
//   mdModus 'ueberschreiben'     nein bei N = 4
//
// Einen Tag spaeter kam T-04 (zeilenweiser 3-Wege-Merge statt Fuzzy-Patch) und
// behauptet in der Registratur: „Erledigt auch die drei Achsen, an denen der
// Fix vom 2026-08-10 nicht trug (N >= 5, grosse Notizen, mdModus
// ueberschreiben)." Belegt ist T-04 mit „8 Zellen a 200 Seeds x 10 Notizen" -
// WELCHE acht Zellen das sind, steht nirgends.
//
// Das ist dasselbe Muster wie X-08: eine Wirkung, an einer Lage gemessen, fuer
// andere mitbehauptet. Dort hat es nicht getragen. Hier wird es nachgerechnet.
//
// GEMESSEN WIRD `WEG` - der Grundtextverlust, also K.o.-Kriterium 1. Nicht der
// Gesamtverlust: Eine fehlende Edit-Zeile ist aergerlich, eine fehlende
// Grundtextzeile ist ein K.o. `score()` aus dem Harness fasst beide zusammen,
// deshalb zaehlt dieser Treiber die Basiszeilen selbst - mit demselben Muster
// wie verlustort.mjs (`/-base-\d+$/`).
//
// GEGENPROBE ueber das Bundle. Ohne sie waere „ueberall 0" nicht von „der
// Apparat erzeugt die Lage gar nicht" zu unterscheiden:
//
//   SPIKE_BUNDLE=./real.cjs     node spike/schnitt/t04-achsen.mjs   # alter Stand
//   SPIKE_BUNDLE=./real-neu.cjs node spike/schnitt/t04-achsen.mjs   # heute
//
// Der alte Stand MUSS Verlust zeigen, sonst misst der Lauf nichts.
//
// Aufruf (aus obsidian-crdt-sync/spike/schnitt/):
//   node t04-achsen.mjs [seeds]

import { buildScenario, run, score } from './harness.mjs';
import * as S from './schnitte.mjs';

const SEEDS = Number(process.argv[2] ?? 40);
const BUNDLE = process.env.SPIKE_BUNDLE ?? './real.cjs';

const istBasis = (l) => /-base-\d+$/.test(l);

/**
 * Eine Zelle: `seeds` Laeufe mit fester Geraetezahl, Notizgroesse und mdModus.
 * Rueckgabe zaehlt WEG getrennt vom Gesamtverlust.
 */
async function zelle({ devices, baseLines, mdModus, nNotes }) {
  let weg = 0, verlust = 0, verdopp = 0, div = 0, sauber = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const sc = buildScenario({ seed, nNotes, baseLines, devices, editsPerDevice: 1, imprintWindow: 120 });
    const r = await run({
      scenario: sc,
      makeDevices: (t, x) => S.makeS0real(t, x, { layout: 'sidecar' }),
      seed,
      settle: 10,
      mdModus,
    });
    const s = score(sc, r.devices);
    verlust += s.verlust;
    verdopp += s.verdopplung;
    div += s.divergent;

    // WEG: Basiszeilen, die im Endtext von Geraet 0 fehlen. Genau K.o.-1.
    let wegHier = 0;
    for (const n of sc.notes) {
      const basis = n.baseline.split('\n').filter(istBasis);
      const da = new Set(r.devices[0].currentText(n.path).split('\n'));
      for (const z of basis) if (!da.has(z)) wegHier++;
    }
    weg += wegHier;
    if (wegHier === 0 && s.verlust === 0 && s.verdopplung === 0 && s.divergent === 0) sauber++;
  }
  return { weg, verlust, verdopp, div, sauber };
}

// Die drei Achsen aus der Tabelle vom 2026-08-10, plus N=2/4 als Anker (dort
// ist WEG = 0 belegt). Grosse Notizen mit weniger Notizen, sonst laeuft die
// Zelle unvertretbar lang - die Zellbasis steht in der Ausgabe.
const ZELLEN = [
  { name: 'N=2  (Anker)', devices: 2, baseLines: 8, mdModus: 'kopie', nNotes: 10 },
  { name: 'N=4  (Anker)', devices: 4, baseLines: 8, mdModus: 'kopie', nNotes: 10 },
  { name: 'N=5', devices: 5, baseLines: 8, mdModus: 'kopie', nNotes: 10 },
  { name: 'N=6', devices: 6, baseLines: 8, mdModus: 'kopie', nNotes: 10 },
  { name: 'N=8', devices: 8, baseLines: 8, mdModus: 'kopie', nNotes: 10 },
  { name: '200 Zeilen, N=4', devices: 4, baseLines: 200, mdModus: 'kopie', nNotes: 3 },
  { name: '1000 Zeilen, N=4', devices: 4, baseLines: 1000, mdModus: 'kopie', nNotes: 2 },
  { name: "ueberschreiben, N=4", devices: 4, baseLines: 8, mdModus: 'ueberschreiben', nNotes: 10 },
];

console.log(`T-04 auf den drei Achsen — Bundle ${BUNDLE}, ${SEEDS} Seeds je Zelle\n`);
console.log('  Zelle                 Notizen  WEG   Verlust  Verdopp  diverg  sauber');
console.log('  ' + '-'.repeat(72));

const ergebnis = [];
for (const z of ZELLEN) {
  const t0 = Date.now();
  const r = await zelle(z);
  ergebnis.push({ ...z, ...r });
  console.log(
    `  ${z.name.padEnd(20)} ${String(z.nNotes).padStart(6)}  ` +
      `${String(r.weg).padStart(4)}  ${String(r.verlust).padStart(7)}  ` +
      `${String(r.verdopp).padStart(7)}  ${String(r.div).padStart(6)}  ` +
      `${String(r.sauber).padStart(3)}/${SEEDS}   (${Math.round((Date.now() - t0) / 1000)}s)`
  );
}

const mitWeg = ergebnis.filter((e) => e.weg > 0);
const wegGesamt = ergebnis.reduce((n, e) => n + e.weg, 0);

// --- Die Gegenprobe, fest eingebaut ---------------------------------------
// Ein Nullbefund ohne sie ist wertlos: „WEG = 0" und „der Apparat erzeugt die
// Lage nicht" sehen identisch aus. In diesem Projekt sind elf Instrumente
// nachweislich blind gewesen, drei davon in der Session, die diesen Treiber
// gebaut hat. Deshalb laeuft die Gegenprobe NICHT als optionaler zweiter
// Aufruf, sondern automatisch: Der Treiber startet sich selbst mit
// `QOLLAB_DIFF_MODUS=semantisch` - dem Stand vor T-05, fuer den Grundtextverlust
// belegt ist. Zeigt der KEINEN Verlust, ist der Lauf blind und sagt es.
const istGegenprobe = process.env.QOLLAB_DIFF_MODUS === 'semantisch';

if (!istGegenprobe) {
  const { spawnSync } = await import('node:child_process');
  console.log('\n--- Gegenprobe: derselbe Lauf mit diffModus=semantisch (vor T-05) ---');
  const r = spawnSync(process.execPath, [process.argv[1], String(SEEDS)], {
    env: { ...process.env, QOLLAB_DIFF_MODUS: 'semantisch' },
    encoding: 'utf8',
  });
  const zeilen = (r.stdout ?? '').split('\n');
  const wegZeile = zeilen.find((z) => z.includes('GEGENPROBE-WEG='));
  const wegAlt = wegZeile ? Number(wegZeile.split('GEGENPROBE-WEG=')[1]) : NaN;
  for (const z of zeilen.filter((z) => /^  \S.*\d+\/\d+/.test(z))) console.log(z);

  console.log('\n--- Befund -----------------------------------------------------');
  if (Number.isNaN(wegAlt)) {
    console.log('  Die Gegenprobe lieferte keine Zahl — Lauf nicht auswertbar.');
  } else if (wegAlt === 0) {
    console.log('  BLIND. Auch der Stand VOR T-05 zeigt WEG = 0. Dieser Apparat erzeugt');
    console.log('  die Verlustlage nicht; beide Nullbefunde sind wertlos. Mehr Seeds,');
    console.log('  mehr Edits je Geraet oder eine andere Zellwahl noetig.');
  } else if (wegGesamt === 0) {
    console.log(`  T-04 TRAEGT AUF ALLEN ${ZELLEN.length} ZELLEN. WEG = 0 im heutigen Stand,`);
    console.log(`  waehrend der Stand vor T-05 in denselben Zellen WEG = ${wegAlt} zeigt.`);
    console.log('  Die Tabelle in produktziel.md („Wo der Fix NICHT traegt", 2026-08-10)');
    console.log('  ist damit ueberholt — sie beschreibt den Stand vor dem zeilenweisen');
    console.log('  3-Wege-Merge.');
  } else {
    console.log(`  T-04 traegt NICHT ueberall: WEG = ${wegGesamt} im heutigen Stand.`);
    for (const e of mitWeg) console.log(`    ${e.name.padEnd(20)} WEG=${e.weg}`);
  }
} else {
  // Als Gegenprobe gestartet: nur die Zahl melden, die der Elternlauf braucht.
  console.log(`GEGENPROBE-WEG=${wegGesamt}`);
}
