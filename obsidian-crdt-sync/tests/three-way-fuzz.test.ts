import { threeWayMerge } from '../src/text-merge';

// Der verschobene Fuzzy-Hunk — zerstoerter Grundtext
//
// Bis zum 2026-08-11 setzte `threeWayMerge` den lokalen Stand per
// `patch_apply` auf den fremden. `patch_apply` sucht die Stelle eines Hunks
// unscharf (`match_main`). Findet es eine Stelle, deren Kontext NICHT
// zeichengleich mit dem erwarteten ist, laeuft es in den `imperfect match`-Zweig
// (diff-match-patch 1.0.5, index.js:1869-1899): Es rechnet einen Diff zwischen
// erwartetem und tatsaechlichem Kontext und uebersetzt die Op-Indizes per
// `diff_xIndex`. Die Ops landen dann an verschobener Stelle — und veraendern
// dort eine Zeile, die niemand angefasst hat.
//
// Die Fixture unten ist NICHT konstruiert, sondern aus einem Messlauf gezogen
// (`spike/schnitt/probe-fuzz.mjs`, Seed 3) und am echten Produkt reproduziert:
// Die lokale Ergaenzung `|n0-D0-9` gehoert an `n0-base-6`. Der Fuzz haengte sie
// an `n0-base-4` — damit war `n0-base-4` als Zeile zerstoert, obwohl base,
// local UND other sie alle drei unveraendert tragen. Das ist K.o.-Kriterium 1
// („Grundtext darf nie zerstoert werden").
//
// Warum nicht einfach der exakte Treffer statt des Fuzz: das Abschalten allein
// liess den Alltagsfall fallen (zwei unabhaengige Ergaenzungen an derselben
// Stelle) — deshalb der zeilenweise 3-Wege-Merge, und deshalb die Gegenprobe
// unten.
//
// Belegt, dass diese Fixture die Schadensklasse ueberhaupt trifft:
// `node spike/wirkung/bauen.mjs && node spike/wirkung/kalibrierung.mjs` faehrt
// sie gegen die alte und die heutige Fassung nebeneinander.

const BASIS = [
  'n0-base-0', 'n0-base-1', 'n0-base-2', 'n0-base-3',
  'n0-base-4', 'n0-base-5', 'n0-base-6', 'n0-base-7',
];
const base = BASIS.join('\n') + '\n';
// Lokal: `|n0-D0-9` an n0-base-6 angehaengt.
const local = [
  'n0-base-0', 'n0-base-1', 'n0-base-2', 'n0-base-3',
  'n0-base-4', 'n0-base-5', 'n0-base-6|n0-D0-9', 'n0-base-7',
].join('\n') + '\n';
// Fremd: zwei andere Ergaenzungen plus eine neue Schlusszeile — dadurch findet
// der Kontext des lokalen Hunks keine zeichengleiche Entsprechung mehr.
const other = [
  'n0-base-0', 'n0-base-1', 'n0-base-2', 'n0-base-3',
  'n0-base-4', 'n0-base-5|n0-D1-4', 'n0-base-6|n0-D1-0', 'n0-base-7', 'n0-D1-6',
].join('\n') + '\n';

// Geprueft wird nur, was ALLE DREI Staende unveraendert tragen. `n0-base-5` und
// `n0-base-6` hat der fremde Stand legitim zu `n0-base-5|n0-D1-4` bzw.
// `n0-base-6|n0-D1-0` erweitert — sie als eigene Zeile zu erwarten waere
// falsch. Abgeleitet statt hart geschrieben, damit die Liste nicht davon
// driften kann, was die Fixture tatsaechlich sagt.
const lokalZeilen = local.split('\n');
const fremdZeilen = other.split('\n');
const unberuehrt = BASIS.filter((z) => lokalZeilen.includes(z) && fremdZeilen.includes(z));

describe('threeWayMerge — der verschobene Fuzzy-Hunk', () => {
  it('laesst Grundtext stehen, den alle drei Staende unveraendert tragen', () => {
    const zeilen = threeWayMerge(base, local, other).split('\n');

    expect(unberuehrt.length).toBeGreaterThan(0);
    for (const zeile of unberuehrt) expect(zeilen).toContain(zeile);
  });

  it('haengt die lokale Ergaenzung nicht an die falsche Zeile', () => {
    const merged = threeWayMerge(base, local, other);

    // Der gemessene Schaden am alten Build, zeichengleich: die Ergaenzung sass
    // zwei Zeilen zu hoch. Pinnt den konkreten Fehler, nicht nur sein Symptom.
    expect(merged).not.toContain('n0-base-4|n0-D0-9');
    // Und sie geht dabei nicht verloren.
    expect(merged).toContain('n0-D0-9');
  });

  it('behaelt beim Alltagsfall beide Beitraege', () => {
    // Gegenprobe zum Fix: „nur noch exakt suchen" haette den Grundtext gerettet
    // und diesen Fall fallen lassen. Zwei unabhaengige Einfuegungen an
    // derselben Stelle muessen beide ueberleben — die Reihenfolge ist bewusst
    // festgelegt (siehe three-way-line-endings.test.ts), hier nicht geprueft.
    const merged = threeWayMerge('a\n', 'a\nLokal\n', 'a\nFremd\n');

    expect(merged).toContain('Lokal');
    expect(merged).toContain('Fremd');
  });
});
