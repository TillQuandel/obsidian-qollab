import { unionMerge } from '../src/text-merge';

// Zeilenenden und BOM beim Vereinigen ohne gemeinsamen Vorfahren
//
// `unionMerge` vergleicht byteexakt. `diff_linesToChars_` tokenisiert INKLUSIVE
// Zeilenende, also sind `"# Titel\n"` und `"# Titel\r\n"` verschiedene Tokens:
// zwischen einer LF- und einer CRLF-Fassung DESSELBEN Textes hat keine einzige
// Zeile eine Entsprechung, und die Vereinigung haengt beide Fassungen
// vollstaendig hintereinander. Der Kurzschluss `other === local` greift dabei
// nicht, weil die Bytes ja verschieden sind.
//
// Der Weg dorthin ist Alltag, kein Grenzfall: Git-Checkout mit
// `core.autocrlf=true` (Windows-Standard), ein externer Windows-Editor, ein
// PowerShell-Export. Ein Windows- und ein Mac-Geraet sehen damit systematisch
// verschiedene Zeilenenden fuer dieselbe Notiz.
//
// Zweiter Schaden: Ein BOM (U+FEFF) gehoert an Position 0. Als gewoehnliches
// Zeichen der ersten Zeile wandert es beim Vereinigen in die Dateimitte — die
// Datei beginnt dann ohne Kodierungs-Kennzeichnung, und das U+FEFF steht
// unmittelbar vor dem `#`, womit die Ueberschrift nach CommonMark kein
// ATX-Heading mehr ist, sondern ein Absatz.

const BOM = '\uFEFF';

const lf = (s: string) => s.replace(/\r\n/g, '\n');
const zeilen = (s: string) =>
  lf(s)
    .split('\n')
    .filter((z) => z !== '');
// Ein einzelnes LF ohne vorangehendes CR \u2014 der Nachweis fuer \u201Enicht gemischt".
const hatNacktesLf = (s: string) => /(^|[^\r])\n/.test(s);
const zaehleCrlf = (s: string) => (s.match(/\r\n/g) || []).length;

describe('unionMerge — CRLF gegen LF', () => {
  it('verdoppelt inhaltlich identischen Text nicht', () => {
    const local = '# Titel\nText.\nEnde.\n';
    const other = '# Titel\r\nText.\r\nEnde.\r\n';
    const merged = unionMerge(other, local);

    // Der Schaden ist an der Laenge ablesbar: exakt die Summe beider Fassungen.
    expect(merged.length).not.toBe(other.length + local.length);
    // Das lokale Zeilenende bleibt — die Datei wird nicht unnoetig umgeschrieben.
    expect(merged).toBe(local);
  });

  it('verdoppelt auch andersherum nicht (CRLF ist der lokale Stand)', () => {
    const local = '# Titel\r\nText.\r\nEnde.\r\n';
    const other = '# Titel\nText.\nEnde.\n';
    expect(unionMerge(other, local)).toBe(local);
  });

  it('uebernimmt eine echte Zusatzzeile, ohne den Rest zu verdoppeln', () => {
    const local = '# Titel\nText.\n';
    const other = '# Titel\r\nText.\r\nNeu vom anderen Geraet.\r\n';
    const merged = unionMerge(other, local);

    expect(zeilen(merged)).toEqual(['# Titel', 'Text.', 'Neu vom anderen Geraet.']);
    // Jede Zeile genau einmal.
    expect(zeilen(merged).length).toBe(3);
    // Der lokale Teil geht unveraendert durch.
    expect(merged.startsWith(local)).toBe(true);
  });

  it('uebernimmt eine Zusatzzeile beider Seiten (Verlustfreiheit trotz CRLF)', () => {
    const local = '# Titel\nNur lokal.\n';
    const other = '# Titel\r\nNur fremd.\r\n';
    const merged = unionMerge(other, local);

    expect(zeilen(merged)).toContain('Nur lokal.');
    expect(zeilen(merged)).toContain('Nur fremd.');
    expect(zeilen(merged).filter((z) => z === '# Titel').length).toBe(1);
  });

  it('gemischte Zeilenenden innerhalb einer Datei', () => {
    // Identischer Inhalt, nur die Zeilenenden sind auf beiden Seiten anders
    // gemischt: nichts zu vereinigen, der lokale Stand bleibt byteweise stehen.
    const local = 'a\nb\r\nc\n';
    expect(unionMerge('a\r\nb\nc\r\n', local)).toBe(local);

    // Mit echter Zusatzzeile: der lokale Teil bleibt unangetastet, die fremde
    // Zeile kommt hinzu — und zwar genau einmal.
    const merged = unionMerge('a\r\nb\r\nc\r\nd\r\n', local);
    expect(lf(merged)).toBe('a\nb\nc\nd\n');
    expect(merged.startsWith(local)).toBe(true);
  });
});

