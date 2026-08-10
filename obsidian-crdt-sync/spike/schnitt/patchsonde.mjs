// Zaehlwerk und Varianten fuer den Fuzzy-`patch_apply` aus diff-match-patch.
//
// HINTERGRUND. `threeWayMerge` (src/text-merge.ts:88) ist der einzige Ort im
// Produktivcode, der `patch_apply` benutzt, und `patch_apply` ist der einzige
// Ort, der `match_main` ruft. Der Produktivcode wirft den ZWEITEN Rueckgabewert
// von `patch_apply` weg (`const [merged] = ...`) — genau dort steht aber, welche
// Hunks NICHT angewandt wurden. Der stille Verwurf ist damit heute schon
// messbar, er wird nur nirgends gezaehlt.
//
// WO DER SCHADEN ENTSTEHT (index.js:1869-1899, Version 1.0.5, selbst gelesen):
// Nicht beim Finden, sondern beim Anwenden. Findet `match_main` eine Stelle,
// deren Kontext NICHT zeichengleich mit dem erwarteten ist (`text1 != text2`),
// laeuft `patch_apply` in den `imperfect match`-Zweig: es rechnet einen Diff
// zwischen erwartetem und tatsaechlichem Kontext und uebersetzt die Op-Indizes
// per `diff_xIndex`. Eine DELETE-Op landet dann an einer verschobenen Stelle und
// loescht Zeichen aus einer unberuehrten Zeile. Beim perfekten Treffer
// (`text1 == text2`, Zeile 1864) wird der Ersatztext schlicht eingesetzt — dort
// kann nichts wandern.
//
// `patch_splitMax` zerlegt jeden Patch auf hoechstens `Match_MaxBits` = 32
// Zeichen `text1` (index.js:53). Die Kontextpruefung
// `text.substr(p, pattern.length) === pattern` ist damit VOLLSTAENDIG — sie
// deckt denselben Vergleich ab, den `patch_apply` intern anstellt. (Nur beim
// „monster delete" ueber 32 Zeichen prueft sie den 32-Zeichen-Ausschnitt; dort
// ist sie konservativ, nie zu lax.)
//
// GEZAEHLT WIRD (Namen wie in der Ausgabe):
//   paRuf    Aufrufe von `patch_apply` mit mindestens einem Patch
//   paHunk   Hunks insgesamt (nach `patch_splitMax`, also `results.length`)
//   paWeg    davon NICHT angewandt (`results[i] === false`) — der stille Verwurf
//   mmRuf    Aufrufe von `match_main`
//   mmNix    davon ohne Treffer (-1) — der Hunk faellt aus
//   mmKrumm  davon MIT Treffer, aber der Kontext dort ist NICHT zeichengleich
//            — das ist der Schadensfall, die Ops werden umindiziert
//   mmVers   davon an einer anderen Stelle als der erwarteten (orthogonal zu
//            mmKrumm: eine Verschiebung mit exaktem Kontext ist harmlos)
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export const pz = {
  paRuf: 0, paHunk: 0, paWeg: 0, paGemeldet: 0,
  mmRuf: 0, mmNix: 0, mmKrumm: 0, mmVers: 0,
};

export function sondeZurueck() {
  for (const k of Object.keys(pz)) pz[k] = 0;
}

// Das exakte Vorkommen von `pattern`, das `loc` am naechsten liegt. `indexOf`
// allein nimmt immer das ERSTE Vorkommen im ganzen Text — bei wiederholten
// Zeilen kann das beliebig weit von der erwarteten Stelle wegspringen.
function naechstesVorkommen(text, pattern, loc) {
  if (pattern.length === 0) return loc;
  let best = -1;
  let bestAbstand = Infinity;
  let i = text.indexOf(pattern);
  while (i !== -1) {
    const d = Math.abs(i - loc);
    // `i` waechst monoton; sobald der Abstand wieder steigt, ist das Minimum
    // passiert und weitere Vorkommen liegen nur noch weiter weg.
    if (d >= bestAbstand) break;
    bestAbstand = d;
    best = i;
    i = text.indexOf(pattern, i + 1);
  }
  return best;
}

// VARIANTEN
//   bestand    nichts aendern, nur zaehlen (Standard)
//   kein-fuzz  `match_main` -> `indexOf`. Die Gegenprobe aus der Akte, wortgleich
//              uebernommen aus verlustort.mjs:211-216.
//   exakt-nah  wie kein-fuzz, aber das der erwarteten Stelle NAECHSTE exakte
//              Vorkommen statt des ersten im Text.
//   nur-exakt  Der Fuzz darf weiter suchen und verschieben — angewandt wird ein
//              Hunk aber nur, wenn der Kontext an der gefundenen Stelle
//              zeichengleich ist. Trifft genau den `imperfect match`-Zweig und
//              laesst die harmlose Verschiebung stehen.
//   melden     wie `nur-exakt`, aber ein verworfener Hunk verschwindet nicht:
//              seine Einfuegungen werden als sichtbarer Block an den Text
//              gehaengt. Gruppe 5 des Produktziels — Sichtbarkeit statt Stille.
//              KEINE Produktivfassung: der Block ist hier nur so weit
//              ausgearbeitet, dass die Messung den Unterschied sieht.
const MARKE = '<!-- qollab: nicht einsortierbare lokale Aenderung -->';
// Das Null-Padding von `patch_addPadding` (index.js:1916-1930) sind die
// Steuerzeichen U+0001..U+0004. Zur Laufzeit gebaut, damit keine Escape-Sequenz
// im Quelltext steht, die ein Werkzeug still in echte Steuerzeichen wandelt.
const PADDING = new RegExp('[' + String.fromCharCode(1, 2, 3, 4) + ']', 'g');

