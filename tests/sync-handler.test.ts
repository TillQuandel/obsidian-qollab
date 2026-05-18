import { SyncHandler } from '../src/sync-handler';
import { CrdtManager } from '../src/crdt-manager';

function makeVaultMock() {
  const files = new Map<string, ArrayBuffer>();
  return {
    getAbstractFileByPath: (path: string) =>
      files.has(path) ? { path } : null,
    readBinary: async (file: { path: string }) =>
      files.get(file.path)!,
    createBinary: async (path: string, data: ArrayBuffer) => {
      files.set(path, data);
    },
    modifyBinary: async (file: { path: string }, data: ArrayBuffer) => {
      files.set(file.path, data);
    },
    _files: files,
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

  it('loadAndMerge gibt null zurück wenn keine .yjs-Datei existiert', async () => {
    const vault = makeVaultMock() as any;
    const handler = new SyncHandler(vault, new CrdtManager());
    expect(await handler.loadAndMerge('nicht-vorhanden.md')).toBeNull();
  });
});
