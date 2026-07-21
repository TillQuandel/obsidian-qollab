import { TFile } from 'obsidian';
import { FileWatcher } from '../src/file-watcher';
import { SyncHandler } from '../src/sync-handler';
import { CrdtManager } from '../src/crdt-manager';
import { PathQueue } from '../src/path-queue';

// Testet das Ist-Verhalten des FileWatchers. Er lauscht auf 'modify' UND 'create'
// und triggert den Callback nur für .qollab/<note>.<8-hex-clientId>.yjs-Pfade,
// wobei der eingeklammerte notePath extrahiert wird (QOLLAB_RE in
// src/file-watcher.ts). Das create-Handling schließt die Erstkontakt-Lücke: ein
// fremdes .yjs, das erstmals ERSCHEINT (create-Event), löst bereits beim
// Erstkontakt einen Merge aus — nicht erst bei einem späteren modify.

function makeVaultMock() {
  const handlers = new Map<string, (file: unknown) => unknown>();
  return {
    on(event: string, cb: (file: unknown) => unknown) {
      handlers.set(event, cb);
      return { __event: event };
    },
    offref(ref: unknown) {
      const e = (ref as { __event?: string } | null)?.__event;
      if (e) handlers.delete(e);
    },
    // Default-Emit = modify (Rückwärtskompatibilität der Bestands-Tests).
    async _emit(file: unknown) {
      const cb = handlers.get('modify');
      return cb ? cb(file) : undefined;
    },
    async _emitEvent(event: string, file: unknown) {
      const cb = handlers.get(event);
      return cb ? cb(file) : undefined;
    },
    _hasHandler(event = 'modify') {
      return handlers.has(event);
    },
    _events() {
      return Array.from(handlers.keys());
    },
  };
}

function tfile(path: string): TFile {
  const f = new TFile();
  f.path = path;
  return f;
}

// Eigene clientId des Watchers in diesen Tests. Verschieden von den in den
// Pfaden genutzten Fremd-clientIds (a1b2c3d4, deadbeef), damit die als "fremd"
// gelten und den Callback triggern.
const SELF = '00000000';

describe('FileWatcher', () => {
  it('start() registriert modify- UND create-Handler', () => {
    const vault = makeVaultMock();
    const watcher = new FileWatcher(vault as any, SELF, async () => {});
    watcher.start();
    expect(vault._hasHandler('modify')).toBe(true);
    expect(vault._hasHandler('create')).toBe(true);
  });

  it('triggert Callback und extrahiert notePath für per-Client .yjs (modify)', async () => {
    const vault = makeVaultMock();
    const onChanged = jest.fn(async () => {});
    new FileWatcher(vault as any, SELF, onChanged).start();

    await vault._emit(tfile('.qollab/note.md.a1b2c3d4.yjs'));

    expect(onChanged).toHaveBeenCalledWith('note.md');
  });

  it('extrahiert notePath inklusive Unterverzeichnis', async () => {
    const vault = makeVaultMock();
    const onChanged = jest.fn(async () => {});
    new FileWatcher(vault as any, SELF, onChanged).start();

    await vault._emit(tfile('.qollab/folder/note.md.deadbeef.yjs'));

    expect(onChanged).toHaveBeenCalledWith('folder/note.md');
  });

  it('ignoriert die eigene clientId-Datei (Loop-Schutz)', async () => {
    // saveState schreibt die eigene .yjs selbst; würde der Watcher darauf
    // triggern, entstünde eine Endlos-Schleife.
    const vault = makeVaultMock();
    const onChanged = jest.fn(async () => {});
    new FileWatcher(vault as any, 'a1b2c3d4', onChanged).start();

    await vault._emit(tfile('.qollab/note.md.a1b2c3d4.yjs'));

    expect(onChanged).not.toHaveBeenCalled();
  });

  it('triggert weiterhin für fremde clientId', async () => {
    const vault = makeVaultMock();
    const onChanged = jest.fn(async () => {});
    new FileWatcher(vault as any, 'a1b2c3d4', onChanged).start();

    await vault._emit(tfile('.qollab/note.md.deadbeef.yjs'));

    expect(onChanged).toHaveBeenCalledWith('note.md');
  });

  it('ignoriert Legacy .qollab/note.md.yjs ohne clientId', async () => {
    // QOLLAB_RE verlangt eine 8-stellige Hex-clientId — die clientId-lose
    // Legacy-Datei triggert daher NICHT. (Divergenz zu filterYjsFiles, das
    // sie sehr wohl matcht — bekannt, hier nicht gefixt.)
    const vault = makeVaultMock();
    const onChanged = jest.fn(async () => {});
    new FileWatcher(vault as any, SELF, onChanged).start();

    await vault._emit(tfile('.qollab/note.md.yjs'));

    expect(onChanged).not.toHaveBeenCalled();
  });

  it('ignoriert Nicht-.yjs- und Nicht-.qollab-Pfade', async () => {
    const vault = makeVaultMock();
    const onChanged = jest.fn(async () => {});
    new FileWatcher(vault as any, SELF, onChanged).start();

    await vault._emit(tfile('note.md'));
    await vault._emit(tfile('.qollab/note.md.a1b2c3d4.txt'));
    await vault._emit(tfile('.qollab/note.md.xyz.yjs'));

    expect(onChanged).not.toHaveBeenCalled();
  });

  it('ignoriert Nicht-TFile-Objekte (instanceof-Check)', async () => {
    const vault = makeVaultMock();
    const onChanged = jest.fn(async () => {});
    new FileWatcher(vault as any, SELF, onChanged).start();

    // Plain object mit passendem Pfad, aber kein TFile.
    await vault._emit({ path: '.qollab/note.md.a1b2c3d4.yjs' });

    expect(onChanged).not.toHaveBeenCalled();
  });

  // --- create-Event: schließt die Erstkontakt-Lücke (Fix 1) ---

  it('triggert Callback bei create-Event für fremde .yjs (Erstkontakt)', async () => {
    const vault = makeVaultMock();
    const onChanged = jest.fn(async () => {});
    new FileWatcher(vault as any, SELF, onChanged).start();

    await vault._emitEvent('create', tfile('.qollab/note.md.a1b2c3d4.yjs'));

    expect(onChanged).toHaveBeenCalledWith('note.md');
  });

  it('ignoriert die eigene clientId auch bei create (Loop-Schutz)', async () => {
    const vault = makeVaultMock();
    const onChanged = jest.fn(async () => {});
    new FileWatcher(vault as any, 'a1b2c3d4', onChanged).start();

    await vault._emitEvent('create', tfile('.qollab/note.md.a1b2c3d4.yjs'));

    expect(onChanged).not.toHaveBeenCalled();
  });

  it('ignoriert Nicht-TFile-Objekte auch bei create', async () => {
    const vault = makeVaultMock();
    const onChanged = jest.fn(async () => {});
    new FileWatcher(vault as any, SELF, onChanged).start();

    await vault._emitEvent('create', { path: '.qollab/note.md.a1b2c3d4.yjs' });

    expect(onChanged).not.toHaveBeenCalled();
  });

  it('stop() deregistriert modify UND create', () => {
    const vault = makeVaultMock();
    const watcher = new FileWatcher(vault as any, SELF, async () => {});
    watcher.start();
    watcher.stop();
    expect(vault._hasHandler('modify')).toBe(false);
    expect(vault._hasHandler('create')).toBe(false);
  });
});

