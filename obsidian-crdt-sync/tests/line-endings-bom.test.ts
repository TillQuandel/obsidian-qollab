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
