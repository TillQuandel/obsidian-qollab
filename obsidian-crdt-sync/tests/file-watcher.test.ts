import { TFile } from 'obsidian';
import { FileWatcher } from '../src/file-watcher';

// Testet das Ist-Verhalten des FileWatchers. Er lauscht auf 'modify' und
// triggert den Callback nur für .qollab/<note>.<8-hex-clientId>.yjs-Pfade,
// wobei der eingeklammerte notePath extrahiert wird (QOLLAB_RE in
// src/file-watcher.ts).

function makeVaultMock() {
  let handler: ((file: unknown) => unknown) | null = null;
  const ref = { id: 'modify-ref' };
  return {
    on(_event: string, cb: (file: unknown) => unknown) {
      handler = cb;
      return ref;
    },
    offref(r: unknown) {
      if (r === ref) handler = null;
    },
    async _emit(file: unknown) {
      return handler ? handler(file) : undefined;
    },
    _hasHandler() {
      return handler !== null;
    },
    _ref: ref,
  };
}

function tfile(path: string): TFile {
  const f = new TFile();
  f.path = path;
  return f;
}

describe('FileWatcher', () => {
  it('start() registriert einen modify-Handler', () => {
    const vault = makeVaultMock();
    const watcher = new FileWatcher(vault as any, async () => {});
    watcher.start();
    expect(vault._hasHandler()).toBe(true);
  });

  it('triggert Callback und extrahiert notePath für per-Client .yjs', async () => {
    const vault = makeVaultMock();
    const onChanged = jest.fn(async () => {});
    new FileWatcher(vault as any, onChanged).start();

    await vault._emit(tfile('.qollab/note.md.a1b2c3d4.yjs'));

    expect(onChanged).toHaveBeenCalledWith('note.md');
  });

  it('extrahiert notePath inklusive Unterverzeichnis', async () => {
    const vault = makeVaultMock();
    const onChanged = jest.fn(async () => {});
    new FileWatcher(vault as any, onChanged).start();

    await vault._emit(tfile('.qollab/folder/note.md.deadbeef.yjs'));

    expect(onChanged).toHaveBeenCalledWith('folder/note.md');
  });

  it('ignoriert Legacy .qollab/note.md.yjs ohne clientId', async () => {
    // QOLLAB_RE verlangt eine 8-stellige Hex-clientId — die clientId-lose
    // Legacy-Datei triggert daher NICHT. (Divergenz zu filterYjsFiles, das
    // sie sehr wohl matcht — bekannt, hier nicht gefixt.)
    const vault = makeVaultMock();
    const onChanged = jest.fn(async () => {});
    new FileWatcher(vault as any, onChanged).start();

    await vault._emit(tfile('.qollab/note.md.yjs'));

    expect(onChanged).not.toHaveBeenCalled();
  });

  it('ignoriert Nicht-.yjs- und Nicht-.qollab-Pfade', async () => {
    const vault = makeVaultMock();
    const onChanged = jest.fn(async () => {});
    new FileWatcher(vault as any, onChanged).start();

    await vault._emit(tfile('note.md'));
    await vault._emit(tfile('.qollab/note.md.a1b2c3d4.txt'));
    await vault._emit(tfile('.qollab/note.md.xyz.yjs'));

    expect(onChanged).not.toHaveBeenCalled();
  });

  it('ignoriert Nicht-TFile-Objekte (instanceof-Check)', async () => {
    const vault = makeVaultMock();
    const onChanged = jest.fn(async () => {});
    new FileWatcher(vault as any, onChanged).start();

    // Plain object mit passendem Pfad, aber kein TFile.
    await vault._emit({ path: '.qollab/note.md.a1b2c3d4.yjs' });

    expect(onChanged).not.toHaveBeenCalled();
  });

  it('stop() deregistriert den Handler', () => {
    const vault = makeVaultMock();
    const watcher = new FileWatcher(vault as any, async () => {});
    watcher.start();
    watcher.stop();
    expect(vault._hasHandler()).toBe(false);
  });
});
