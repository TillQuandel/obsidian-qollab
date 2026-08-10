// bauen.mjs — Buendelt `src/text-merge.ts` nach `merge.cjs`.
//
// Warum ueberhaupt buendeln: Die Behauptung in `docs/produktziel.md` handelt von
// den ECHTEN Merge-Funktionen, nicht von einer nachgebauten Naeherung. Ein
// Nachbau wuerde genau die Frage beantworten, die niemand gestellt hat. TypeScript
// laeuft aber nicht direkt unter `node`, und der Jest-Weg ist hier gesperrt
// (paralleler Testlauf eines anderen Agenten, EPERM im geteilten Cache).
//
// `text-merge.ts` haengt an nichts ausser `diff-match-patch` — kein Obsidian-Stub
// noetig, deshalb bleibt das Paket `external` und wird zur Laufzeit aus dem
// node_modules der Repo-Wurzel geladen.
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
