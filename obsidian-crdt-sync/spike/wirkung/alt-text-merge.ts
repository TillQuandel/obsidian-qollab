import { diff_match_patch } from 'diff-match-patch';

// Byte Order Mark (U+FEFF). Gehört an Position 0 oder gar nicht hin: mitten im
// Text ist es ein unsichtbares Zeichen, das z. B. unmittelbar vor einem `#` aus
// der Überschrift nach CommonMark einen Absatz macht. Von beiden Merge-Verfahren
// gebraucht.
const BOM = '\uFEFF';

const ohneBom = (text: string): string => (text.startsWith(BOM) ? text.slice(1) : text);

// Jedes Zeilenende auf LF bringen — die Vergleichsfassung beider Merge-Verfahren.
//
// `\r+` statt `\r`: ein doppeltes CR ('\r\r\n') entsteht, wenn eine naive
// LF->CRLF-Umwandlung auf einen Text laeuft, der schon CRLF hat — der Einzeiler
// `-replace "\n", "\r\n"` bzw. `text.replace(/\n/g, '\r\n')`. Gemessen mit
// PowerShell 7: aus 61 0D 0A 62 0D 0A wird 61 0D 0D 0A 62 0D 0D 0A. (Gemessen
// NICHT erzeugt: `git checkout` mit core.autocrlf=true, Set-Content, Out-File.)
// Ein nicht ueberlappendes `replace(/\r\n/g, '\n')` macht daraus '\r\n' — das
// Zeilenende ueberlebt die Normalisierung, und damit steht wieder genau die
// Lage von vor dem 02.08. da: keine Zeile hat eine Entsprechung. Gemessen ohne
// das `+`: `unionMerge` haengt beide Fassungen aneinander (jede Zeile zweimal),
// `threeWayMerge` findet den Kontext des lokalen Hunks nicht wieder und
// verwirft ihn STILL — die lokale Aenderung ist ohne Meldung weg.
// Auf wohlgeformter Eingabe ist `\r+\n` mit `\r\n` deckungsgleich.
const aufLf = (text: string): string => text.replace(/\r+\n/g, '\n');

// Die Vergleichsfassung, die beide Merge-Verfahren intern ohnehin bilden, nach
// außen gegeben: LF-Zeilenenden, kein führendes BOM. Ausschließlich zum
// VERGLEICHEN — nie zum Schreiben. Wer zwei Textstände auf inhaltliche Gleichheit
// prüft, muss dieselbe Normalisierung verwenden wie die Merge-Verfahren, sonst
// beantwortet er eine andere Frage als die, die danach entschieden wird.
export function vergleichsfassung(text: string): string {
  return aufLf(ohneBom(text));
}

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
//
// Zeilenenden und BOM: `patch_make` vergleicht ZEICHENweise, ein `\r` ist dabei
// ein Zeichen wie jedes andere. Stehen `local` und `other` auf verschiedenen
// Zeilenenden, wird die lokale Zeile mit IHREM Zeilenende in die fremde Datei
// gesetzt — gemessen `"# Titel\r\nText.\r\nLokal.\nFremd.\r\n"`: kein Verlust,
// aber ein gemischtes Ergebnis, das über den Datei-Sync auf beide Geräte wandert.
// Das ist nicht kosmetisch: der zeichenweise Diff in crdt-manager.ts erzeugt bei
// einem Zeilenende-Wechsel Operationen über die ganze Datei, und Werkzeuge, die
// auf Zeilenenden achten (Git mit `core.autocrlf`, Linter), sehen Änderungen, die
// inhaltlich keine sind. Ohne lokale Änderung ist der Patch leer und `other` ginge
// unverändert durch — der Zeilenende-Wechsel der Gegenseite kippte dann die ganze
// Datei. Ein BOM verschiebt zusätzlich die Zeichen-Offsets des Patches: gemessen
// `"<BOM># TitelLokal\n\nFremd\n"` — die lokale Zeile klebte an der Überschrift.
//
// Deshalb wie in `unionMerge`: verglichen (und gepatcht) wird auf einer
// LF-Fassung ohne BOM, ausgegeben wird in den Zeilenenden des LOKALEN Standes,
// ein führendes BOM überlebt genau dann, wenn `local` eines hatte. Anders als
// dort gehen lokale Zeilen NICHT byteweise durch: der Patch greift auch
// innerhalb einer Zeile, eine zeilengenaue Rückabbildung auf die Original-Bytes
// gibt es hier nicht. Vorrang hat die Zusage „kein gemischtes Ergebnis" — ein
// bereits gemischter lokaler Stand wird dabei auf sein vorherrschendes
// Zeilenende gezogen.
//
// Die 40000-Zeilen-Grenze von `diff_linesToChars_`, für die `unionMerge` einen
// Rückfallzweig braucht, trifft hier nicht: der Zeilen-Modus ist innerhalb von
// `diff_main` nur eine Beschleunigung, das Ergebnis bleibt ein Zeichen-Diff.
// Diese Funktion bildet keine Diff-Indizes auf Zeilen zurück.
const dmp = new diff_match_patch();

