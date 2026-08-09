// Baut `spike/zufall-quelle.ts` nach `det-quelle.cjs`, damit der .mjs-Treiber
// (`bilanz-n.mjs`) sie erreicht — der Apparat hier ist reines ESM ohne
// TS-Build, die Quelle ist TypeScript.
//
// WARUM EIN EIGENES BUNDLE und nicht ein zusaetzlicher Export in `entry-neu.ts`:
// `entry-neu.ts` baut nur `real-neu.cjs`. Der Bestandsarm `real.cjs` ist ein
// Bundle vom Stand vor dem 05.08. und kann die neuen Exporte nicht enthalten,
// ohne neu gebaut zu werden — und ein Neubau waere genau das, was der
// Kalibrierungsarm nicht darf. Ein getrenntes Bundle haengt an keinem der beiden
// Arme und wirkt deshalb in beiden.
//
// WARUM KEIN NACHBAU IN .mjs: mulberry32 waere schnell abgeschrieben, der
// Angriffspunkt nicht. `zufall-quelle.ts` traegt im Kopf die teuer erarbeitete
// Feststellung, dass nur das Modul-Objekt `lib0/webcrypto` wirkt (ein Patch auf
// `globalThis.crypto` erreicht die clientID nie). Eine Kopie davon wuerde
// driften. Deshalb dieselbe Datei, nur uebersetzt.
//
// `lib0/webcrypto` bleibt EXTERN — sonst patchte das Bundle eine eigene Kopie
// des Moduls, und yjs saehe den Patch nicht.
import esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

await esbuild.build({
  entryPoints: [path.join(here, '..', 'zufall-quelle.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: path.join(here, 'det-quelle.cjs'),
  external: ['lib0/webcrypto'],
  logLevel: 'warning',
});
console.log('ok');
