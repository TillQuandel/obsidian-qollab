// Traegt eine INSTANZ-Methode statt eines Prototyp-Patches?
//
//   node probe-instanz.mjs
//
// Die Messsonde (`patchsonde.mjs`) stellt `match_main` am PROTOTYP von
// diff-match-patch um — fuer eine Messung richtig, fuer den Produktivcode nicht:
// dort wuerde sie jede andere Nutzung der Bibliothek im selben Prozess
// mitverstellen. Einbaufaehig ist die Variante nur, wenn sie sich auf eine
// eigene INSTANZ beschraenken laesst. Genau das prueft diese Probe — samt
// Gegenprobe, dass die unveraenderte Instanz unberuehrt bleibt.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { diff_match_patch } = require('diff-match-patch');

const base = 'a-base-0\na-base-1\na-base-2\n';
const local = 'a-base-0\na-NEU-1\na-base-1\na-base-2\n';
const other = 'a-base-0|a-X-9\na-base-1|a-X-4\na-base-2\n';

const roh = new diff_match_patch();
const exakt = new diff_match_patch();
exakt.match_main = function (text, pattern, loc) {
  const p = diff_match_patch.prototype.match_main.call(this, text, pattern, loc);
  if (p === -1) return -1;
  return text.substr(p, pattern.length) === pattern ? p : -1;
};

const zeig = (name, d) => {
  const [t, ok] = d.patch_apply(d.patch_make(base, local), other);
  console.log(`${name.padEnd(16)} results=${JSON.stringify(ok)}`);
  console.log(`${' '.repeat(16)} erg=${JSON.stringify(t)}`);
  return JSON.stringify(ok);
};

const a = zeig('roh', roh);
const b = zeig('exakt (Instanz)', exakt);
// Gegenprobe: die zweite Instanz darf die erste nicht beeinflusst haben.
const c = zeig('roh danach', roh);

console.log(`\nInstanz wirkt?        ${a !== b ? 'ja' : 'NEIN — die Umstellung greift nicht'}`);
console.log(`Prototyp unberuehrt?  ${a === c ? 'ja' : 'NEIN — die Aenderung ist ausgelaufen'}`);