// Die vier Stellen, an denen unionMerge ein Zeilenende SCHREIBT statt es
// durchzureichen. Alle vier waren bis hierher unbewacht: eine Mutationsprobe
// (je eine Stelle neutralisiert, volle Suite) liess 59 Suiten / 381 Tests
// gruen. Die Erwartungen unten sind mit der intakten Implementierung gemessen,
// nicht abgeleitet.
//
//   Zeile 201  fremde Zeilen bekommen `eol` (statt des LF der Vergleichsfassung)
//   Zeile 177  fremde Schlusszeile wird mit LF aufgefuellt (Vergleichsraum)
//   Zeile 178  lokale Schlusszeile wird mit LF aufgefuellt (Vergleichsraum)
//   Zeile 180  lokale Schlusszeile wird in den ORIGINALBYTES mit `eol` aufgefuellt
//   Zeile 219  ein aufgefuelltes CRLF wird zweizeichig zurueckgenommen
//
// Alle Faelle brauchen einen lokalen CRLF-Stand: bei `eol === '\n'` sind
// geschriebenes und durchgereichtes Zeilenende dasselbe Zeichen, dann ist die
// Umschreibung unsichtbar. Genau deshalb war die Luecke da — die Bestandstests
// pruefen die CRLF-Richtung nur an Faellen, die ohne Umschreibung auskommen.
// Ein doppeltes CR vor dem Zeilenende ('\r\r\n') entsteht, wenn eine naive
// LF->CRLF-Umwandlung auf einen Text laeuft, der schon CRLF hat — der Einzeiler
// `-replace "\n", "\r\n"` bzw. `text.replace(/\n/g, '\r\n')`. Gemessen mit
// PowerShell 7: aus 61 0D 0A 62 0D 0A wird 61 0D 0D 0A 62 0D 0D 0A.
// (Gemessen NICHT erzeugt: `git checkout` mit core.autocrlf=true — Git laesst
// vorhandene CR stehen; ebensowenig Set-Content oder Out-File.)
//
// Die Normalisierung `replace(/\r\n/g, '\n')` ersetzt nicht ueberlappend: aus
// '\r\r\n' wird '\r\n'. Das Zeilenende ueberlebt die Vergleichsfassung, damit
// hat zwischen einem so umgewandelten und einem normalen Stand wieder KEINE
// Zeile eine Entsprechung — genau die Lage vor dem Fix vom 02.08.
describe('unionMerge — doppeltes CR vor dem Zeilenende', () => {
  // `zeilen()` oben kennt nur '\r\n'; ein '\r\r\n' liesse dort ein '\r' am
  // Zeilenende stehen und jede Gleichheitspruefung scheitern. Hier zerlegt
  // deshalb ein eigener Helfer, der jeden CR-Lauf vor dem LF wegnimmt.
  const zeilenCr = (s: string) =>
    s
      .replace(/\r+\n/g, '\n')
      .split('\n')
      .filter((z) => z !== '');

  it('verdoppelt die Notiz nicht, wenn der fremde Stand doppelte CR hat', () => {
    const local = '# Titel\nA\nB\n';
    const other = '# Titel\r\r\nA\r\r\nB\r\r\nFREMD\r\r\n';
    const merged = unionMerge(other, local);

    for (const z of ['# Titel', 'A', 'B', 'FREMD']) {
      expect(zeilenCr(merged).filter((x) => x === z).length).toBe(1);
    }
    // Der lokale Stand ist reines LF -> das Ergebnis auch.
    expect(merged.includes('\r')).toBe(false);
  });

  it('verdoppelt die Notiz nicht, wenn der lokale Stand doppelte CR hat', () => {
    const local = '# Titel\r\r\nA\r\r\nB\r\r\n';
    const other = '# Titel\nA\nB\nFREMD\n';
    const merged = unionMerge(other, local);

    for (const z of ['# Titel', 'A', 'B', 'FREMD']) {
      expect(zeilenCr(merged).filter((x) => x === z).length).toBe(1);
    }
    // Die lokalen Zeilen gehen byteweise durch (auch mit ihrem doppelten CR) —
    // unionMerge schreibt die Datei nicht um; die hinzukommende fremde Zeile
    // bekommt das lokale CRLF.
    expect(merged.startsWith(local)).toBe(true);
    expect(hatNacktesLf(merged)).toBe(false);
  });
});

