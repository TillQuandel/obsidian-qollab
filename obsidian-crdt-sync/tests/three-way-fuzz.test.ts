import { threeWayMerge, MELDE_MARKE } from '../src/text-merge';

// Der Fuzzy-Patcher zerstoert Grundtext — und der Verwurf muss sichtbar werden
//
// `patch_apply` sucht die Stelle eines Hunks unscharf (`match_main`). Findet es
// eine Stelle, deren Kontext NICHT zeichengleich mit dem erwarteten ist, laeuft
// es in den `imperfect match`-Zweig (diff-match-patch 1.0.5, index.js:1869-1899):
// Es rechnet einen Diff zwischen erwartetem und tatsaechlichem Kontext und
// uebersetzt die Op-Indizes per `diff_xIndex`. Die Ops landen dann an
// verschobener Stelle — und loeschen dort aus einer Zeile, die niemand angefasst
// hat.
//
// Der Fixture unten ist NICHT konstruiert, sondern aus dem Messlauf gezogen
// (`spike/schnitt/probe-fuzz.mjs`, Seed 3): Die lokale Ergaenzung `|n0-D0-9`
// gehoert an `n0-base-6`. Der Fuzz haengt sie an `n0-base-4` — damit ist
// `n0-base-4` als Zeile zerstoert, obwohl base, local UND other sie alle drei
// unveraendert tragen. Das ist K.o.-Kriterium 1.
//
// ZUSAGE nach dem Fix, in drei Teilen:
//   1. Ein Hunk wird nur noch an einer Stelle mit zeichengleichem Kontext
//      angewandt. Grundtext, den alle drei Staende tragen, ueberlebt.
//   2. Ein Hunk, der so nicht einsortierbar ist, verschwindet NICHT still — er
//      wird als sichtbarer Block angehaengt (Gruppe 5, „Sichtbarkeit statt
//      Stille").
//   3. Die Meldung ist idempotent: steht der Block schon da, kommt er nicht ein
//      zweites Mal dazu. Ohne diese Pruefung waechst der Text bei jedem Merge.

const zaehle = (text: string, teil: string) => text.split(teil).length - 1;

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

describe('threeWayMerge — der verschobene Fuzzy-Hunk', () => {
  it('zerstoert keine Grundtextzeile, die alle drei Staende tragen', () => {
    const merged = threeWayMerge(base, local, other);
    const zeilen = merged.split('\n');

    // Gemessener Schaden vor dem Fix: `n0-base-4|n0-D0-9` — die Ergaenzung sitzt
    // zwei Zeilen zu hoch, und `n0-base-4` steht nicht mehr als eigene Zeile da.
    expect(zeilen).toContain('n0-base-4');
    // Die fremden Ergaenzungen bleiben unberuehrt.
    expect(zeilen).toContain('n0-base-5|n0-D1-4');
    expect(zeilen).toContain('n0-base-6|n0-D1-0');
  });

  it('verliert die lokale Aenderung nicht still, sondern meldet sie', () => {
    const merged = threeWayMerge(base, local, other);

    // Sie ist nicht einsortierbar (ihr Kontext existiert in `other` nicht mehr
    // zeichengleich) — aber sie muss auffindbar bleiben.
    expect(merged).toContain('n0-D0-9');
    expect(merged).toContain(MELDE_MARKE);
  });

  it('meldet denselben Hunk kein zweites Mal (Idempotenz)', () => {
    // Rechnet ein zweites Geraet denselben Merge auf dem ERGEBNIS des ersten,
    // steht der Block dort bereits. Ohne Pruefung waechst der Text bei jedem
    // Merge weiter — dieselbe Bauart wie die nicht-idempotente Ersetzung in
    // crdt-manager.ts, die im August behoben wurde.
    const eins = threeWayMerge(base, local, other);
    const zwei = threeWayMerge(base, local, eins);
    const drei = threeWayMerge(base, local, zwei);

    expect(zaehle(zwei, MELDE_MARKE)).toBe(1);
    expect(zaehle(drei, MELDE_MARKE)).toBe(1);
    expect(drei.length).toBe(zwei.length);
    // Und der unberuehrte Grundtext haelt auch ueber drei Runden. Geprueft wird
    // nur, was alle drei Staende UNVERAENDERT tragen: `n0-base-5` und
    // `n0-base-6` hat der fremde Stand legitim zu `n0-base-5|n0-D1-4` bzw.
    // `n0-base-6|n0-D1-0` erweitert — sie als eigene Zeile zu erwarten, waere
    // falsch.
    const unberuehrt = BASIS.filter(
      (z) => local.split('\n').includes(z) && other.split('\n').includes(z)
    );
    expect(unberuehrt.length).toBeGreaterThan(0);
    for (const zeile of unberuehrt) expect(drei.split('\n')).toContain(zeile);
  });

  it('haengt nichts an, wenn jeder Hunk einsortierbar ist', () => {
    // Gegenprobe: der Pruefer darf nicht immer melden. Hier passt der Kontext,
    // der Block hat nichts zu suchen.
    const merged = threeWayMerge('a\n', 'a\nLokal\n', 'a\nFremd\n');
    expect(merged).not.toContain(MELDE_MARKE);
    expect(merged).toContain('Lokal');
    expect(merged).toContain('Fremd');
  });
});
