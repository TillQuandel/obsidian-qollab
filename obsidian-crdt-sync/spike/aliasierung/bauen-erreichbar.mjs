// Eigener Bau des HEUTIGEN Produktivcodes nach `real-erreichbar.cjs`.
// Optionen wortgleich `spike/schnitt/build-neu.mjs`, nur andere Ausgabe —
// eigener Bau, damit dieser Lauf keine fremde Artefaktdatei mitbenutzt.
// Aufruf (aus obsidian-crdt-sync/): node spike/aliasierung/bauen-erreichbar.mjs
import esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const schnitt = path.join(here, '..', 'schnitt');

await esbuild.build({
  entryPoints: [path.join(schnitt, 'entry-neu.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: path.join(here, 'real-erreichbar.cjs'),
  external: ['yjs', 'diff-match-patch'],
  alias: { obsidian: path.join(schnitt, 'obsidian-stub.js') },
  logLevel: 'warning',
});
console.log('ok');