export function threeWayMerge(base: string, local: string, other: string): string {
  const localBom = local.startsWith(BOM);
  const localBody = ohneBom(local);
  // Vergleichsfassung: nur der Inhalt zählt, nicht die Schreibweise.
  const baseLf = aufLf(ohneBom(base));
  const localLf = aufLf(localBody);
  const otherLf = aufLf(ohneBom(other));

  const patches = dmp.patch_make(baseLf, localLf);
  const [merged] = dmp.patch_apply(patches, otherLf);

  const eol = localBody.includes('\r\n') ? '\r\n' : '\n';
  const out = eol === '\n' ? merged : merged.replace(/\n/g, eol);
  return localBom ? BOM + out : out;
}

// Die Textstücke, die der Diff `from` → `to` NEU einfügt — also genau das, was ein
// `patch_make(from, to)` als Insert-Hunk mitführt. Reine Whitespace-Stücke fallen
// weg: sie sind in jedem Text enthalten und würden jede Enthaltensein-Prüfung
// darauf trivial wahr machen.
//
// Gedacht als Entscheidungsgrundlage für die WARNUNG oben: nur der Aufrufer weiß,
// ob eine dieser Einfügungen in `other` bereits steht. Reihenfolge und Position
// gehen bewusst verloren — die Frage ist „welcher Text kommt hinzu", nicht „wo".
export function insertedTexts(from: string, to: string): string[] {
  if (from === to) return [];
  const diffs = dmp.diff_main(from, to);
  dmp.diff_cleanupSemantic(diffs);
  return diffs
    .filter(([op]) => op === diff_match_patch.DIFF_INSERT)
    .map(([, text]) => text)
    .filter((text) => text.trim() !== '');
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
// bewusste Richtung (Wiederauferstehung statt stillem Verlust). Ebenso
// unvermeidbar: umsortierte Zeilen erscheinen doppelt (eine Verschiebung ist
// ohne Basis nicht von „gelöscht + eingefügt" zu unterscheiden).
//
// Zeilenende-Normalisierung (Review C-1): diff_linesToChars_ tokenisiert
// INKLUSIVE Zeilenende — `"b"` und `"b\n"` sind verschiedene Tokens. Endet einer
// der Stände nicht auf `\n` (in Obsidian der Normalfall), fänden die Diffs keine
// gemeinsame Schlusszeile und das `join('')` klebte zwei Zeilen aneinander
// (`"a\nb\nc"` ∪ `"a\nb"` → `"a\nb\ncb"`). Deshalb vor dem Diff beidseitig ein
// Zeilenende garantieren und es hinterher nur dann wieder entfernen, wenn KEINE
// der beiden Seiten eines hatte — sonst würde die Union ein Zeilenende erfinden
// bzw. verschlucken.
//
// CRLF und BOM: Dieselbe Tokenisierung macht `"# Titel\n"` und `"# Titel\r\n"`
// zu verschiedenen Tokens. Zwischen einer LF- und einer CRLF-Fassung DESSELBEN
// Textes hat damit keine einzige Zeile eine Entsprechung, der Kurzschluss
// `other === local` greift wegen der verschiedenen Bytes nicht, und die Union
// hängt beide Fassungen vollständig hintereinander — gemessen 20 + 23 Zeichen
// → 74 bzw. 43, exakt die Summe. Der Weg dorthin ist Alltag: Git-Checkout mit
// `core.autocrlf=true` (Windows-Standard), externer Windows-Editor,
// PowerShell-Export; ein Windows- und ein Mac-Gerät sehen dann systematisch
// verschiedene Zeilenenden für dieselbe Notiz. Ein BOM (U+FEFF) ist für den
// Diff ein gewöhnliches Zeichen der ersten Zeile und wanderte auf demselben Weg
// in die Dateimitte (gemessen: Index 8 statt 0) — die Datei begann ohne
// Kodierungs-Kennzeichnung, und das U+FEFF stand unmittelbar vor dem `#`, womit
// die Überschrift nach CommonMark kein ATX-Heading mehr ist, sondern ein Absatz.
//
// Deshalb: verglichen wird auf einer LF-Fassung ohne BOM, ausgegeben wird in den
// Zeilenenden des LOKALEN Standes. Zeilen, die aus `local` stammen (EQUAL und
// INSERT), gehen byteweise unverändert durch — die Datei wird nicht unnötig
// umgeschrieben, auch nicht bei gemischten Zeilenenden. Nur die Zeilen, die es
// ausschließlich fremd gibt (DELETE), bekommen das lokale Zeilenende, damit die
// Union keine dritte Mischung erzeugt. Ein führendes BOM überlebt genau dann,
// wenn der lokale Stand eines hatte. (Die Konstante `BOM` steht oben, weil
// `threeWayMerge` sie ebenfalls braucht.)

// Zeilen INKLUSIVE Zeilenende; die letzte hat keines, wenn der Text nicht auf
// einem endet.
function splitLines(text: string): string[] {
  const lines: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') {
      lines.push(text.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < text.length) lines.push(text.slice(start));
  return lines;
}

// Garantiertes Zeilenende auf der Schlusszeile (siehe Review C-1 oben).
function padLast(lines: string[], eol: string): string[] {
  if (lines.length > 0 && !lines[lines.length - 1].endsWith('\n')) {
    lines[lines.length - 1] += eol;
  }
  return lines;
}

export function unionMerge(other: string, local: string): string {
  const localBom = local.startsWith(BOM);
  const otherBody = other.startsWith(BOM) ? other.slice(1) : other;
  const localBody = localBom ? local.slice(1) : local;

  // Vergleichsfassung: nur hier zählt der Inhalt, nicht die Schreibweise.
  const otherLf = aufLf(otherBody);
  const localLf = aufLf(localBody);
  // Inhaltlich gleich → lokalen Stand unverändert zurückgeben (kein Write-Back).
  if (otherLf === localLf) return local;

  const eol = localBody.includes('\r\n') ? '\r\n' : '\n';
  const otherNl = otherLf.endsWith('\n');
  const localNl = localLf.endsWith('\n');
  const otherLines = padLast(splitLines(otherLf), '\n');
  const localLines = padLast(splitLines(localLf), '\n');
  // Gleiche Länge wie localLines — die Normalisierung ändert keine Zeilenzahl.
  const localOrig = padLast(splitLines(localBody), eol);

  const { chars1, chars2, lineArray } = dmp.diff_linesToChars_(
    otherLines.join(''),
    localLines.join('')
  );
  const diffs = dmp.diff_main(chars1, chars2, false);

  let merged: string;
  // Ein Zeichen je Zeile — nur dann steht das k-te Zeichen für die k-te Zeile.
  // Ab 40000 verschiedenen Zeilen fasst diff_linesToChars_ den Rest zu EINEM
  // Token zusammen (harte Grenze in diff-match-patch); dann trägt der Index
  // nicht mehr, und die Rückabbildung liefe zeilenversetzt. Für diesen Fall der
  // ältere Weg: über lineArray zurück und die Zeilenenden pauschal angleichen.
  if (chars1.length === otherLines.length && chars2.length === localLines.length) {
    const out: string[] = [];
    let i = 0;
    let j = 0;
    for (const [op, chars] of diffs) {
      const n = chars.length;
      if (op === diff_match_patch.DIFF_DELETE) {
        for (let k = 0; k < n; k++) out.push(otherLines[i + k].slice(0, -1) + eol);
        i += n;
      } else {
        for (let k = 0; k < n; k++) out.push(localOrig[j + k]);
        j += n;
        if (op === diff_match_patch.DIFF_EQUAL) i += n;
      }
    }
    merged = out.join('');
  } else {
    dmp.diff_charsToLines_(diffs, lineArray);
    merged = diffs
      .map(([, text]) => text)
      .join('')
      .replace(/\n/g, eol);
  }

  if (!otherNl && !localNl) {
    if (merged.endsWith('\r\n')) merged = merged.slice(0, -2);
    else if (merged.endsWith('\n')) merged = merged.slice(0, -1);
  }
  return localBom ? BOM + merged : merged;
}
