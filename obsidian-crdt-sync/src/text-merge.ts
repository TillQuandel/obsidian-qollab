import { diff_match_patch } from 'diff-match-patch';

// 3-Wege-Text-Merge: die lokale Änderung (Diff base → local) wird als Patch auf
// den bereits gemergten other-Stand angewandt. diff-match-patch wendet Patches
// fuzzy an: bei direkt überlappenden Edits setzt sich die lokale Änderung durch
// (die Remote-Änderung dieser Stelle geht verloren); verschiebt der Remote-Edit
// den Kontext stark (Heuristik: ≥ ~500 Zeichen, Match_Distance 1000 / Threshold
// 0.5), wird der lokale Hunk still verworfen (dann überlebt der Remote-Stand an
// dieser Stelle, der nächste Task konvergiert). Nötig, weil ein Volltext-Diff
// gegen den (bereits Remote-gemergten) Doc die Remote-Änderung zurückrollen würde;
// base=preMerge macht daraus die reine lokale Delta-Anwendung.
//
// WARNUNG: patch_make(base, local) enthält auch Einfügungen, die other bereits hat
// (local ⊇ other-Edit). patch_apply dedupliziert NICHT — es fügt sie erneut ein
// (Verdopplung). Aufrufer müssen den Fall `local === other` deshalb vorher
// abfangen (kein Patch nötig) statt threeWayMerge blind aufzurufen.
const dmp = new diff_match_patch();

export function threeWayMerge(base: string, local: string, other: string): string {
  const patches = dmp.patch_make(base, local);
  const [merged] = dmp.patch_apply(patches, other);
  return merged;
}

// Vereinigt zwei Textstände OHNE gemeinsamen Vorfahren: alles, was nur eine der
// beiden Seiten kennt, bleibt erhalten, Gemeinsames bleibt einmal stehen.
//
// Genau diese Lage herrscht beim Inkarnationswechsel (switchToGuid) und beim
// Adoptieren einer fremden Inkarnation (ensureDoc): die beiden Yjs-Historien
// haben keine gemeinsame Wurzel. Damit ist threeWayMerge hier NICHT anwendbar —
// als Basis käme nur der eigene Stand (.md oder Doc) infrage, und sobald beide
// gleich sind (der Normalfall), ist der Patch leer und der gesamte lokale
// Beitrag fiele weg. Ein 2-Wege-`setContent` löscht umgekehrt alles, was nur die
// Gegenseite kennt — und schreibt diese Löschung als Delete-Op, die über den
// nächsten Merge zurückpropagiert.
//
// Zeilen-Modus (diff_linesToChars_): ein Zeichen-Diff würde geänderte Zeilen
// ineinander verschränken (`ZBoeile…`); zeilenweise bleiben beide Fassungen als
// ganze Zeilen stehen. Preis der fehlenden Basis: eine nur auf einer Seite
// gelöschte Zeile, die die andere Inkarnation noch führt, kommt zurück —
// bewusste Richtung (Wiederauferstehung statt stillem Verlust).
export function unionMerge(other: string, local: string): string {
  if (other === local) return other;
  const { chars1, chars2, lineArray } = dmp.diff_linesToChars_(other, local);
  const diffs = dmp.diff_main(chars1, chars2, false);
  dmp.diff_charsToLines_(diffs, lineArray);
  return diffs.map(([, text]) => text).join('');
}