export function sondeInstalliere(variante = 'bestand') {
  const DMPmod = require('diff-match-patch');
  const proto = DMPmod.diff_match_patch.prototype;
  const origMatch = proto.match_main;
  const origApply = proto.patch_apply;

  const finde = {
    bestand: (self, text, pattern, loc) => origMatch.call(self, text, pattern, loc),
    'kein-fuzz': (self, text, pattern) => text.indexOf(pattern),
    'exakt-nah': (self, text, pattern, loc) => naechstesVorkommen(text, pattern, loc),
    'nur-exakt': (self, text, pattern, loc) => {
      const p = origMatch.call(self, text, pattern, loc);
      if (p === -1) return -1;
      return text.substr(p, pattern.length) === pattern ? p : -1;
    },
  };
  finde['melden'] = finde['nur-exakt'];
  finde['melden-voll'] = finde['nur-exakt'];
  finde['melden-idem'] = finde['nur-exakt'];
  const suche = finde[variante];
  if (!suche) throw new Error(`unbekannte patch-Variante: ${variante}`);
  const meldet = variante.startsWith('melden');
  // GEMESSEN (probe-melden-idempotenz.mjs): Ohne diese Pruefung ist die Meldung
  // NICHT idempotent. Rechnet ein zweites Geraet den Merge auf dem Ergebnis des
  // ersten, haengt es denselben Block ein zweites Mal an — 121 -> 186 -> 251
  // Zeichen ueber drei Runden. Das ist dieselbe Bauart wie die im August
  // behobene nicht-idempotente Ersetzung, nur mit wachsendem Anhang statt
  // zerstoertem Grundtext.
  const dedupliziert = variante === 'melden-idem';
  // `melden`      nur die Einfuegungen des Hunks. Sparsam, aber zeichenweise
  //               zerschnitten: aus `n0-D0-3` wird `D0-3`, weil der Hunk an
  //               einer Zeichengrenze endet (belegt an Seed 74 der probe-fuzz).
  // `melden-voll` der vollstaendige Zieltext des Hunks samt Kontext. Die Tokens
  //               bleiben ganz, dafuer wandert Kontext — also auch Grundtext —
  //               in den Block und wird verdoppelt.
  // `melden-idem` ist die Zusammenfuehrung der beiden besseren Haelften: der
  // vollstaendige Hunk (Tokens bleiben ganz) UND die Dedup-Pruefung.
  const vollerHunk = variante === 'melden-voll' || variante === 'melden-idem';

  proto.match_main = function (text, pattern, loc) {
    const p = suche(this, text, pattern, loc);
    pz.mmRuf++;
    if (p === -1) {
      pz.mmNix++;
    } else {
      if (p !== loc) pz.mmVers++;
      if (text.substr(p, pattern.length) !== pattern) pz.mmKrumm++;
    }
    return p;
  };

  proto.patch_apply = function (patches, text) {
    const erg = origApply.call(this, patches, text);
    const results = erg[1];
    if (results.length > 0) {
      pz.paRuf++;
      pz.paHunk += results.length;
      for (const ok of results) if (!ok) pz.paWeg++;

      if (meldet && results.some((ok) => !ok)) {
        // Dieselbe Vorverarbeitung, die `patch_apply` intern durchlaeuft
        // (index.js:1815-1820: deepCopy -> addPadding -> splitMax). Erst danach
        // zeigen die Indizes von `results` auf dieselben Hunks. Sie ist
        // deterministisch, die Wiederholung liefert also dieselbe Zerlegung.
        const k = this.patch_deepCopy(patches);
        this.patch_addPadding(k);
        this.patch_splitMax(k);
        const bloecke = [];
        for (let i = 0; i < results.length; i++) {
          if (results[i] || !k[i]) continue;
          const neu = k[i].diffs
            .filter(([op]) => (vollerHunk ? op !== -1 : op === 1))
            .map(([, t]) => t)
            .join('')
            // Das Null-Padding von `patch_addPadding` sind die Steuerzeichen
            // U+0001..U+0004; sie duerfen nie im sichtbaren Text landen.
            .replace(PADDING, '');
          if (neu.trim() === '') continue;
          // Steht der Block schon im Text, wurde er bereits gemeldet — von
          // diesem Geraet oder von einem anderen, dessen Stand hier angekommen
          // ist. Ein zweites Anhaengen traegt nichts nach und laesst den Text
          // bei jedem Merge weiterwachsen.
          if (dedupliziert && erg[0].includes(neu)) continue;
          bloecke.push(neu);
        }
        if (bloecke.length > 0) {
          pz.paGemeldet += bloecke.length;
          erg[0] = `${erg[0]}\n${MARKE}\n${bloecke.join('\n')}\n`;
        }
      }
    }
    return erg;
  };
}

export function sondeZeile() {
  return `paRuf=${pz.paRuf} paHunk=${pz.paHunk} paWeg=${pz.paWeg} paGemeldet=${pz.paGemeldet}` +
    ` mmRuf=${pz.mmRuf} mmNix=${pz.mmNix} mmKrumm=${pz.mmKrumm} mmVers=${pz.mmVers}`;
}
