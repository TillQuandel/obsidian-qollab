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

// ZEILENWEISER 3-WEGE-MERGE — seit 2026-08-11 statt `patch_apply`.
//
// Warum der Fuzzy-Patcher hier weg musste, gemessen (`spike/schnitt/`, Bericht
// `.superpowers/sdd/patch-apply-2026-08-11.md`):
//
// `patch_apply` sucht die Stelle eines Hunks unscharf. Findet es eine Stelle,
// deren Kontext nicht zeichengleich ist, übersetzt es die Op-Indizes per
// `diff_xIndex` (index.js:1869-1899) — die Op landet verschoben und greift
// mitten in eine unbeteiligte Zeile. Über 3.000 Tripel kostete das **431
// zerstörte Grundtextzeilen**. Der Verwurf, den der Fuzz dabei vermeidet, ist
// null: `results[i] === false` trat über 4.283 Hunks kein einziges Mal ein.
//
// Ihn einfach abzuschalten trägt aber NICHT — auch das ist gemessen: Die exakte
// Suche verwirft die vielen Fälle mit, in denen der Fuzz **richtig** liegt
// (+35,4 % Gesamt-Textverlust; selbst `threeWayMerge('a\n','a\nLokal\n',
// 'a\nFremd\n')` fiel dann aus).
//
// Der Ausweg ist, die Frage anders zu stellen. `patch_apply` ist ein Werkzeug
// für den Fall OHNE gemeinsamen Vorfahren — hier gibt es einen: `base`. Beide
// Seiten lassen sich dagegen auflösen, ganz ohne unscharfe Suche. Genau das tut
// `dreiWegeZeilen`, und weil es auf ZEILEN arbeitet, kann keine Op mehr eine
// fremde Zeile aufbrechen.
//
// Ergebnis über dieselben 3.000 Tripel: **Grundtextverlust 0, stiller Verlust
// der lokalen Änderung 0**, Textmenge +2,4 %.
//
// Zwei Eigenschaften, die dabei teuer gelernt wurden und an denen der Merge
// hängt, siehe `ueberlappt` und die Idempotenz-Zweige in `dreiWegeZeilen`.

// Zeilen inklusive Zeilenende; die letzte hat keines, wenn der Text nicht auf
// einem endet. Das ist `splitLines` weiter unten — hier bewusst dieselbe
// Funktion und nicht `split('\n').slice(0, -1)`, wie es der Messapparat tut:
// Dort endet jeder Text auf `\n`, in Obsidian ist das Gegenteil der Normalfall.
// Die Apparat-Fassung verschluckt eine Schlusszeile ohne Zeilenende
// VOLLSTÄNDIG — gemessen an `obsidian-reality.test.ts`, wo aus dem Stand
// `'ZWEITER'` ein leerer Text wurde.
const zeilenListe = (text: string): string[] => (text.length ? splitLines(text) : []);

function zeilenDiff(o: string, x: string): [number, string][] {
  const { chars1, chars2, lineArray } = dmp.diff_linesToChars_(o, x);
  const d = dmp.diff_main(chars1, chars2, false);
  dmp.diff_charsToLines_(d, lineArray);
  return d as unknown as [number, string][];
}

// Ein Hunk: welcher Basisbereich [start, ende) wird durch welche Zeilen ersetzt.
type Hunk = [number, number, string[]];

function hunks(base: string, x: string): Hunk[] {
  const out: Hunk[] = [];
  let i = 0;
  const d = zeilenDiff(base, x);
  for (let k = 0; k < d.length; k++) {
    const [op, txt] = d[k];
    const zs = zeilenListe(txt);
    if (op === 0) {
      i += zs.length;
      continue;
    }
    if (op === -1) {
      let ersatz: string[] = [];
      if (k + 1 < d.length && d[k + 1][0] === 1) {
        ersatz = zeilenListe(d[k + 1][1]);
        k++;
      }
      out.push([i, i + zs.length, ersatz]);
      i += zs.length;
    } else {
      out.push([i, i, zs]);
    }
  }
  return out;
}

