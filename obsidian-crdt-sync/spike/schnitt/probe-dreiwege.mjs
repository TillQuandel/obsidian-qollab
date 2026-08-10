// Traegt der zeilenweise 3-Wege-Merge, was `patch_apply` nicht traegt?
//
//   SPIKE_BUNDLE=./real-neu.cjs node probe-dreiwege.mjs [seeds]
//
// `dreiWegeZeilen` (schnitte.mjs) loest beide Seiten gegen die Basis auf, statt
// ein Delta unscharf auf den Gegenstand zu patchen. Kein Fuzz, kein Padding,
// keine Zeichenebene — und `threeWayMerge` HAT einen echten gemeinsamen
// Vorfahren, der Fuzz ist dort also gar nicht noetig.
//
// Geprueft wird gegen ALLE vier Faelle, an denen der patch_apply-Umbau
// gescheitert ist, plus den Ratenlauf aus `probe-fuzz.mjs`.
import { createRequire } from 'node:module';
// DREIWEGE=neu waehlt den korrigierten Prototyp, sonst der Apparat-Merge.
const MERGE = await import(process.env.DREIWEGE === 'neu' ? './dreiwege.mjs' : './schnitte.mjs');
const dreiWegeZeilen = MERGE.dreiWegeZeilen;

const require = createRequire(import.meta.url);
const R = require(process.env.SPIKE_BUNDLE ?? './real-neu.cjs');

const SEEDS = Number(process.argv[2] ?? 3000);
let fehler = 0;
const pruefe = (name, ist, soll) => {
  const ok = ist === soll;
  if (!ok) fehler++;
  console.log(`  ${ok ? 'OK  ' : 'FEHL'} ${name}`);
  if (!ok) {
    console.log(`       ist  = ${JSON.stringify(ist)}`);
    console.log(`       soll = ${JSON.stringify(soll)}`);
  }
};

console.log('== Die vier Faelle, an denen der patch_apply-Umbau gescheitert ist ==');

// (1) OFFLINE-LOESCHUNG (sweep-schranke-basiswahl.test.ts). `local` loescht
// `Zeile B`, `other` haengt `EIGEN-EDIT` an. Beides muss durchkommen.
pruefe(
  'Loeschung: Zeile B weg, EIGEN-EDIT bleibt',
  dreiWegeZeilen(
    'Titel\nFREMD-EDIT\nZeile A\nZeile B\n',
    'Titel\nFREMD-EDIT\nZeile A\n',
    'Titel\nFREMD-EDIT\nZeile A\nZeile B\nEIGEN-EDIT\n'
  ),
  'Titel\nFREMD-EDIT\nZeile A\nEIGEN-EDIT\n'
);

// (2) ALLTAGSFALL. Beide fuegen an derselben Stelle etwas an. Beide muessen
// stehen bleiben — die Reihenfolge ist nicht festgelegt, deshalb hier nur die
// Enthaltensein-Pruefung.
const alltag = dreiWegeZeilen('a\n', 'a\nLokal\n', 'a\nFremd\n');
pruefe('Alltag: beide Beitraege vorhanden',
  [alltag.includes('Lokal'), alltag.includes('Fremd'), alltag.startsWith('a\n')].join(','),
  'true,true,true');
console.log(`       ergebnis = ${JSON.stringify(alltag)}`);

// (3) SEED 3 aus dem Messlauf — der Fall, an dem der Fuzz `n0-base-4` zerstoert.
const BASIS = Array.from({ length: 8 }, (_, k) => `n0-base-${k}`);
const s3base = BASIS.join('\n') + '\n';
const s3local = [...BASIS.slice(0, 6), 'n0-base-6|n0-D0-9', 'n0-base-7'].join('\n') + '\n';
const s3other = [...BASIS.slice(0, 5), 'n0-base-5|n0-D1-4', 'n0-base-6|n0-D1-0', 'n0-base-7', 'n0-D1-6'].join('\n') + '\n';
const s3 = dreiWegeZeilen(s3base, s3local, s3other);
pruefe('Seed 3: n0-base-4 ueberlebt', String(s3.split('\n').includes('n0-base-4')), 'true');
pruefe('Seed 3: fremde Ergaenzungen ueberleben',
  [s3.includes('n0-base-5|n0-D1-4'), s3.includes('n0-base-6|n0-D1-0')].join(','), 'true,true');
pruefe('Seed 3: lokale Ergaenzung ueberlebt', String(s3.includes('n0-D0-9')), 'true');

// (4) IDEMPOTENZ. Rechnet ein zweites Geraet denselben Merge auf dem Ergebnis
// des ersten, darf der Text nicht weiterwachsen.
const e1 = dreiWegeZeilen(s3base, s3local, s3other);
const e2 = dreiWegeZeilen(s3base, s3local, e1);
const e3 = dreiWegeZeilen(s3base, s3local, e2);
pruefe('Idempotenz: Laenge stabil ueber drei Runden', `${e2.length === e3.length}`, 'true');
console.log(`       laengen = ${e1.length} -> ${e2.length} -> ${e3.length}`);

// --- Ratenlauf, identisch zu probe-fuzz.mjs -------------------------------
console.log('\n== Ratenlauf (dieselbe Grammatik wie probe-fuzz.mjs) ==');
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const grundzeilen = Array.from({ length: 8 }, (_, k) => `n0-base-${k}`);
const base = grundzeilen.join('\n') + '\n';
function bearbeite(r, dev, anzahl) {
  const zeilen = [...grundzeilen];
  const tokens = [];
  for (let i = 0; i < anzahl; i++) {
    const t = `n0-D${dev}-${Math.floor(r() * 10)}`;
    tokens.push(t);
    const pos = Math.floor(r() * (zeilen.length + 1));
    if (r() < 0.5 || pos >= zeilen.length) zeilen.splice(pos, 0, t);
    else zeilen[pos] = zeilen[pos] + '|' + t;
  }
  return { text: zeilen.join('\n') + '\n', tokens };
}
for (const [name, merge] of [
  ['patch_apply (Bestand)', (b, l, o) => R.threeWayMerge(b, l, o)],
  ['dreiWegeZeilen', (b, l, o) => dreiWegeZeilen(b, l, o)],
]) {
  let weg = 0, lokalWeg = 0, laenge = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const r = rng(seed * 0x9e3779b1);
    const L = bearbeite(r, 0, 1 + Math.floor(r() * 3));
    const O = bearbeite(r, 1, 1 + Math.floor(r() * 3));
    const erg = merge(base, L.text, O.text);
    laenge += erg.length;
    const da = erg.split('\n');
    const unberuehrt = grundzeilen.filter(
      (z) => L.text.split('\n').includes(z) && O.text.split('\n').includes(z)
    );
    weg += unberuehrt.filter((z) => !da.includes(z)).length;
    lokalWeg += L.tokens.filter((t) => !O.text.includes(t) && !erg.includes(t)).length;
  }
  console.log(`  ${name.padEnd(24)} WEG=${weg}  LOKALWEG=${lokalWeg}  Zeichen gesamt=${laenge}`);
}

console.log(`\n${fehler === 0 ? 'ALLE EINZELFAELLE OK' : fehler + ' EINZELFAELLE FEHLGESCHLAGEN'}`);
