// Eigener Bau des HEUTIGEN Produktivcodes nach `real-alias.cjs`.
//
// WARUM ein eigener statt `spike/schnitt/real-neu.cjs`: Der Auftrag verbietet
// Aenderungen ausserhalb dieses Verzeichnisses; ein Neubau von `real-neu.cjs`
// wuerde eine Datei ausserhalb ueberschreiben. Optionen und Einstieg sind
// WORTGLEICH `spike/schnitt/build-neu.mjs` — nur `outfile` unterscheidet sich.
// Damit ist der gemessene Code derselbe, gegen den die veroeffentlichten Zahlen
// aus `spike/verdopplung/ergebnis-aufrufstelle*.txt` stehen.
//
//   node spike/aliasierung/bauen.mjs
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
  outfile: path.join(here, 'real-alias.cjs'),
  external: ['yjs', 'diff-match-patch'],
  alias: { obsidian: path.join(schnitt, 'obsidian-stub.js') },
  logLevel: 'warning',
});
console.log('ok');