// Gehört der Hunk in den gerade eingesammelten Bereich [start, ende)?
//
// Der Unterschied zwischen „grenzt an" und „überlappt" ist hier nicht
// akademisch: Löscht die eine Seite den Basisbereich [3,4) und fügt die andere
// bei Position 4 ein, berühren sie sich nur. Wer beide als Konflikt behandelt,
// behält beide Fassungen — und damit kehrt die gelöschte Zeile zurück. Genau so
// fiel `sweep-schranke-basiswahl.test.ts`, der Test, der die Löschsemantik hält.
function ueberlappt(
  h: Hunk,
  start: number,
  ende: number,
  gegenEinfuegungen: Set<number>
): boolean {
  const [s, e] = h;
  // Der Hunk, der die Runde eröffnet, gehört immer dazu. Ohne diesen Fall wird
  // eine Einfügung bei `start` nie konsumiert und die Schleife dreht endlos.
  if (s === start) return true;
  if (s === e) {
    // Reine Einfügung: belegt keinen Basisbereich, darf also andocken. Konflikt
    // nur, wenn sie echt im Bereich liegt oder die Gegenseite an derselben
    // Stelle einfügt — dann ist die Reihenfolge offen und muss festgelegt werden.
    if (s > start && s < ende) return true;
    return gegenEinfuegungen.has(s);
  }
  return s < ende && e > start;
}

function dreiWegeZeilen(base: string, a: string, b: string): string {
  const ob = zeilenListe(base);
  const ha = hunks(base, a);
  const hb = hunks(base, b);
  const out: string[] = [];
  let i = 0;
  let ia = 0;
  let ib = 0;

  while (ia < ha.length || ib < hb.length) {
    const sa = ia < ha.length ? ha[ia][0] : Infinity;
    const sb = ib < hb.length ? hb[ib][0] : Infinity;
    const start = Math.min(sa, sb);
    for (; i < start && i < ob.length; i++) out.push(ob[i]);

    let ende = start;
    const aH: Hunk[] = [];
    const bH: Hunk[] = [];
    const aEinfuegungen = new Set<number>();
    const bEinfuegungen = new Set<number>();
    let gewachsen = true;
    while (gewachsen) {
      gewachsen = false;
      while (ia < ha.length && ueberlappt(ha[ia], start, ende, bEinfuegungen)) {
        ende = Math.max(ende, ha[ia][1]);
        if (ha[ia][0] === ha[ia][1]) aEinfuegungen.add(ha[ia][0]);
        aH.push(ha[ia++]);
        gewachsen = true;
      }
      while (ib < hb.length && ueberlappt(hb[ib], start, ende, aEinfuegungen)) {
        ende = Math.max(ende, hb[ib][1]);
        if (hb[ib][0] === hb[ib][1]) bEinfuegungen.add(hb[ib][0]);
        bH.push(hb[ib++]);
        gewachsen = true;
      }
    }

    const bau = (hs: Hunk[]): string[] => {
      const res: string[] = [];
      let p = start;
      for (const [s, e, r] of hs) {
        for (; p < s; p++) res.push(ob[p]);
        res.push(...r);
        p = e;
      }
      for (; p < ende; p++) res.push(ob[p]);
      return res;
    };
    const ta = (aH.length ? bau(aH) : ob.slice(start, ende)).join('');
    const tb = (bH.length ? bau(bH) : ob.slice(start, ende)).join('');

    if (ta === tb) out.push(ta);
    else if (aH.length === 0) out.push(tb);
    else if (bH.length === 0) out.push(ta);
    // IDEMPOTENZ. Trägt eine Fassung die andere bereits vollständig, ist nichts
    // nachzutragen. Ohne diese beiden Zweige hängt „beide behalten" bei jedem
    // weiteren Merge erneut an — gemessen 132 → 150 → 168 Zeichen über drei
    // Runden, dieselbe Bauart wie die im August behobene nicht-idempotente
    // Ersetzung in `crdt-manager.ts`.
    else if (ta.includes(tb)) out.push(ta);
    else if (tb.includes(ta)) out.push(tb);
    else {
      // Beide Seiten haben dieselbe Stelle angefasst und keine trägt die andere:
      // beide Fassungen behalten, in fester Reihenfolge, damit alle Geräte
      // dasselbe Ergebnis rechnen. Sichtbar statt still (Gruppe 5).
      const [x, y] = [ta, tb].sort();
      out.push(x, y);
    }
    i = Math.max(i, ende);
  }
  for (; i < ob.length; i++) out.push(ob[i]);
  return out.join('');
}