describe('unionMerge — geschriebene Zeilenenden (Mutationsdeckung)', () => {
  it('gibt fremden Zeilen das lokale CRLF, in der Mitte wie am Schluss', () => {
    const local = '# Titel\r\nA\r\nB\r\n';
    const other = '# Titel\r\nA\r\nFREMD 1\r\nB\r\nFREMD 2\r\n';
    const merged = unionMerge(other, local);

    // Neutralisiert (`out.push(otherLines[i + k])`) steht hier
    // '# Titel\r\nA\r\nFREMD 1\nB\r\nFREMD 2\n' — nackte LF mitten in einer
    // sonst durchgaengigen CRLF-Datei, also genau die gemischte Fassung, gegen
    // die der Fix gebaut wurde.
    expect(hatNacktesLf(merged)).toBe(false);
    expect(zaehleCrlf(merged)).toBe(5);
    expect(merged).toBe('# Titel\r\nA\r\nFREMD 1\r\nB\r\nFREMD 2\r\n');
  });

  it('gibt auch einer LEEREN fremden Zeile das lokale CRLF', () => {
    // Die Umschreibung schneidet ein Zeichen ab und haengt `eol` an. Bei einer
    // Leerzeile besteht die ganze Zeile aus diesem einen Zeichen — der Rest ist
    // der leere String, das Ergebnis muss trotzdem ein volles CRLF sein.
    const local = 'a\r\nb\r\n';
    const merged = unionMerge('a\r\n\r\nFREMD\r\nb\r\n', local);

    expect(hatNacktesLf(merged)).toBe(false);
    expect(merged).toBe('a\r\n\r\nFREMD\r\nb\r\n');
  });

  it('erkennt die fremde Schlusszeile ohne Zeilenende als dieselbe Zeile', () => {
    // Fremd endet auf 'b' OHNE Zeilenende, lokal auf 'b\r\n'. Beide Staende
    // muessen im Vergleichsraum mit LF aufgefuellt werden, sonst sind 'b\n' und
    // 'b\r\n' verschiedene Tokens und 'b' erscheint zweimal.
    const local = 'a\r\nb\r\n';
    const merged = unionMerge('a\r\nFREMD\r\nb', local);

    expect(zeilen(merged).filter((z) => z === 'b').length).toBe(1);
    expect(hatNacktesLf(merged)).toBe(false);
    expect(merged).toBe('a\r\nFREMD\r\nb\r\n');
  });

  it('haengt an die lokale Schlusszeile ohne Zeilenende CRLF an, nicht LF', () => {
    // Spiegelbild: LOKAL endet ohne Zeilenende, fremd mit. Das Auffuellen
    // passiert zweimal — im Vergleichsraum mit LF (sonst Verdopplung von 'b')
    // und in den Originalbytes mit dem lokalen CRLF (sonst endet die CRLF-Datei
    // auf einem nackten LF).
    const local = 'a\r\nb';
    const merged = unionMerge('a\r\nFREMD\r\nb\r\n', local);

    expect(zeilen(merged).filter((z) => z === 'b').length).toBe(1);
    expect(hatNacktesLf(merged)).toBe(false);
    expect(merged).toBe('a\r\nFREMD\r\nb\r\n');
  });

  it('nimmt das aufgefuellte CRLF vollstaendig zurueck, nicht nur zur Haelfte', () => {
    // Keine Seite hat ein Schluss-Zeilenende -> das zum Vergleich aufgefuellte
    // muss wieder weg. Bei CRLF sind das ZWEI Zeichen; nur eines abzuschneiden
    // liesse ein einzelnes '\r' am Dateiende stehen.
    const local = 'a\r\nb';
    const merged = unionMerge('a\r\nFREMD', local);

    expect(merged.endsWith('\r')).toBe(false);
    expect(merged.endsWith('b')).toBe(true);
    expect(merged).toBe('a\r\nFREMD\r\nb');
  });
});

