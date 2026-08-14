// bauen-crdt.mjs — Buendelt BEIDE Fassungen von `src/crdt-manager.ts`:
//   crdt.cjs          der aktuelle Arbeitsbaum (MIT dem T-09-Fix)
//   crdt-vor-fix.cjs  derselbe Datei-Stand aus einem Git-Commit (OHNE den Fix)
//
// Warum beide: Ein Wirkungsnachweis braucht den Vergleich. „Der Fix macht das
// Ergebnis sauber" ist ohne die kaputte Fassung daneben nicht von „der Fall
// trat gar nicht ein" zu unterscheiden — dieselbe Regel, nach der
// `bauen.mjs` fuer text-merge.ts gebaut ist. Ohne sie meldet
// `r14-ursache.mjs` nach dem Einbau „Hypothese traegt nicht" und liest sich,
// als waere der Befund falsch gewesen.
//
// Der Einstieg ist `spike/schnitt/entry-neu.ts` mit denselben Optionen wie
// `build-neu.mjs`; nur `crdt-manager` wird fuer den zweiten Bau auf eine
// temporaere Kopie des alten Standes umgebogen.
//
// Aufruf (aus obsidian-crdt-sync/):
//   node spike/duplikat-mb/bauen-crdt.mjs [<commit-ish>]
// Standard-Commit ist `65f1aa2` — der Stand vor dem T-09-Fix.

import esbuild from 'esbuild';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hier = path.dirname(fileURLToPath(import.meta.url));
const schnitt = path.join(hier, '..', 'schnitt');
const repoWurzel = path.resolve(hier, '..', '..');
const vorFixCommit = process.argv[2] ?? '65f1aa2';

const gemeinsam = {
  entryPoints: [path.join(schnitt, 'entry-neu.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['yjs', 'diff-match-patch'],
  alias: { obsidian: path.join(schnitt, 'obsidian-stub.js') },
  logLevel: 'warning',
};

// 1. Der aktuelle Stand.
await esbuild.build({ ...gemeinsam, outfile: path.join(hier, 'crdt.cjs') });
console.log('crdt.cjs          <- Arbeitsbaum (mit Fix)');

// 2. Der Stand vor dem Fix, aus Git geholt — ueber eine temporaere Datei, damit
//    der Arbeitsbaum unangetastet bleibt.
let quelle;
try {
  quelle = execFileSync('git', ['show', `${vorFixCommit}:obsidian-crdt-sync/src/crdt-manager.ts`], {
    cwd: repoWurzel,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
} catch (err) {
  console.error(
    `crdt-vor-fix.cjs NICHT gebaut: '${vorFixCommit}:obsidian-crdt-sync/src/crdt-manager.ts' ` +
      `ist aus ${repoWurzel} nicht lesbar.\n` +
      `Ohne die Vergleichsfassung sagt ein sauberes Ergebnis nichts — es koennte auch ` +
      `bedeuten, dass der Fall gar nicht eintritt.\n${err.message}`
  );
  process.exit(1);
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qollab-crdt-vorfix-'));
const tmp = path.join(tmpDir, 'crdt-manager.ts');
fs.writeFileSync(tmp, quelle);

// Jeder Import, der auf `crdt-manager` endet, geht auf die Kopie — ausser dem
// Import DER Kopie selbst, sonst loest sie sich auf sich selbst auf.
const umbiegen = {
  name: 'crdt-manager-vor-fix',
  setup(build) {
    build.onResolve({ filter: /(^|\/)crdt-manager$/ }, (args) => {
      if (args.importer === tmp) return null;
      return { path: tmp };
    });
  },
};

await esbuild.build({
  ...gemeinsam,
  plugins: [umbiegen],
  outfile: path.join(hier, 'crdt-vor-fix.cjs'),
});
fs.rmSync(tmpDir, { recursive: true, force: true });
console.log(`crdt-vor-fix.cjs  <- ${vorFixCommit} (ohne Fix)`);

// 3. Gegenprobe: Die beiden Fassungen MUESSEN sich unterscheiden. Sind sie
//    gleich, ist der falsche Commit gewaehlt oder der Fix nicht im Arbeitsbaum —
//    und jeder Vergleich darunter waere bedeutungslos.
const { createRequire } = await import('node:module');
const require_ = createRequire(import.meta.url);
const NL = String.fromCharCode(10);
const probe = (R) => {
  const c = new R.CrdtManager();
  c.setContent('p.md', 'a' + NL + 'b'); // endet OHNE Umbruch
  c.setContent('p.md', 'a' + NL + 'b' + NL + 'c');
  // Tote Items zaehlen: ohne Fix wird 'b' geloescht und als 'b\nc' neu
  // geschrieben, mit Fix bleibt es stehen.
  const Y = require_('yjs');
  const doc = new Y.Doc();
  Y.applyUpdate(doc, c.encodeState('p.md'));
  let it = doc.getText('content')._start;
  let tot = 0;
  while (it) {
    if (it.deleted) tot++;
    it = it.right;
  }
  return tot;
};
const totAlt = probe(require_('./crdt-vor-fix.cjs'));
const totNeu = probe(require_('./crdt.cjs'));
console.log(`\nGegenprobe — tote Items nach dem Anhaengen an "a\\nb":`);
console.log(`  ohne Fix: ${totAlt}`);
console.log(`  mit  Fix: ${totNeu}`);
if (totAlt === totNeu) {
  console.error('\nFEHLER: Beide Fassungen verhalten sich gleich — der Vergleich traegt nicht.');
  process.exit(1);
}
console.log('  -> die Fassungen unterscheiden sich, der Vergleich traegt.');
