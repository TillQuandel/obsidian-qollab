// WARUM: Ein zweiter Bau des heutigen Produktivcodes, bei dem AUSSCHLIESSLICH
// die Aufloesung von `./text-merge` umgebogen ist — auf die Zaehlhuelle
// `zaehl-text-merge.ts`. Damit zaehlt der Lauf die Merge-Aufrufe am Ort ihres
// Entstehens, ohne dass `src/` angefasst wird.
//
// Der Rest ist wortgleich `spike/schnitt/build-neu.mjs` (gleicher Einstieg,
// gleiche externals, gleicher Obsidian-Stub) — nur `outfile` und das Plugin
// unterscheiden sich. Ergebnis: `real-zaehl.cjs`, per SPIKE_BUNDLE fahrbar.
//
//   node spike/verdopplung/bauen.mjs
import esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const schnitt = path.join(here, '..', 'schnitt');
const huelle = path.join(here, 'zaehl-text-merge.ts');

// Jeder Import, der auf `text-merge` endet, geht auf die Huelle — ausser dem
// Import DER Huelle selbst, sonst loest sie sich auf sich selbst auf.
const umbiegen = {
  name: 'text-merge-huelle',
  setup(build) {
    build.onResolve({ filter: /(^|\/)text-merge$/ }, (args) => {
      if (args.importer === huelle) return null;
      return { path: huelle };
    });
  },
};

await esbuild.build({
  entryPoints: [path.join(schnitt, 'entry-neu.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: path.join(here, 'real-zaehl.cjs'),
  external: ['yjs', 'diff-match-patch'],
  alias: { obsidian: path.join(schnitt, 'obsidian-stub.js') },
  plugins: [umbiegen],
  logLevel: 'warning',
});
console.log('ok');
