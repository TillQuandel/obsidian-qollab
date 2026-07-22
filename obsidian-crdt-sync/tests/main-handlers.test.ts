import { TFile } from 'obsidian';
import CrdtSyncPlugin from '../src/main';

// Fix B (Handler-Ebene): rename/delete von note.md dürfen die Sidecars der
// eigenständigen Note note.md.archive.md NICHT anfassen. Der alte Prefix-Filter
// (`startsWith('.qollab/note.md.')`) tat genau das. Die Handler nutzen jetzt
// filterYjsFiles (exakter Match).
//
// Getestet über den echten onload-Pfad: ein Mock-App registriert die
// rename/delete-Handler via vault.on; die Tests emittieren die Events.

function tfile(path: string): TFile {
  const f = new TFile();
  f.path = path;
  f.name = path.split('/').pop() ?? path;
  return f;
}

function makeApp(files: TFile[]) {
  const handlers = new Map<string, (...args: any[]) => any>();
  const renamed: Array<[string, string]> = [];
  const deleted: string[] = [];
  const vault = {
    getFiles: () => files.slice(),
    getMarkdownFiles: () => files.filter((f) => f.path.endsWith('.md')),
    getAbstractFileByPath: (p: string) => files.find((f) => f.path === p) ?? null,
    on: (event: string, cb: (...args: any[]) => any) => {
      handlers.set(event, cb);
      return { __event: event };
    },
    offref: () => {},
    read: async () => '',
    readBinary: async () => new ArrayBuffer(0),
    createBinary: async () => {},
    modifyBinary: async () => {},
    delete: async (f: TFile) => {
      deleted.push(f.path);
      const i = files.indexOf(f);
      if (i >= 0) files.splice(i, 1);
    },
    createFolder: async () => {},
    process: async () => {},
  };
  const fileManager = {
    renameFile: async (f: TFile, newPath: string) => {
      renamed.push([f.path, newPath]);
      f.path = newPath;
    },
  };
  const workspace = { onLayoutReady: (_cb: () => void) => {} }; // Sweep NICHT starten
  const app = { vault, fileManager, workspace };
  return { app, handlers, renamed, deleted };
}

async function loadPlugin(files: TFile[]) {
  const { app, handlers, renamed, deleted } = makeApp(files);
  const plugin = new (CrdtSyncPlugin as any)(app, {});
  await plugin.onload();
  return { plugin, handlers, renamed, deleted };
}

describe('Fix B: rename/delete-Handler fassen fremde Sidecars nicht an', () => {
  it('rename note.md → renamed.md lässt die Sidecars von note.md.archive.md unberührt', async () => {
    const ownPerClient = tfile('.qollab/note.md.a1b2c3d4.yjs');
    const ownLegacy = tfile('.qollab/note.md.yjs');
    const archivePerClient = tfile('.qollab/note.md.archive.md.a1b2c3d4.yjs');
    const archiveLegacy = tfile('.qollab/note.md.archive.md.yjs');
    const note = tfile('note.md');
    const files = [note, ownPerClient, ownLegacy, archivePerClient, archiveLegacy];

    const { handlers, renamed } = await loadPlugin(files);

    // rename-Event: note.md → renamed.md
    note.path = 'renamed.md';
    await handlers.get('rename')!(note, 'note.md');

    // Nur die eigenen Sidecars wurden umbenannt (Legacy + per-Client).
    expect(renamed.map((r) => r[0]).sort()).toEqual(
      ['.qollab/note.md.a1b2c3d4.yjs', '.qollab/note.md.yjs'].sort()
    );
    // Die Sidecars der Archiv-Note blieben unangetastet.
    expect(archivePerClient.path).toBe('.qollab/note.md.archive.md.a1b2c3d4.yjs');
    expect(archiveLegacy.path).toBe('.qollab/note.md.archive.md.yjs');
    // Eigene Sidecars zeigen auf den neuen Pfad.
    expect(ownPerClient.path).toBe('.qollab/renamed.md.a1b2c3d4.yjs');
    expect(ownLegacy.path).toBe('.qollab/renamed.md.yjs');
  });

  it('delete note.md löscht nur die eigenen Sidecars, nicht die von note.md.archive.md', async () => {
    const ownPerClient = tfile('.qollab/note.md.a1b2c3d4.yjs');
    const ownLegacy = tfile('.qollab/note.md.yjs');
    const archivePerClient = tfile('.qollab/note.md.archive.md.a1b2c3d4.yjs');
    const archiveLegacy = tfile('.qollab/note.md.archive.md.yjs');
    const note = tfile('note.md');
    const files = [note, ownPerClient, ownLegacy, archivePerClient, archiveLegacy];

    const { handlers, deleted } = await loadPlugin(files);

    await handlers.get('delete')!(note);

    expect(deleted.sort()).toEqual(
      ['.qollab/note.md.a1b2c3d4.yjs', '.qollab/note.md.yjs'].sort()
    );
    // Archiv-Sidecars sind noch da.
    expect(files.map((f) => f.path)).toEqual(
      expect.arrayContaining([
        '.qollab/note.md.archive.md.a1b2c3d4.yjs',
        '.qollab/note.md.archive.md.yjs',
      ])
    );
  });
});
