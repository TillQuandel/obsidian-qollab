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

// Der Fuzz sitzt NICHT im Finden, sondern im Anwenden (diff-match-patch 1.0.5,
// index.js:1864-1899, selbst gelesen). Trifft `match_main` eine Stelle, deren
// Kontext zeichengleich ist, wird der Ersatztext schlicht eingesetzt — dort kann
// nichts wandern, auch wenn der Hunk verschoben wurde. Weicht der Kontext ab
// (`text1 != text2`), rechnet `patch_apply` einen Diff zwischen erwartetem und
// tatsächlichem Kontext und übersetzt die Op-Indizes per `diff_xIndex`. Genau
// dann landet eine Op an verschobener Stelle und löscht aus einer Zeile, die
// niemand angefasst hat.
//
// Gemessen (`spike/schnitt/`, 8 Zellen à 200 Seeds, Bericht
// `.superpowers/sdd/patch-apply-2026-08-11.md`): Über alle Zellen zerstörte der
// Fuzz 23 Grundtextzeilen; der Verwurf, den er dabei vermeidet, ist NULL — über
// 4283 Hunks war `results[i] === false` kein einziges Mal wahr. Der Fuzz erkauft
// also nichts, er kostet nur.
//
// Deshalb eine eigene Instanz, die wie bisher sucht, aber nur an einer Stelle
// mit ZEICHENGLEICHEM Kontext anwendet. `patch_splitMax` deckelt `text1` bei
// `Match_MaxBits` = 32 Zeichen; die Prüfung deckt damit denselben Vergleich ab,
// den `patch_apply` intern anstellt. Instanz statt Prototyp, damit keine andere
// Nutzung der Bibliothek im selben Prozess mitverstellt wird.
const dmpExakt = new diff_match_patch();
dmpExakt.match_main = function (text: string, pattern: string, loc: number): number {
  const p = dmp.match_main(text, pattern, loc);
  if (p === -1) return -1;
  return text.substr(p, pattern.length) === pattern ? p : -1;
};

// Die Marke über einem gemeldeten Block. Sichtbar und nicht als HTML-Kommentar:
// Obsidian blendet Kommentare in der Vorschau aus, und ein Hinweis, den niemand
// sieht, ist wieder stiller Verlust.
export const MELDE_MARKE = '**Qollab — local change that could not be placed:**';

// Das Null-Padding von `patch_addPadding` (index.js:1916-1930) sind die
// Steuerzeichen U+0001..U+0004. Zur Laufzeit gebaut, damit keine Escape-Sequenz
// im Quelltext steht, die ein Werkzeug still in echte Steuerzeichen wandelt.
const PADDING = new RegExp('[' + String.fromCharCode(1, 2, 3, 4) + ']', 'g');

// Was `patch_apply` NICHT einsortieren konnte, als anhängbarer Block.
//
// Ohne diesen Nachtrag verschwände jeder nicht platzierbare Hunk wortlos — die
// Zusage aus `docs/produktziel.md` Gruppe 5 („Sichtbarkeit statt Stille") wäre
// verletzt, und die exakte Suche wäre nur ein Tausch der Schadensart:
// gemessen +35,4 % Gesamt-Textverlust gegenüber dem Fuzz, unter
// `mdModus: 'ueberschreiben'` +73 %.
//
// Die Dedup-Prüfung ist NICHT kosmetisch: Ohne sie hängt ein zweites Gerät, das
// denselben Merge auf dem Ergebnis des ersten rechnet, denselben Block erneut an
// — gemessen 121 → 186 → 251 Zeichen über drei Runden. Das ist dieselbe Bauart
// wie die nicht-idempotente Ersetzung in `crdt-manager.ts`.
function nichtEinsortiert(
  patches: ReturnType<typeof dmpExakt.patch_make>,
  gemergt: string,
  angewandt: boolean[],
  zurueck: (chars: string) => string,
  zerlegen: boolean
): string {
  if (angewandt.every(Boolean)) return '';

  // Im Token-Zweig wird Hunk für Hunk angewandt; dort zeigen die Flags schon auf
  // die übergebenen Patches. Nur im Rückfallzweig läuft `patch_apply` über alle
  // auf einmal und zerlegt dabei intern (index.js:1815-1820: deepCopy →
  // addPadding → splitMax) — dann muss dieselbe Vorverarbeitung wiederholt
  // werden, damit die Indizes passen. Sie ist deterministisch.
  let zerlegt = patches;
  if (zerlegen) {
    zerlegt = dmp.patch_deepCopy(patches);
    dmp.patch_addPadding(zerlegt);
    dmp.patch_splitMax(zerlegt);
  }

  const bloecke: string[] = [];
  for (let i = 0; i < angewandt.length; i++) {
    if (angewandt[i] || !zerlegt[i]) continue;
    // Der Zieltext des Hunks OHNE seine Löschungen — also das, was der lokale
    // Stand an dieser Stelle hätte. Der umgebende Kontext bleibt drin, sonst
    // stünden nur Zeichenfragmente im Block (gemessen: `D0-3` statt `n0-D0-3`).
    const roh = (zerlegt[i] as unknown as { diffs: [number, string][] }).diffs
      .filter(([op]) => op !== diff_match_patch.DIFF_DELETE)
      .map(([, text]) => text)
      .join('')
      .replace(PADDING, '');
    const stueck = zurueck(roh);
    if (stueck.trim() === '') continue;
    if (gemergt.includes(stueck) || bloecke.includes(stueck)) continue;
    bloecke.push(stueck);
  }

  if (bloecke.length === 0) return '';
  const zeilen = bloecke.map((b) => (b.endsWith('\n') ? b : b + '\n')).join('');
  return `\n${MELDE_MARKE}\n${zeilen}`;
}

