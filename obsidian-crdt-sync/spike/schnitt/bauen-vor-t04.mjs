// bauen-vor-t04.mjs — Baut `real-vor-t04.cjs`: heutiger Produktivcode, aber mit
// `text-merge.ts` vom Stand VOR T-04 (zeilenweiser 3-Wege-Merge).
//
// WOZU. `t04-achsen.mjs` misst `WEG` (Grundtextverlust) auf den drei Achsen,
// an denen der Fix vom 2026-08-10 laut `produktziel.md` nicht trug. Kommt dort
// ueberall 0 heraus, ist das erst dann eine Aussage, wenn dieselbe Messung
// gegen eine Fassung OHNE T-04 Verlust zeigt. Sonst erzeugt der Apparat die
// Lage gar nicht, und der Nullbefund ist wertlos — das ist in diesem Projekt
// elfmal passiert.
//
// WARUM NICHT `real.cjs`. Der eingefrorene Kalibrierungsarm (Stand vor dem
// 05.08.) laesst sich mit dem heutigen `schnitte.mjs` nicht mehr fahren: Der
// Apparat ruft `handler.parkedPaths()`, das es damals noch nicht gab. Er ist
// fuer diesen Vergleich tot. `efae37a^` (209d7d8) hat es bereits.
//
// NUR text-merge.ts wird zurueckgedreht. Alles andere - crdt-manager samt
// T-09-Fix, sync-handler, write-provenance - bleibt auf dem heutigen Stand.
// Damit isoliert der Vergleich T-04 und misst nicht die Summe aller Aenderungen
// seit dem 10.08.
//
// Aufruf (aus obsidian-crdt-sync/):
//   node spike/schnitt/bauen-vor-t04.mjs [<commit-ish>]

import esbuild from 'esbuild';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hier = path.dirname(fileURLToPath(import.meta.url));
const repoWurzel = path.resolve(hier, '..', '..');
const commit = process.argv[2] ?? 'efae37a^';

let quelle;
try {
  quelle = execFileSync('git', ['show', `${commit}:obsidian-crdt-sync/src/text-merge.ts`], {
    cwd: repoWurzel,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
} catch (err) {
  console.error(`text-merge.ts aus '${commit}' nicht lesbar:\n${err.message}`);
  process.exit(1);
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qollab-vor-t04-'));
const tmp = path.join(tmpDir, 'text-merge.ts');
fs.writeFileSync(tmp, quelle);

const umbiegen = {
  name: 'text-merge-vor-t04',
  setup(build) {
    build.onResolve({ filter: /(^|\/)text-merge$/ }, (args) => {
      if (args.importer === tmp) return null;
      return { path: tmp };
    });
  },
};

await esbuild.build({
  entryPoints: [path.join(hier, 'entry-neu.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: path.join(hier, 'real-vor-t04.cjs'),
  external: ['yjs', 'diff-match-patch'],
  alias: { obsidian: path.join(hier, 'obsidian-stub.js') },
  plugins: [umbiegen],
  logLevel: 'warning',
});
fs.rmSync(tmpDir, { recursive: true, force: true });
console.log(`real-vor-t04.cjs <- text-merge.ts aus ${commit}, Rest heutiger Stand`);

// Gegenprobe: Die Fassungen muessen sich unterscheiden. `threeWayMerge` ist die
// Funktion, die T-04 ersetzt hat - vorher Fuzzy-patch_apply, danach zeilenweise.
const { createRequire } = await import('node:module');
const require_ = createRequire(import.meta.url);
const alt = require_('./real-vor-t04.cjs');
const neu = require_('./real-neu.cjs');
const NL = String.fromCharCode(10);
// Ein Fall, den der Fuzzy-Patch anders aufloest als der zeilenweise Merge:
// beide Seiten haengen an derselben Stelle an.
const probe = [`a${NL}b${NL}c${NL}`, `a${NL}b${NL}LOKAL${NL}c${NL}`, `a${NL}b${NL}FREMD${NL}c${NL}`];
const rAlt = alt.threeWayMerge(...probe);
const rNeu = neu.threeWayMerge(...probe);
console.log(`\nGegenprobe threeWayMerge(base, +LOKAL, +FREMD):`);
console.log(`  vor T-04: ${JSON.stringify(rAlt)}`);
console.log(`  heute   : ${JSON.stringify(rNeu)}`);
if (rAlt === rNeu) {
  console.error('\nWARNUNG: Beide Fassungen liefern hier dasselbe. Das muss nicht heissen,');
  console.error('dass der Vergleich nicht traegt — aber diese Probe belegt ihn nicht.');
} else {
  console.log('  -> die Fassungen unterscheiden sich, der Vergleich traegt.');
}
