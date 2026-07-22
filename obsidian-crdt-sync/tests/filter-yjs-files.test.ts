import { filterYjsFiles } from '../src/sync-handler';

describe('filterYjsFiles', () => {
  it('matcht per-Client .yjs einer Note', () => {
    expect(filterYjsFiles(['.qollab/note.md.a1b2c3d4.yjs'], 'note.md')).toEqual([
      '.qollab/note.md.a1b2c3d4.yjs',
    ]);
  });

  it('matcht Note in Unterverzeichnis', () => {
    expect(
      filterYjsFiles(['.qollab/folder/note.md.a1b2c3d4.yjs'], 'folder/note.md')
    ).toEqual(['.qollab/folder/note.md.a1b2c3d4.yjs']);
  });

  it('matcht Legacy .qollab/note.md.yjs (ohne clientId)', () => {
    expect(filterYjsFiles(['.qollab/note.md.yjs'], 'note.md')).toEqual([
      '.qollab/note.md.yjs',
    ]);
  });

  it('matcht NICHT die .yjs anderer Notes', () => {
    expect(filterYjsFiles(['.qollab/other.md.a1b2c3d4.yjs'], 'note.md')).toEqual(
      []
    );
  });

  // Fix B: exakter Sidecar-Match statt Prefix-Match. Eine Note note.md.archive.md
  // ist KEIN Sibling von note.md — ihre Sidecars dürfen nicht mitgematcht werden
  // (sonst Cross-Note-Merge / Mit-Löschen fremder Sidecars).
  it('matcht NICHT die Sidecars von note.md.archive.md unter note.md', () => {
    const paths = [
      '.qollab/note.md.a1b2c3d4.yjs',
      '.qollab/note.md.yjs',
      '.qollab/note.md.archive.md.a1b2c3d4.yjs',
      '.qollab/note.md.archive.md.yjs',
    ];
    expect(filterYjsFiles(paths, 'note.md')).toEqual([
      '.qollab/note.md.a1b2c3d4.yjs',
      '.qollab/note.md.yjs',
    ]);
  });

  it('matcht für note.md.archive.md genau deren eigene Sidecars', () => {
    const paths = [
      '.qollab/note.md.a1b2c3d4.yjs',
      '.qollab/note.md.yjs',
      '.qollab/note.md.archive.md.a1b2c3d4.yjs',
      '.qollab/note.md.archive.md.yjs',
    ];
    expect(filterYjsFiles(paths, 'note.md.archive.md')).toEqual([
      '.qollab/note.md.archive.md.a1b2c3d4.yjs',
      '.qollab/note.md.archive.md.yjs',
    ]);
  });

  it('matcht NICHT clientId-Segmente falscher Länge oder Nicht-Hex', () => {
    expect(
      filterYjsFiles(
        [
          '.qollab/note.md.a1b2c3d.yjs', // 7 hex
          '.qollab/note.md.a1b2c3d4e.yjs', // 9 hex
          '.qollab/note.md.A1B2C3D4.yjs', // uppercase
          '.qollab/note.md.gggggggg.yjs', // Nicht-Hex
        ],
        'note.md'
      )
    ).toEqual([]);
  });

  it('matcht NICHT ausserhalb von .qollab/', () => {
    expect(
      filterYjsFiles(
        ['note.md.a1b2c3d4.yjs', 'sub/.qollab/note.md.a1b2c3d4.yjs'],
        'note.md'
      )
    ).toEqual([]);
  });

  it('matcht NICHT Nicht-.yjs-Dateien', () => {
    expect(
      filterYjsFiles(['.qollab/note.md.a1b2c3d4.txt'], 'note.md')
    ).toEqual([]);
  });
});
