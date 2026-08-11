// sweep.mjs — erschoepfende Gegenprobe der Regel, die aus `sonde.mjs` faellt.
//
// Aufgezaehlt werden ALLE Paare von Zeilenfolgen ueber dem Alphabet {a,b,c} mit
// Laenge 1..4 (je 120 Folgen, 14.400 Paare). Jede Seite bekommt zusaetzlich eine
// nur ihr eigene Schlusszeile, damit die Texte immer verschieden sind — sonst
// greift der Kurzschluss `winnerText === localText` (`sync-handler.ts:1444`) und
// es gaebe nichts zu messen.
//
// Geprueft werden zwei Vorhersagen ueber die GEMEINSAMEN Zeilen (= Buchstaben,
// die auf beiden Seiten vorkommen):
//
//   V1 (hinreichend fuer Aliasierung)
//       Steht die Folge der gemeinsamen Zeilen des VERLIERERS als Teilfolge in
//       der des GEWINNERS, bekommt KEINE dieser Zeilen ein eigenes Item.
//   V2 (untere Schranke)
//       Kommt eine Zeile beim Verlierer oefter vor als beim Gewinner, bekommt
//       mindestens der Ueberschuss (n_l - n_w) ein eigenes Item.
//
//   SPIKE_DET=42 node spike/aliasierung/sweep.mjs
import { fall, DET } from './kern.mjs';

const NL = String.fromCharCode(10);
const ALPHABET = ['a', 'b', 'c'];
const MAXLEN = Number(process.env.SPIKE_MAXLEN ?? 4);

function folgen(maxLen) {
  const out = [];
  const bau = (pre) => {
    if (pre.length > 0) out.push(pre);
    if (pre.length === maxLen) return;
    for (const z of ALPHABET) bau([...pre, z]);
  };
  bau([]);
  return out;
}

const zaehleFolge = (f, z) => f.filter((x) => x === z).length;

// Ist `a` eine Teilfolge von `b`?
function istTeilfolge(a, b) {
  let i = 0;
  for (const x of b) if (i < a.length && a[i] === x) i++;
  return i === a.length;
}

const alle = folgen(MAXLEN);
console.log(`== sweep  SPIKE_DET=${DET}  Alphabet {${ALPHABET.join(',')}}  Laenge 1..${MAXLEN}`);
console.log(`   ${alle.length} Folgen je Seite -> ${alle.length * alle.length} Paare`);

let paare = 0;
let v1Faelle = 0;
let v1Verletzt = 0;
let v2Verletzt = 0;
let paareOhneEigene = 0; // kein einziges eigenes Item unter den gemeinsamen Zeilen
let gemeinsameZeilen = 0;
let gemeinsameAliasiert = 0;
const beispieleV1 = [];
const beispieleV2 = [];

const t0 = Date.now();
for (const w of alle) {
  for (const l of alle) {
    paare++;
    const winnerText = [...w, 'nur-W'].join(NL) + NL;
    const localText = [...l, 'nur-L'].join(NL) + NL;
    const r = fall('sweep', winnerText, localText, null);

    // Eigene Items je Buchstabe im Verlierer-Doc.
    const eigenJe = new Map();
    for (const z of r.besitz) {
      if (!ALPHABET.includes(z.text)) continue;
      if (z.eigen) eigenJe.set(z.text, (eigenJe.get(z.text) ?? 0) + 1);
    }

    const gemeinsam = ALPHABET.filter((z) => w.includes(z) && l.includes(z));
    let eigenSumme = 0;
    for (const z of gemeinsam) {
      const nw = zaehleFolge(w, z);
      const nl = zaehleFolge(l, z);
      const eigen = eigenJe.get(z) ?? 0;
      eigenSumme += eigen;
      gemeinsameZeilen += nl;
      gemeinsameAliasiert += nl - Math.min(eigen, nl);
      if (eigen < Math.max(0, nl - nw)) {
        v2Verletzt++;
        if (beispieleV2.length < 3) beispieleV2.push({ w, l, z, nw, nl, eigen });
      }
    }
    if (gemeinsam.length > 0 && eigenSumme === 0) paareOhneEigene++;

    // V1: nur die gemeinsamen Buchstaben betrachten.
    const wS = w.filter((z) => gemeinsam.includes(z));
    const lS = l.filter((z) => gemeinsam.includes(z));
    if (gemeinsam.length > 0 && istTeilfolge(lS, wS)) {
      v1Faelle++;
      if (eigenSumme !== 0) {
        v1Verletzt++;
        if (beispieleV1.length < 3) beispieleV1.push({ w, l, eigenSumme, ziel: r.ziel });
      }
    }
  }
}

console.log(`   Laufzeit ${((Date.now() - t0) / 1000).toFixed(1)} s`);
console.log('');
console.log(`   Paare gesamt                                   ${paare}`);
console.log(`   V1 trifft zu (Verlierer-Folge ist Teilfolge)   ${v1Faelle}`);
console.log(`   V1 VERLETZT                                    ${v1Verletzt}`);
console.log(`   V2 VERLETZT                                    ${v2Verletzt}`);
console.log('');
console.log(`   Paare, in denen KEINE gemeinsame Zeile ein eigenes Item hat: ${paareOhneEigene} / ${paare}` +
  `  = ${((100 * paareOhneEigene) / paare).toFixed(1)} %`);
console.log(`   gemeinsame Zeilen des Verlierers insgesamt: ${gemeinsameZeilen}, davon aliasiert: ${gemeinsameAliasiert}` +
  `  = ${((100 * gemeinsameAliasiert) / gemeinsameZeilen).toFixed(1)} %`);
if (beispieleV1.length) console.log('   V1-Gegenbeispiele: ' + JSON.stringify(beispieleV1));
if (beispieleV2.length) console.log('   V2-Gegenbeispiele: ' + JSON.stringify(beispieleV2));
