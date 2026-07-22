import { TFile } from 'obsidian';
import CrdtSyncPlugin from '../src/main';
import { makeVaultMock, VaultMock } from './helpers/vault-mock';

// Fix B (Handler-Ebene): rename/delete von note.md dürfen die Sidecars der
// eigenständigen Note note.md.archive.md NICHT anfassen. Die Handler nutzen
// filterYjsFiles (exakter Match) über den Adapter.
//
// Getestet über den echten onload-Pfad: eine Mock-App registriert die
// rename/delete-Handler via vault.on; die Tests emittieren die Events. Sidecars
// leben — wie in echten Vaults — hinter dem Adapter (nicht im Index).
//
// Zusätzlich: Initial-Scan-nach-Sweep-Reihenfolge (onLayoutReady).

function tfile(path: string): TFile {
  const f = new TFile();
  f.path = path;
  f.name = path.split('/').pop() ?? path;
  return f;
}

function makeApp(vault: VaultMock, onLayoutReady?: (cb: () => any) => void) {
  const handlers = new Map<string, (...args: any[]) => any>();
  const renamed: Array<[string, string]> = [];
  const deleted: string[] = [];

  // Adapter-Operationen mitschneiden (Ersatz für die früheren renameFile/delete-Spies).
  const origRename = vault.adapter.rename;
  vault.adapter.rename = async (from: string, to: string) => {
    renamed.push([from, to]);
    return origRename(from, to);
  };
  const origRemove = vault.adapter.remove;
  vault.adapter.remove = async (p: string) => {
    deleted.push(p);
    return origRemove(p);
  };

  const vaultWithEvents = Object.assign(vault, {
    on: (event: string, cb: (...args: any[]) => any) => {
      handlers.set(event, cb);
      return { __event: event };
    },
    offref: () => {},
  });

  const workspace = {
    on: (event: string, cb: (...args: any[]) => any) => {
      handlers.set('ws:' + event, cb);
      return { __event: 'ws:' + event };
    },
    offref: () => {},
    onLayoutReady: onLayoutReady ?? (() => {}), // Standard: Sweep NICHT starten
  };
  const app = { vault: vaultWithEvents, workspace };
  return { app, handlers, renamed, deleted };
}

async function loadPlugin(vault: VaultMock, onLayoutReady?: (cb: () => any) => void) {
  const { app, handlers, renamed, deleted } = makeApp(vault, onLayoutReady);
  const plugin = new (CrdtSyncPlugin as any)(app, {});
  await plugin.onload();
  return { plugin, handlers, renamed, deleted };
}

describe('Fix B: rename/delete-Handler fassen fremde Sidecars nicht an', () => {
  it('rename note.md → renamed.md lässt die Sidecars von note.md.archive.md unberührt', async () => {
    const vault = makeVaultMock();
    vault._files.set('.qollab/note.md.a1b2c3d4.yjs', new ArrayBuffer(1));
    vault._files.set('.qollab/note.md.yjs', new ArrayBuffer(1));
    vault._files.set('.qollab/note.md.archive.md.a1b2c3d4.yjs', new ArrayBuffer(1));
    vault._files.set('.qollab/note.md.archive.md.yjs', new ArrayBuffer(1));
    vault._textFiles.set('note.md', '');

    const { handlers, renamed } = await loadPlugin(vault);

    // rename-Event: note.md → renamed.md
    const note = tfile('renamed.md');
    await handlers.get('rename')!(note, 'note.md');

    // Nur die eigenen Sidecars wurden umbenannt (Legacy + per-Client).
    expect(renamed.map((r) => r[0]).sort()).toEqual(
      ['.qollab/note.md.a1b2c3d4.yjs', '.qollab/note.md.yjs'].sort()
    );
    // Die Sidecars der Archiv-Note blieben unangetastet.
    expect(vault._files.has('.qollab/note.md.archive.md.a1b2c3d4.yjs')).toBe(true);
    expect(vault._files.has('.qollab/note.md.archive.md.yjs')).toBe(true);
    // Eigene Sidecars zeigen auf den neuen Pfad.
    expect(vault._files.has('.qollab/renamed.md.a1b2c3d4.yjs')).toBe(true);
    expect(vault._files.has('.qollab/renamed.md.yjs')).toBe(true);
    expect(vault._files.has('.qollab/note.md.a1b2c3d4.yjs')).toBe(false);
    expect(vault._files.has('.qollab/note.md.yjs')).toBe(false);
  });

  it('delete note.md löscht nur die eigenen Sidecars, nicht die von note.md.archive.md', async () => {
    const vault = makeVaultMock();
    vault._files.set('.qollab/note.md.a1b2c3d4.yjs', new ArrayBuffer(1));
    vault._files.set('.qollab/note.md.yjs', new ArrayBuffer(1));
    vault._files.set('.qollab/note.md.archive.md.a1b2c3d4.yjs', new ArrayBuffer(1));
    vault._files.set('.qollab/note.md.archive.md.yjs', new ArrayBuffer(1));
    vault._textFiles.set('note.md', '');

    const { handlers, deleted } = await loadPlugin(vault);

    await handlers.get('delete')!(tfile('note.md'));

    expect(deleted.sort()).toEqual(
      ['.qollab/note.md.a1b2c3d4.yjs', '.qollab/note.md.yjs'].sort()
    );
    // Archiv-Sidecars sind noch da.
    expect(vault._files.has('.qollab/note.md.archive.md.a1b2c3d4.yjs')).toBe(true);
    expect(vault._files.has('.qollab/note.md.archive.md.yjs')).toBe(true);
  });
});

describe('SidecarWatcher-Reihenfolge: erst Sweep, dann Initial-Scan', () => {
  it('onLayoutReady ruft snapshotStaleMarkdownFiles VOR sidecarWatcher.poll', async () => {
    const vault = makeVaultMock();
    let layoutCb: (() => any) | null = null;
    const { plugin } = await loadPlugin(vault, (cb) => {
      layoutCb = cb; // Callback nur speichern, nicht sofort ausführen
    });

    const order: string[] = [];
    jest
      .spyOn(plugin as any, 'snapshotStaleMarkdownFiles')
      .mockImplementation(async () => {
        order.push('sweep');
      });
    jest.spyOn((plugin as any).sidecarWatcher, 'poll').mockImplementation(async () => {
      order.push('poll');
    });

    expect(layoutCb).not.toBeNull();
    await layoutCb!();

    expect(order).toEqual(['sweep', 'poll']);
  });
});
