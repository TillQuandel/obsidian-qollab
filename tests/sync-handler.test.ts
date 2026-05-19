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
      files.set(path, data instanceof Uint8Array ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data);
    },
    modifyBinary: async (file: { path: string }, data: ArrayBuffer | Uint8Array) => {
      files.set(file.path, data instanceof Uint8Array ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data);
    },
    listYjsFiles: (notePath: string) =>
      Array.from(files.keys()).filter(p => p.startsWith(notePath + '.') && p.endsWith('.yjs')),
    _files: files,
    _textFiles: textFiles,
  };
}

describe('SyncHandler', () => {
  it('stateFilePath gibt per-User .yjs-Pfad zurück', () => {
    const vault = makeVaultMock() as any;
    const handler = new SyncHandler(vault, new CrdtManager(), 'a1b2c3d4');
    expect(handler.stateFilePath('folder/note.md')).toBe('folder/note.md.a1b2c3d4.yjs');
  });

  it('saveState schreibt .yjs-Datei in Vault', async () => {
    const vault = makeVaultMock() as any;
    const manager = new CrdtManager();
    manager.setContent('note.md', 'Hallo');
    const handler = new SyncHandler(vault, manager, 'a1b2c3d4');

    await handler.saveState('note.md');

    expect(vault._files.has('note.md.a1b2c3d4.yjs')).toBe(true);
  });

  it('loadAndMerge liest .yjs-Datei und gibt gemergten Inhalt zurück', async () => {
    const vault = makeVaultMock() as any;

    const remote = new CrdtManager();
    remote.setContent('note.md', 'Remote-Inhalt');
    vault._files.set('note.md.a1b2c3d4.yjs', remote.encodeState('note.md').buffer);

    const manager = new CrdtManager();
    manager.setContent('note.md', 'Lokal-Inhalt');
    const handler = new SyncHandler(vault, manager, 'a1b2c3d4');

    const merged = await handler.loadAndMerge('note.md');
    expect(merged).toContain('Remote-Inhalt');
    expect(merged).toContain('Lokal-Inhalt');
  });

  it('loadAndMerge behält lokalen .md-Inhalt bei Cold-Start (kein vorheriges setContent)', async () => {
    const vault = makeVaultMock() as any;

    // Alice hat eine Note aber hat sie seit Plugin-Start nie bearbeitet (kein setContent)
    vault._textFiles.set('note.md', 'Alices lokaler Text');

    // Bob hat Änderungen in .yjs gespeichert
    const remote = new CrdtManager();
    remote.setContent('note.md', 'Bobs Remote-Text');
    vault._files.set('note.md.a1b2c3d4.yjs', remote.encodeState('note.md').buffer);

    const manager = new CrdtManager(); // leerer Doc — kein setContent
    const handler = new SyncHandler(vault, manager, 'a1b2c3d4');

    const merged = await handler.loadAndMerge('note.md');
    expect(merged).toContain('Alices lokaler Text');
    expect(merged).toContain('Bobs Remote-Text');
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
    vault._files.set('note.md.alice001.yjs', alice.encodeState('note.md').buffer);

    const bob = new CrdtManager();
    bob.setContent('note.md', 'Bobs Text\n');
    vault._files.set('note.md.bob00001.yjs', bob.encodeState('note.md').buffer);

    const manager = new CrdtManager();
    const handler = new SyncHandler(vault, manager, 'local000');

    const merged = await handler.loadAndMerge('note.md');
    expect(merged).toContain('Alices Text');
    expect(merged).toContain('Bobs Text');
  });

  it('makeVaultMock.listYjsFiles returns matching paths', () => {
    const vault = makeVaultMock() as any;
    vault._files.set('note.md.a1b2c3d4.yjs', new ArrayBuffer(0));
    vault._files.set('note.md.b5c6d7e8.yjs', new ArrayBuffer(0));
    vault._files.set('other.md.a1b2c3d4.yjs', new ArrayBuffer(0));
    expect(vault.listYjsFiles('note.md')).toEqual(
      expect.arrayContaining(['note.md.a1b2c3d4.yjs', 'note.md.b5c6d7e8.yjs'])
    );
    expect(vault.listYjsFiles('note.md')).not.toContain('other.md.a1b2c3d4.yjs');
  });
});
