import esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

await esbuild.build({
  entryPoints: [path.join(here, 'entry.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: path.join(here, 'real.cjs'),
  external: ['yjs', 'diff-match-patch'],
  alias: { obsidian: path.join(here, 'obsidian-stub.js') },
  logLevel: 'warning',
});
console.log('ok');