function toArrayBuffer(data: ArrayBuffer | Uint8Array): ArrayBuffer {
  return (
    data instanceof Uint8Array
      ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
      : data
  ) as ArrayBuffer;
}

// Integrations-Verdrahtung (schließt die im Review als „nur smoke-getestet"
// bemängelte Lücke): ein create-Event läuft durch einen echten FileWatcher +
// PathQueue in SyncHandler.loadAndMerge, und der gemergte Inhalt landet. Ein
// Happy-Path genügt.
describe('FileWatcher-Verdrahtung (Integration)', () => {
  it('create eines fremden .yjs treibt loadAndMerge → gemergter Inhalt landet', async () => {
    const files = new Map<string, ArrayBuffer>();
    const textFiles = new Map<string, string>();
    const handlers = new Map<string, (file: unknown) => unknown>();
    const vault = {
      on(event: string, cb: (file: unknown) => unknown) {
        handlers.set(event, cb);
        return { __event: event };
      },
      offref() {},
      getAbstractFileByPath: (p: string) =>
        files.has(p) || textFiles.has(p) ? { path: p } : null,
      read: async (f: { path: string }) => textFiles.get(f.path) ?? '',
      readBinary: async (f: { path: string }) => files.get(f.path)!,
      createBinary: async (p: string, d: ArrayBuffer | Uint8Array) => {
        files.set(p, toArrayBuffer(d));
      },
      modifyBinary: async (f: { path: string }, d: ArrayBuffer | Uint8Array) => {
        files.set(f.path, toArrayBuffer(d));
      },
      createFolder: async () => {},
      listYjsFiles: (notePath: string) =>
        Array.from(files.keys()).filter(
          (p) => p.startsWith(`.qollab/${notePath}.`) && p.endsWith('.yjs')
        ),
    };

    // Fremdes Remote-.yjs erscheint erstmals (create-Event).
    const remote = new CrdtManager();
    remote.setContent('note.md', 'Remote-Inhalt\n');
    files.set(
      '.qollab/note.md.a1b2c3d4.yjs',
      remote.encodeState('note.md').buffer as ArrayBuffer
    );

    const manager = new CrdtManager();
    const handler = new SyncHandler(vault as any, manager, SELF);
    const queue = new PathQueue();

    let merged: string | null = null;
    const watcher = new FileWatcher(vault as any, SELF, async (notePath) => {
      await queue.run(notePath, async () => {
        merged = await handler.loadAndMerge(notePath);
      });
    });
    watcher.start();

    // create-Event durch die Verdrahtung treiben.
    await handlers.get('create')!(tfile('.qollab/note.md.a1b2c3d4.yjs'));

    expect(merged).toBe('Remote-Inhalt\n');
  });
});