export function threeWayMerge(base: string, local: string, other: string): string {
  const localBom = local.startsWith(BOM);
  const localBody = ohneBom(local);
  // Vergleichsfassung: nur der Inhalt zählt, nicht die Schreibweise.
  const baseLf = aufLf(ohneBom(base));
  const localLf = aufLf(localBody);
  const otherLf = aufLf(ohneBom(other));

  // Zeilenende-Garantie — dieselbe wie in `unionMerge` (Review C-1), die hier
  // beim Wechsel auf den zeilenweisen Merge fehlte.
  //
  // `zeilenListe` schneidet die Schlusszeile ohne `\n` ab, und `dreiWegeZeilen`
  // fügt die Stücke mit `join('')` zusammen. Endet ein Stand nicht auf `\n` — in
  // Obsidian der Normalfall —, hat seine letzte Zeile kein Trennzeichen, und die
  // nächste Zeile klebt daran fest:
  //     threeWayMerge('a\nb', 'a\nb\nX', 'a\nb\nY')  ->  'a\nb\nXb\nY'
  // Am laufenden Produkt gemessen (Realtest r13/r14, 2026-08-13): Der Marker der
  // Gegenseite stand danach als `A2-…BBB-…` in einer Zeile, in BEIDEN Vaults
  // byte-gleich — struktureller Schaden, konvergent und damit still.
  //
  // Deshalb vor dem Diff beidseitig ein Zeilenende garantieren — und hinterher
  // entscheiden, ob es im Ergebnis stehenbleibt.
  //
  // Diese Entscheidung ist selbst ein 3-Wege-Merge, über genau ein Bit: „endet
  // der Text auf einem Zeilenumbruch". Wer das Bit gegenüber `base` geändert hat,
  // bestimmt es; hat keine Seite es angefasst, bleibt es wie in `base`. Haben es
  // beide geändert, sind sie zwangsläufig einig (beide auf dem Gegenwert von
  // `base`), und `localNl` trägt dieselbe Antwort.
  //
  // Die naheliegende Kurzfassung „entfernen, wenn weder local noch other eines
  // hat" ist FALSCH und war in der ersten Fassung dieses Fixes drin. Sie liest
  // `other` als Beitrag, auch wenn `other === base` — also wenn die Gegenseite
  // gar nichts geändert hat. Dann bricht die Identität
  // `threeWayMerge(base, local, base) === local`: Der gewöhnliche lokale Edit am
  // Dateiende (Obsidian schreibt dort kein Zeilenende) bekäme eines angehängt,
  // und `sync-handler.ts:1847` schriebe Datei und CRDT-Op für eine Änderung, die
  // niemand gemacht hat — selbstverstärkend, weil die Datei danach auf `\n`
  // endet. Gefunden durch adversariale Prüfung des Fixes, 2026-08-13.
  const mitNl = (s: string) => (s === '' || s.endsWith('\n') ? s : s + '\n');
  const baseNl = baseLf.endsWith('\n');
  const localNl = localLf.endsWith('\n');
  const otherNl = otherLf.endsWith('\n');
  const zielNl = localNl === baseNl ? otherNl : localNl;

  let merged = dreiWegeZeilen(mitNl(baseLf), mitNl(localLf), mitNl(otherLf));
  // Der Strip nimmt ausschließlich zurück, was `mitNl` angehängt hat — und das
  // war höchstens ein Zeichen hinter einer NICHT leeren Schlusszeile.
  //
  // `mitNl` ist nicht umkehrbar: `'x'` und `'x\n'` bilden beide auf `'x\n'` ab.
  // Endet `merged` auf `'\n\n'`, ist die letzte Zeile leer — dieses `\n` hat
  // niemand angehängt, es ist Inhalt. Ein `slice(0, -1)` löschte dort eine
  // Leerzeile UND verfehlte `zielNl` trotzdem, weil das Ergebnis danach immer
  // noch auf `\n` endet. Ein Text mit leerer Schlusszeile kann `zielNl === false`
  // gar nicht erfüllen; dort ist Nichtstun richtig.
  //
  // Zweite adversariale Prüfung, 2026-08-13. Eigene Messung dazu
  // (`spike/duplikat-mb/leerzeile.mjs`, Seed 20260813): In 481 von 19.959
  // gemergten Tripeln (2,4 %) hätte der Strip ohne diesen Guard eine Leerzeile
  // gefressen — konvergent auf beiden Seiten und damit still.
  const schlusszeileLeer = merged.endsWith('\n\n') || merged === '\n';
  if (!zielNl && merged.endsWith('\n') && !schlusszeileLeer) merged = merged.slice(0, -1);

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
