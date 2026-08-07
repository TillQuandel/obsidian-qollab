// Baut den HEUTIGEN Produktivcode nach `real-neu.cjs`. Gleiche Optionen wie
// `build.mjs`, nur anderer Einstieg und andere Ausgabe — `real.cjs` (Stand vor
// dem 05.08.) bleibt als Kalibrierungsarm erhalten.
import esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

await esbuild.build({
  entryPoints: [path.join(here, 'entry-neu.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: path.join(here, 'real-neu.cjs'),
  external: ['yjs', 'diff-match-patch'],
  alias: { obsidian: path.join(here, 'obsidian-stub.js') },
  logLevel: 'warning',
});
console.log('ok');