// Zeilen-Tokenisierung über DREI Texte zugleich.
//
// `diff_linesToChars_` der Bibliothek kann nur zwei Texte; hier müssen base,
// local und other DIESELBE Zuordnung Zeile → Zeichen bekommen, sonst stünde
// dasselbe Zeichen in zwei Fassungen für verschiedene Zeilen.
//
// Der Grund für die Tokenisierung: Ein Zeichen-Patch legt seine Ops über
// Zeilengrenzen. Sobald zwei Zeilen ein gemeinsames Präfix teilen — jede
// Aufzählung, jede Überschriftenfolge, jede Checkbox-Liste —, kann eine
// verschobene Op mitten in eine unbeteiligte Zeile greifen und sie verändern.
// Gemessen (`probe-fuzz.mjs`, Seed 3): Die lokale Ergänzung `|n0-D0-9` gehörte
// an `n0-base-6` und landete an `n0-base-4`; damit war `n0-base-4` als Zeile
// zerstört, ohne dass eine einzige DELETE-Op im Spiel war.
//
// Auf Token-Ebene ist das ausgeschlossen: Eine Op deckt ganze Zeilen, eine
// Einfügung kann eine bestehende Zeile nicht mehr aufbrechen. Das ist dieselbe
// Richtung, die `CrdtManager.diffOps` seit `diffModus = 'zeile'` geht.
//
// Die Grenze: Ein Token ist ein UTF-16-Code-Unit. Oberhalb von U+D7FF beginnen
// die Surrogat-Hälften; ab dort wäre ein Token kein eigenständiges Zeichen mehr.
// Deshalb der Rückfall auf den Zeichen-Patch bei sehr vielen VERSCHIEDENEN
// Zeilen — dieselbe Bauart wie `zeilenModusSchwelle` in `crdt-manager.ts`.
const ZEILEN_GRENZE = 55000;

// Die ersten Codepoints bleiben FREI: `patch_addPadding` (index.js:1916-1930)
// setzt U+0001..U+0004 als Null-Padding an die Ränder. Vergäbe die
// Tokenisierung dieselben Werte, wäre Token Nr. 1 vom Padding nicht zu
// unterscheiden — gemessen führte das dazu, dass eine echte Zeile beim
// Zurückwandeln verschwand.
const TOKEN_BASIS = 8;

function tokenisiere(texte: string[]): { chars: string[]; zeilen: string[] } | null {
  const index = new Map<string, number>();
  const zeilen: string[] = [];
  const chars: string[] = [];
  for (const text of texte) {
    let aus = '';
    for (const zeile of splitLines(text)) {
      let i = index.get(zeile);
      if (i === undefined) {
        if (zeilen.length >= ZEILEN_GRENZE) return null;
        i = zeilen.length;
        zeilen.push(zeile);
        index.set(zeile, i);
      }
      aus += String.fromCharCode(i + TOKEN_BASIS);
    }
    chars.push(aus);
  }
  return { chars, zeilen };
}

function zaehleTokens(chars: string): Map<string, number> {
  const anzahl = new Map<string, number>();
  for (const c of chars) anzahl.set(c, (anzahl.get(c) ?? 0) + 1);
  return anzahl;
}

