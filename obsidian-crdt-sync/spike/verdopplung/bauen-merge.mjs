// WARUM: `minimal.mjs` soll die ECHTEN Merge-Funktionen fahren, nicht einen
// Nachbau. `src/text-merge.ts` haengt an nichts ausser `diff-match-patch`, also
// reicht ein Buendel ohne Obsidian-Stub. Wortgleich zu
// `spike/konfliktmarker/bauen.mjs`, nur mit anderem Ausgabepfad — dessen
// `merge.cjs` gehoert einer anderen Messung und bleibt unberuehrt.
import esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

await esbuild.build({
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['diff-match-patch'],
  logLevel: 'warning',
  entryPoints: [path.join(here, '..', '..', 'src', 'text-merge.ts')],
  outfile: path.join(here, 'merge.cjs'),
});
console.log('ok');
