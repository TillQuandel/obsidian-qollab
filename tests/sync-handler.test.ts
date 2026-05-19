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
    _files: files,
    _textFiles: textFiles,
  };
}

describe('SyncHandler', () => {
  it('stateFilePath gibt korrekten .yjs-Pfad zurück', () => {
    const vault = makeVaultMock() as any;
    const handler = new SyncHandler(vault, new CrdtManager());
    expect(handler.stateFilePath('folder/note.md')).toBe('folder/note.md.yjs');
  });

  it('saveState schreibt .yjs-Datei in Vault', async () => {
    const vault = makeVaultMock() as any;
    const manager = new CrdtManager();
    manager.setContent('note.md', 'Hallo');
    const handler = new SyncHandler(vault, manager);

    await handler.saveState('note.md');

    expect(vault._files.has('note.md.yjs')).toBe(true);
  });

  it('loadAndMerge liest .yjs-Datei und gibt gemergten Inhalt zurück', async () => {
    const vault = makeVaultMock() as any;

    const remote = new CrdtManager();
    remote.setContent('note.md', 'Remote-Inhalt');
    vault._files.set('note.md.yjs', remote.encodeState('note.md').buffer);

    const manager = new CrdtManager();
    manager.setContent('note.md', 'Lokal-Inhalt');
    const handler = new SyncHandler(vault, manager);

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
    vault._files.set('note.md.yjs', remote.encodeState('note.md').buffer);

    const manager = new CrdtManager(); // leerer Doc — kein setContent
    const handler = new SyncHandler(vault, manager);

    const merged = await handler.loadAndMerge('note.md');
    expect(merged).toContain('Alices lokaler Text');
    expect(merged).toContain('Bobs Remote-Text');
  });

  it('loadAndMerge gibt null zurück wenn keine .yjs-Datei existiert', async () => {
    const vault = makeVaultMock() as any;
    const handler = new SyncHandler(vault, new CrdtManager());
    expect(await handler.loadAndMerge('nicht-vorhanden.md')).toBeNull();
  });
});
