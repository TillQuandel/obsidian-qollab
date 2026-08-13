// bauen.mjs — Buendelt BEIDE Fassungen von `src/text-merge.ts`:
//   merge.cjs          der aktuelle Arbeitsbaum (MIT dem Zeilenende-Fix)
//   merge-vor-fix.cjs  derselbe Datei-Stand aus einem Git-Commit (OHNE den Fix)
//
// Warum beide: Ein Wirkungsnachweis braucht den Vergleich. „Der Fix macht das
// Ergebnis sauber" ist ohne die kaputte Fassung daneben nicht von „der Fall trat
// gar nicht ein" zu unterscheiden — genau die Verwechslung, die dieses Projekt
// mehrfach bezahlt hat.
//
// Warum buendeln statt Jest: `text-merge.ts` haengt nur an `diff-match-patch`,
// kein Obsidian-Stub noetig. Und der Jest-Weg ist bei parallelen Laeufen unter
// Windows durch EPERM im geteilten Cache blockiert.
//
// Aufruf (aus obsidian-crdt-sync/):
//   node spike/duplikat-mb/bauen.mjs [<commit-ish>]
// Standard-Commit ist `c8b8710` — der Stand vor dem Fix vom 2026-08-13.

import esbuild from 'esbuild';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hier = path.dirname(fileURLToPath(import.meta.url));
const repoWurzel = path.resolve(hier, '..', '..');
const vorFixCommit = process.argv[2] ?? 'c8b8710';

// 1. Der aktuelle Stand.
await esbuild.build({
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['diff-match-patch'],
  logLevel: 'warning',
  entryPoints: [path.join(repoWurzel, 'src', 'text-merge.ts')],
  outfile: path.join(hier, 'merge.cjs'),
});
console.log('merge.cjs          <- Arbeitsbaum (mit Fix)');

// 2. Der Stand vor dem Fix, aus Git geholt. Ueber eine temporaere Datei, damit
//    der Arbeitsbaum unangetastet bleibt.
let quelle;
try {
  quelle = execFileSync('git', ['show', `${vorFixCommit}:obsidian-crdt-sync/src/text-merge.ts`], {
    cwd: repoWurzel,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
} catch (err) {
  console.error(
    `merge-vor-fix.cjs NICHT gebaut: '${vorFixCommit}:obsidian-crdt-sync/src/text-merge.ts' ` +
      `ist aus ${repoWurzel} nicht lesbar.\n` +
      `Ohne die Vergleichsfassung sagt ein gruener Lauf nichts — er koennte auch bedeuten, ` +
      `dass der Fall gar nicht eintritt.\n${err.message}`
  );
  process.exit(1);
}

const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qollab-vorfix-')), 'text-merge.ts');
fs.writeFileSync(tmp, quelle);
await esbuild.build({
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['diff-match-patch'],
  logLevel: 'warning',
  entryPoints: [tmp],
  outfile: path.join(hier, 'merge-vor-fix.cjs'),
});
fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
console.log(`merge-vor-fix.cjs  <- ${vorFixCommit} (ohne Fix)`);

// 3. Gegenprobe: Die beiden Fassungen muessen sich unterscheiden. Sind sie
//    gleich, ist der falsche Commit gewaehlt oder der Fix nicht im Arbeitsbaum —
//    und jeder Vergleich darunter waere bedeutungslos.
const { createRequire } = await import('node:module');
const require_ = createRequire(import.meta.url);
const alt = require_('./merge-vor-fix.cjs');
const neu = require_('./merge.cjs');
const probe = ['a\nb', 'a\nb\nX', 'a\nb\nY'];
const rAlt = alt.threeWayMerge(...probe);
const rNeu = neu.threeWayMerge(...probe);
console.log(`\nGegenprobe threeWayMerge('a\\nb','a\\nb\\nX','a\\nb\\nY'):`);
console.log(`  ohne Fix: ${JSON.stringify(rAlt)}`);
console.log(`  mit  Fix: ${JSON.stringify(rNeu)}`);
if (rAlt === rNeu) {
  console.error('\nFEHLER: Beide Fassungen verhalten sich gleich — der Vergleich traegt nicht.');
  process.exit(1);
}
console.log('  -> die Fassungen unterscheiden sich, der Vergleich traegt.');