describe('unionMerge — BOM', () => {
  it('haelt ein lokales BOM vorne', () => {
    const local = BOM + '# Titel\nText.\n';
    const other = '# Titel\nText.\n';
    const merged = unionMerge(other, local);

    expect(merged.indexOf(BOM)).toBe(0);
    expect(merged.slice(1).indexOf(BOM)).toBe(-1);
    expect(merged).toBe(local);
  });

  it('laesst ein fremdes BOM verschwinden, statt es in die Mitte zu schieben', () => {
    const local = '# Titel\nText.\n';
    const other = BOM + '# Titel\nText.\n';
    const merged = unionMerge(other, local);

    // Gemessener Schaden: BOM-Index 8 (unmittelbar vor dem `#` der zweiten
    // Fassung), Laenge 14 -> 23.
    expect(merged.indexOf(BOM)).toBe(-1);
    expect(merged).toBe(local);
  });

  it('haelt das BOM auch dann vorne, wenn wirklich vereinigt wird', () => {
    const local = BOM + '# Titel\nNur lokal.\n';
    const other = BOM + '# Titel\r\nNur fremd.\r\n';
    const merged = unionMerge(other, local);

    expect(merged.indexOf(BOM)).toBe(0);
    expect(merged.slice(1).indexOf(BOM)).toBe(-1);
    expect(zeilen(merged.slice(1))).toContain('Nur lokal.');
    expect(zeilen(merged.slice(1))).toContain('Nur fremd.');
  });

  it('erfindet kein BOM, wenn keine Seite eines hatte', () => {
    expect(unionMerge('a\nb\n', 'a\nc\n').indexOf(BOM)).toBe(-1);
  });
});

describe('unionMerge — jenseits der Token-Grenze', () => {
  // Ab 40000 verschiedenen Zeilen fasst diff_linesToChars_ den Rest zu EINEM
  // Token zusammen. Dann steht das k-te Zeichen nicht mehr fuer die k-te Zeile,
  // und die zeilengenaue Rueckabbildung liefe versetzt — dafuer gibt es den
  // Rueckfallweg. Was er zusagt, ist Verlustfreiheit und ein einheitliches
  // Zeilenende; die (schon vorher bestehende) Verdopplung im Schwanz jenseits
  // der Grenze hebt er nicht auf.
  it('bleibt verlustfrei und liefert das lokale Zeilenende', () => {
    const basis = Array.from({ length: 41000 }, (_, i) => `Zeile ${i}`);
    const local = basis.join('\r\n') + '\r\n';
    const other = basis.join('\n') + '\nnur fremd\n';
    const merged = unionMerge(other, local);

    const teile = merged.split('\r\n');
    expect(teile).toContain('Zeile 0');
    expect(teile).toContain('Zeile 40999');
    expect(teile).toContain('nur fremd');
    // Kein einzelnes LF uebrig: das Ergebnis ist durchgaengig CRLF.
    expect(/[^\r]\n/.test(merged)).toBe(false);
  });
});

describe('unionMerge — Kontrollen (muessen gruen bleiben)', () => {
  it('reines LF gegen LF verhaelt sich wie bisher', () => {
    expect(unionMerge('a\nb\n', 'a\nc\n')).toBe('a\nb\nc\n');
    expect(unionMerge('a\nb\nc', 'a\nb')).toBe('a\nb\nc');
    expect(unionMerge('', 'abc')).toBe('abc');
    expect(unionMerge('abc', '')).toBe('abc');
    expect(unionMerge('a\nb', 'a\nb')).toBe('a\nb');
  });

  it('Verlustfreiheit: was nur auf einer Seite steht, bleibt erhalten', () => {
    const other = 'kopf\nnur fremd 1\ngemeinsam\nnur fremd 2\n';
    const local = 'kopf\nnur lokal 1\ngemeinsam\nnur lokal 2\n';
    const merged = unionMerge(other, local);

    for (const z of ['nur fremd 1', 'nur fremd 2', 'nur lokal 1', 'nur lokal 2']) {
      expect(zeilen(merged)).toContain(z);
    }
    expect(zeilen(merged).filter((z) => z === 'gemeinsam').length).toBe(1);
  });
});
