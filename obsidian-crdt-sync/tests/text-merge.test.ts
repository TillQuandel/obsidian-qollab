import { unionMerge } from '../src/text-merge';

// Review C-1/I-1: `diff_linesToChars_` tokenisiert INKLUSIVE Zeilenende — "b" und
// "b\n" sind verschiedene Tokens. Endet einer der beiden Stände nicht auf "\n"
// (in Obsidian der Normalfall), klebte das stumpfe join('') der Diff-Segmente
// zwei Zeilen aneinander ("a\nb\nc" ∪ "a\nb" → "a\nb\ncb"). Diese Tests halten
// die Tokenisierung fest; die Fixtures OHNE abschließendes "\n" sind der Kern.

describe('unionMerge — Zeilenende-Tokenisierung', () => {
  it('vereinigt, wenn BEIDE Stände ohne abschließendes \\n enden', () => {
    expect(unionMerge('a\nb\nc', 'a\nb')).toBe('a\nb\nc');
    expect(unionMerge('a\nb', 'a\nb\nc')).toBe('a\nb\nc');
  });

  it('klebt keine Zeilen zusammen, wenn nur ein Stand ohne \\n endet', () => {
    expect(unionMerge('Zeile 1\nZeile 2\nGewinner Y', 'Zeile 1\nZeile 2')).toBe(
      'Zeile 1\nZeile 2\nGewinner Y'
    );
    expect(unionMerge('Zeile 1\nFremd F', 'Zeile 1\nLokal L').split('\n')).toEqual([
      'Zeile 1',
      'Fremd F',
      'Lokal L',
    ]);
  });

  it('erfindet kein Zeilenende und verschluckt keines', () => {
    // Keine Seite hatte eins → Ergebnis hat auch keins.
    expect(unionMerge('a\nb', 'a\nc').endsWith('\n')).toBe(false);
    // Mindestens eine Seite hatte eins → bleibt erhalten.
    expect(unionMerge('a\nb\n', 'a\nc')).toBe('a\nb\nc\n');
    expect(unionMerge('a\nb', 'a\nc\n')).toBe('a\nb\nc\n');
  });

  it('behandelt leere Stände ohne Zeilenende-Artefakt', () => {
    expect(unionMerge('', 'abc')).toBe('abc');
    expect(unionMerge('abc', '')).toBe('abc');
    expect(unionMerge('', '')).toBe('');
  });

  it('identische Stände bleiben unverändert (kein Duplikat)', () => {
    expect(unionMerge('a\nb\n', 'a\nb\n')).toBe('a\nb\n');
    expect(unionMerge('a\nb', 'a\nb')).toBe('a\nb');
  });

  // Dokumentierte Grenze (Review M-1): ohne gemeinsamen Vorfahren ist eine
  // Umsortierung nicht von „Zeile gelöscht + Zeile eingefügt" unterscheidbar.
  it('dokumentierte Grenze: umsortierte Zeilen werden verdoppelt', () => {
    expect(unionMerge('kopf\nA\nB\nfuss\n', 'kopf\nB\nA\nfuss\n')).toBe('kopf\nA\nB\nA\nfuss\n');
  });
});
