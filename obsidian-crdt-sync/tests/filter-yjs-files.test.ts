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
    // Bewusst breiter als der FileWatcher: dessen QOLLAB_RE
    // (/^\.qollab\/(.+)\.[0-9a-f]{8}\.yjs$/) verlangt eine 8-stellige
    // clientId und würde diese Legacy-Datei NICHT matchen. Divergenz ist
    // bekannt und wird in diesem Task nicht gefixt.
    expect(filterYjsFiles(['.qollab/note.md.yjs'], 'note.md')).toEqual([
      '.qollab/note.md.yjs',
    ]);
  });

  it('matcht NICHT die .yjs anderer Notes', () => {
    expect(filterYjsFiles(['.qollab/other.md.a1b2c3d4.yjs'], 'note.md')).toEqual(
      []
    );
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
