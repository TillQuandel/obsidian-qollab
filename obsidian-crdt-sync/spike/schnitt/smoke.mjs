// Kalibrierung: reproduziert der Bundle-Pfad die beiden dokumentierten
// Erstkontakt-Befunde aus `tests/erstkontakt-duplikat.test.ts`?
//   1. unabhaengig gepraegte Staende  -> SEED steht zweimal
//   2. byte-identische Staende        -> SEED steht einmal
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const R = require('./real.cjs');

const NOTE = 'note.md';
const A_YJS = '.qollab/note.md.aaaa1111.yjs';
const B_YJS = '.qollab/note.md.bbbb2222.yjs';
const G_KLEIN = '00000000000000000000000000000000';
const G_GROSS = 'ffffffffffffffffffffffffffffffff';

function schreibeSidecar(vault, path, guid, text) {
  const m = new R.CrdtManager();
  m.setContent(NOTE, text);
  vault._files.set(path, R.toArrayBuffer(R.encodeStateFile(guid, m.encodeState(NOTE))));
}
const kopiere = (von, nach, path) => nach._files.set(path, von._files.get(path).slice(0));
const zaehle = (t, n) => t.split(n).length - 1;

async function fall1() {
  const vA = R.makeVaultMock(), vB = R.makeVaultMock();
  schreibeSidecar(vA, A_YJS, G_GROSS, 'L1\nSEED\n');
  schreibeSidecar(vB, B_YJS, G_KLEIN, 'L1\n');
  vA._textFiles.set(NOTE, 'L1\nSEED\n');
  vB._textFiles.set(NOTE, 'L1\n');
  const hA = new R.SyncHandler(vA, new R.CrdtManager(), 'aaaa1111');
  const hB = new R.SyncHandler(vB, new R.CrdtManager(), 'bbbb2222');
  const bVeraltet = vB._files.get(B_YJS).slice(0);
  vB._textFiles.set(NOTE, 'L1\nSEED\n');
  kopiere(vA, vB, A_YJS);
  await hB.applyLocalContent(NOTE, 'L1\nSEED\n');
  vA._files.set(B_YJS, bVeraltet);
  await hA.loadAndMerge(NOTE);
  kopiere(vA, vB, A_YJS);
  return await hB.loadAndMerge(NOTE);
}

async function fall2() {
  const vA = R.makeVaultMock(), vB = R.makeVaultMock();
  schreibeSidecar(vA, A_YJS, G_GROSS, 'L1\nSEED\n');
  schreibeSidecar(vB, B_YJS, G_KLEIN, 'L1\nSEED\n');
  vA._textFiles.set(NOTE, 'L1\nSEED\n');
  vB._textFiles.set(NOTE, 'L1\nSEED\n');
  const hA = new R.SyncHandler(vA, new R.CrdtManager(), 'aaaa1111');
  const hB = new R.SyncHandler(vB, new R.CrdtManager(), 'bbbb2222');
  kopiere(vB, vA, B_YJS);
  await hA.loadAndMerge(NOTE);
  kopiere(vA, vB, A_YJS);
  return await hB.loadAndMerge(NOTE);
}

const t1 = await fall1();
const t2 = await fall2();
console.log('Fall 1 (unabhaengig gepraegt): SEED x', zaehle(t1, 'SEED'), '   erwartet 2 ->',
  zaehle(t1, 'SEED') === 2 ? 'OK' : 'ABWEICHUNG');
console.log('Fall 2 (byte-identisch):       SEED x', zaehle(t2, 'SEED'), '   erwartet 1 ->',
  zaehle(t2, 'SEED') === 1 ? 'OK' : 'ABWEICHUNG');
