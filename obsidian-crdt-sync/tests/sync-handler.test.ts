import { SyncHandler } from '../src/sync-handler';
import { CrdtManager } from '../src/crdt-manager';

function makeVaultMock() {
  const files = new Map<string, ArrayBuffer>();
  const textFiles = new Map<string, string>();
  return {
    getAbstractFileByPath: (path: string) =>
      files.has(path) || textFiles.has(path) ? { path } : null,
    read: async (file: { path: string }) =>
      textFiles.get(file.path) ?? '',
    readBinary: async (file: { path: string }) =>
      files.get(file.path)!,
    createBinary: async (path: string, data: ArrayBuffer | Uint8Array) => {
      files.set(path, (data instanceof Uint8Array ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data) as ArrayBuffer);
    },
    modifyBinary: async (file: { path: string }, data: ArrayBuffer | Uint8Array) => {
      files.set(file.path, (data instanceof Uint8Array ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data) as ArrayBuffer);
    },
    createFolder: async (_path: string) => {},
    listYjsFiles: (notePath: string) =>
      Array.from(files.keys()).filter(p => p.startsWith(`.qollab/${notePath}.`) && p.endsWith('.yjs')),
    _files: files,
    _textFiles: textFiles,
  };
}

describe('SyncHandler', () => {
  it('stateFilePath gibt per-User .yjs-Pfad zurück', () => {
    const vault = makeVaultMock() as any;
    const handler = new SyncHandler(vault, new CrdtManager(), 'a1b2c3d4');
    expect(handler.stateFilePath('folder/note.md')).toBe('.qollab/folder/note.md.a1b2c3d4.yjs');
  });

  it('saveState schreibt .yjs-Datei in Vault', async () => {
    const vault = makeVaultMock() as any;
    const manager = new CrdtManager();
    manager.setContent('note.md', 'Hallo');
    const handler = new SyncHandler(vault, manager, 'a1b2c3d4');

    await handler.saveState('note.md');

    expect(vault._files.has('.qollab/note.md.a1b2c3d4.yjs')).toBe(true);
  });

  it('loadAndMerge liest .yjs-Datei und gibt gemergten Inhalt zurück', async () => {
    const vault = makeVaultMock() as any;

    const remote = new CrdtManager();
    remote.setContent('note.md', 'Remote-Inhalt');
    vault._files.set('.qollab/note.md.a1b2c3d4.yjs', remote.encodeState('note.md').buffer);

    const manager = new CrdtManager();
    manager.setContent('note.md', 'Lokal-Inhalt');
    const handler = new SyncHandler(vault, manager, 'a1b2c3d4');

    const merged = await handler.loadAndMerge('note.md');
    expect(merged).toContain('Remote-Inhalt');
    expect(merged).toContain('Lokal-Inhalt');
  });

  it('loadAndMerge übernimmt persistierten State und spielt stale .md NICHT ein (Task 2, D.3)', async () => {
    // Neue Semantik: loadAndMerge bootstrappt den Doc aus persistiertem State
    // (hier die vorhandene .yjs) und injiziert den lokalen .md-Text NICHT mehr.
    // Eine ggf. veraltete .md wird ignoriert — sonst würde sie ankommende
    // Remote-Edits rückgängig machen. Frühere Fassung dieses Tests pinnte genau
    // die entfernte .md-Injektion; sie ist durch D.3 obsolet.
    const vault = makeVaultMock() as any;

    // Stale lokaler Text, seit Plugin-Start nie in den CRDT gebracht.
    vault._textFiles.set('note.md', 'Alices stale lokaler Text');

    // Persistierter Stand liegt in der .yjs.
    const remote = new CrdtManager();
    remote.setContent('note.md', 'Bobs Remote-Text');
    vault._files.set('.qollab/note.md.a1b2c3d4.yjs', remote.encodeState('note.md').buffer);

    const manager = new CrdtManager(); // leerer Doc — kein setContent
    const handler = new SyncHandler(vault, manager, 'a1b2c3d4');

    const merged = await handler.loadAndMerge('note.md');
    expect(merged).toBe('Bobs Remote-Text');
  });

  it('loadAndMerge persistiert die übernommene Fremd-Historie (Neustart-fest)', async () => {
    const vault = makeVaultMock() as any;

    // Fremde Sibling-.yjs mit dem gemergten Stand.
    const remote = new CrdtManager();
    remote.setContent('note.md', 'Gemergter Stand\n');
    vault._files.set('.qollab/note.md.remote01.yjs', remote.encodeState('note.md').buffer);

    const manager = new CrdtManager();
    const handler = new SyncHandler(vault, manager, 'local000');

    const merged = await handler.loadAndMerge('note.md');
    expect(merged).toBe('Gemergter Stand\n');
    // Eigene .yjs wurde geschrieben.
    expect(vault._files.has('.qollab/note.md.local000.yjs')).toBe(true);

    // Neustart: fremde .yjs verschwindet, nur die eigene bleibt sichtbar.
    vault._files.delete('.qollab/note.md.remote01.yjs');
    const freshManager = new CrdtManager();
    const freshHandler = new SyncHandler(vault, freshManager, 'local000');

    const reloaded = await freshHandler.loadAndMerge('note.md');
    expect(reloaded).toBe('Gemergter Stand\n');
  });

  it('loadAndMerge gibt null zurück wenn keine .yjs-Datei existiert', async () => {
    const vault = makeVaultMock() as any;
    const handler = new SyncHandler(vault, new CrdtManager(), 'a1b2c3d4');
    expect(await handler.loadAndMerge('nicht-vorhanden.md')).toBeNull();
  });

  it('loadAndMerge merged Änderungen von zwei verschiedenen Clients', async () => {
    const vault = makeVaultMock() as any;

    const alice = new CrdtManager();
    alice.setContent('note.md', 'Alices Text\n');
    vault._files.set('.qollab/note.md.alice001.yjs', alice.encodeState('note.md').buffer);

    const bob = new CrdtManager();
    bob.setContent('note.md', 'Bobs Text\n');
    vault._files.set('.qollab/note.md.bob00001.yjs', bob.encodeState('note.md').buffer);

    const manager = new CrdtManager();
    const handler = new SyncHandler(vault, manager, 'local000');

    const merged = await handler.loadAndMerge('note.md');
    expect(merged).toContain('Alices Text');
    expect(merged).toContain('Bobs Text');
  });

  it('loadAndMerge liest auch alte note.md.yjs (Migration)', async () => {
    const vault = makeVaultMock() as any;

    const old = new CrdtManager();
    old.setContent('note.md', 'Alter Inhalt\n');
    vault._files.set('.qollab/note.md.yjs', old.encodeState('note.md').buffer);

    const remote = new CrdtManager();
    remote.setContent('note.md', 'Neuer Inhalt\n');
    vault._files.set('.qollab/note.md.a1b2c3d4.yjs', remote.encodeState('note.md').buffer);

    const manager = new CrdtManager();
    const handler = new SyncHandler(vault, manager, 'local000');

    const merged = await handler.loadAndMerge('note.md');
    expect(merged).toContain('Alter Inhalt');
    expect(merged).toContain('Neuer Inhalt');
  });

  it('saveState schreibt .yjs-Datei für Note in Unterverzeichnis', async () => {
    const vault = makeVaultMock() as any;
    const manager = new CrdtManager();
    manager.setContent('03-privat/daily-notes/2026-05-19.md', 'Hallo');
    const handler = new SyncHandler(vault, manager, 'a1b2c3d4');

    await handler.saveState('03-privat/daily-notes/2026-05-19.md');

    expect(vault._files.has('.qollab/03-privat/daily-notes/2026-05-19.md.a1b2c3d4.yjs')).toBe(true);
  });

  it('makeVaultMock.listYjsFiles returns matching paths', () => {
    const vault = makeVaultMock() as any;
    vault._files.set('.qollab/note.md.a1b2c3d4.yjs', new ArrayBuffer(0));
    vault._files.set('.qollab/note.md.b5c6d7e8.yjs', new ArrayBuffer(0));
    vault._files.set('.qollab/other.md.a1b2c3d4.yjs', new ArrayBuffer(0));
    expect(vault.listYjsFiles('note.md')).toEqual(
      expect.arrayContaining(['.qollab/note.md.a1b2c3d4.yjs', '.qollab/note.md.b5c6d7e8.yjs'])
    );
    expect(vault.listYjsFiles('note.md')).not.toContain('.qollab/other.md.a1b2c3d4.yjs');
  });
});