// Hat der Merge eine Zeile verloren, die `other` trägt und die der lokale Stand
// gar nicht löschen wollte?
//
// Legitime Verluste gibt es: Was zwischen `base` und `local` verschwunden ist,
// hat der Nutzer selbst gelöscht — das darf der Patch nachvollziehen. Alles
// darüber hinaus hat niemand angefasst, und es zu verlieren ist K.o.-Kriterium 1.
//
// Verglichen wird auf Vielfachheiten, nicht auf Mengen: Eine Zeile, die zweimal
// dastand und nur noch einmal dasteht, ist zur Hälfte verloren.
// Die Prüfung sitzt bewusst PRO HUNK, nicht pro Merge.
//
// Ein Rückfall über den ganzen Merge ist zu grob, und das ist gemessen: Er
// verwirft mit dem schädlichen Hunk auch alle harmlosen — darunter die
// LÖSCHUNGEN. Der Test „Offline-Loeschung: die geloeschte Zeile kehrt nicht
// zurueck" fiel genau daran, weil die gelöschte Zeile mit dem verworfenen
// Lösch-Hunk zurückkam. Gruppe 1 verlangt beides: gelöschter Text bleibt
// gelöscht, unberührter Text bleibt stehen.
//
// Erlaubt ist einem Hunk exakt, was seine eigenen DELETE-Ops sagen. Verschwindet
// darüber hinaus eine Zeile, hat er sie mitgerissen.
function reisstMit(
  hunk: { diffs: [number, string][] },
  vorherC: string,
  nachherC: string
): boolean {
  const darfWeg = zaehleTokens(
    hunk.diffs
      .filter(([op]) => op === diff_match_patch.DIFF_DELETE)
      .map(([, t]) => t)
      .join('')
  );
  const vorher = zaehleTokens(vorherC);
  const nachher = zaehleTokens(nachherC);
  for (const [token, hatte] of vorher) {
    const blieb = nachher.get(token) ?? 0;
    if (blieb >= hatte) continue;
    if (hatte - blieb > (darfWeg.get(token) ?? 0)) return true;
  }
  return false;
}

export function threeWayMerge(base: string, local: string, other: string): string {
  const localBom = local.startsWith(BOM);
  const localBody = ohneBom(local);
  // Vergleichsfassung: nur der Inhalt zählt, nicht die Schreibweise.
  const baseLf = aufLf(ohneBom(base));
  const localLf = aufLf(localBody);
  const otherLf = aufLf(ohneBom(other));

  const tok = tokenisiere([baseLf, localLf, otherLf]);
  // Identität als Rückabbildung, wenn zeichenweise gepatcht wird.
  const zurueck = tok
    ? (chars: string) =>
        Array.from(chars, (c) => tok.zeilen[c.charCodeAt(0) - TOKEN_BASIS] ?? '').join('')
    : (chars: string) => chars;
  const [a, b, c] = tok ? tok.chars : [baseLf, localLf, otherLf];

  // Der Fuzz bleibt — und er SOLL bleiben. Gemessen ist er in der Mehrzahl der
  // Fälle im Recht: Er platziert einen Hunk, dessen Kontext sich verschoben hat,
  // an der sachlich richtigen Stelle. Die exakte Suche verwirft genau diese
  // Fälle mit; sie kostet dadurch +35,4 % Gesamt-Textverlust, und selbst der
  // Alltagsfall `threeWayMerge('a\n', 'a\nLokal\n', 'a\nFremd\n')` landete damit
  // im Meldeblock statt im Text.
  //
  // Gefährlich war nicht der Fuzz, sondern die ZEICHENebene: Dort konnte eine
  // verschobene Op mitten in eine unbeteiligte Zeile greifen. Über Tokens deckt
  // jede Op ganze Zeilen. Aber auch dort kann ein verschobener Hunk eine fremde
  // Zeile ERSETZEN — gemessen: zwei fremde Zeilen fielen einer zu. Deshalb wird
  // jeder Hunk einzeln angewandt und einzeln geprüft.
  //
  // Wer mitreißt, fliegt raus und wird gemeldet; wer sauber greift, bleibt. Die
  // Prüfung pro Hunk statt pro Merge ist nicht Feinschliff: Ein Rückfall über
  // den ganzen Merge verwarf auch die LÖSCH-Hunks, und die offline gelöschte
  // Zeile kam zurück.
  //
  // Im Rückfallzweig (sehr viele verschiedene Zeilen) gibt es keine
  // Zeilenidentität; dort bleibt es beim einen Durchlauf mit exakter Suche.
  const patches = tok ? dmp.patch_make(a, b) : dmpExakt.patch_make(a, b);
  let roh: string;
  let angewandt: boolean[];
  if (tok) {
    roh = c;
    angewandt = [];
    for (const hunk of patches) {
      const [neu, ok] = dmp.patch_apply([hunk], roh);
      const traegt =
        ok[0] === true &&
        !reisstMit(hunk as unknown as { diffs: [number, string][] }, roh, neu);
      angewandt.push(traegt);
      if (traegt) roh = neu;
    }
  } else {
    [roh, angewandt] = dmpExakt.patch_apply(patches, c);
  }
  const merged = zurueck(roh);
  const gemeldet = merged + nichtEinsortiert(patches, merged, angewandt, zurueck, !tok);

  const eol = localBody.includes('\r\n') ? '\r\n' : '\n';
  const out = eol === '\n' ? gemeldet : gemeldet.replace(/\n/g, eol);
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
