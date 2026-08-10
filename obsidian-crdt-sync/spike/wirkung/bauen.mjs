// bauen.mjs — Buendelt beide Fassungen von `threeWayMerge` nebeneinander:
// `alt.cjs` aus `alt-text-merge.ts` (Stand vor ba9f943, Fuzzy-patch_apply) und
// `neu.cjs` aus dem heutigen `src/text-merge.ts`.
//
// Beide brauchen nur `diff-match-patch`, keinen Obsidian-Stub.
import esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

const gemeinsam = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['diff-match-patch'],
  logLevel: 'warning',
};

await esbuild.build({
  ...gemeinsam,
  entryPoints: [path.join(here, 'alt-text-merge.ts')],
  outfile: path.join(here, 'alt.cjs'),
});
await esbuild.build({
  ...gemeinsam,
  entryPoints: [path.join(here, '..', '..', 'src', 'text-merge.ts')],
  outfile: path.join(here, 'neu.cjs'),
});
console.log('ok');
