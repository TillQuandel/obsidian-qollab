import { SidecarWatcher, SCAN_INTERVAL_MS, SidecarWatcherHost } from '../src/sidecar-watcher';
import { SyncHandler } from '../src/sync-handler';
import { CrdtManager } from '../src/crdt-manager';
import { PathQueue } from '../src/path-queue';
import { makeVaultMock, toArrayBuffer } from './helpers/vault-mock';

// Der SidecarWatcher ersetzt den event-basierten FileWatcher: Obsidian feuert für
// .qollab keine Vault-Events (Dot-Ordner-Blindheit). Er scannt den .qollab-Baum
// per Adapter (poll) und mtime-Vergleich, plus Sofort-Trigger beim Öffnen (scanNote).
// Er übernimmt Filter/Extraktion (QOLLAB_RE/Legacy, .md-Anker, Self-Ignore).

// Eigene clientId in diesen Tests. Verschieden von den Fremd-clientIds in den
// Pfaden (a1b2c3d4, deadbeef), damit die als „fremd" gelten.
const SELF = '00000000';

const ab = () => new ArrayBuffer(1);

describe('SidecarWatcher.poll', () => {
  it('triggert für neue fremde per-Client-Sidecar und extrahiert den notePath', async () => {
    const vault = makeVaultMock();
    vault._files.set('.qollab/note.md.a1b2c3d4.yjs', ab());
    const onChanged = jest.fn(async () => {});
    await new SidecarWatcher(vault.adapter, SELF, onChanged).poll();
    expect(onChanged).toHaveBeenCalledWith('note.md');
  });

  it('extrahiert den notePath inklusive Unterverzeichnis', async () => {
    const vault = makeVaultMock();
    vault._files.set('.qollab/folder/note.md.deadbeef.yjs', ab());
    const onChanged = jest.fn(async () => {});
    await new SidecarWatcher(vault.adapter, SELF, onChanged).poll();
    expect(onChanged).toHaveBeenCalledWith('folder/note.md');
  });

  it('ignoriert die eigene clientId-Datei (Loop-Schutz)', async () => {
    const vault = makeVaultMock();
    vault._files.set('.qollab/note.md.00000000.yjs', ab());
    const onChanged = jest.fn(async () => {});
    await new SidecarWatcher(vault.adapter, SELF, onChanged).poll();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('triggert bei Legacy .qollab/note.md.yjs ohne clientId', async () => {
    const vault = makeVaultMock();
    vault._files.set('.qollab/note.md.yjs', ab());
    const onChanged = jest.fn(async () => {});
    await new SidecarWatcher(vault.adapter, SELF, onChanged).poll();
    expect(onChanged).toHaveBeenCalledWith('note.md');
  });

  it('per-Client-Match hat Vorrang: clientId wird NICHT in den notePath geschluckt', async () => {
    const vault = makeVaultMock();
    vault._files.set('.qollab/note.md.a1b2c3d4.yjs', ab());
    const onChanged = jest.fn(async () => {});
    await new SidecarWatcher(vault.adapter, SELF, onChanged).poll();
    expect(onChanged).toHaveBeenCalledWith('note.md');
    expect(onChanged).not.toHaveBeenCalledWith('note.md.a1b2c3d4');
  });

  it('ignoriert Sync-Konfliktkopien (Gerätename/sync-conflict/Leerzeichen — .md-Anker)', async () => {
    const vault = makeVaultMock();
    vault._files.set('.qollab/note.md.a1b2c3d4-DESKTOP.yjs', ab());
    vault._files.set('.qollab/note.md.sync-conflict-20260722.yjs', ab());
    vault._files.set('.qollab/note.md.deadbeef (1).yjs', ab());
    const onChanged = jest.fn(async () => {});
    await new SidecarWatcher(vault.adapter, SELF, onChanged).poll();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('unveränderte Datei löst beim zweiten Poll keinen erneuten Trigger aus', async () => {
    const vault = makeVaultMock();
    vault._files.set('.qollab/note.md.a1b2c3d4.yjs', ab());
    const onChanged = jest.fn(async () => {});
    const w = new SidecarWatcher(vault.adapter, SELF, onChanged);
    await w.poll();
    onChanged.mockClear();
    await w.poll();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('geänderte mtime löst einen erneuten Trigger aus', async () => {
    const vault = makeVaultMock();
    const p = '.qollab/note.md.a1b2c3d4.yjs';
    vault._files.set(p, ab());
    const onChanged = jest.fn(async () => {});
    const w = new SidecarWatcher(vault.adapter, SELF, onChanged);
    await w.poll();
    onChanged.mockClear();
    vault._mtimes.set(p, 999); // Datei extern verändert
    await w.poll();
    expect(onChanged).toHaveBeenCalledWith('note.md');
  });

  it('gelöschte Datei: kein Trigger, Map-Eintrag wird vergessen (Re-Add triggert wieder)', async () => {
    const vault = makeVaultMock();
    const p = '.qollab/note.md.a1b2c3d4.yjs';
    vault._files.set(p, ab());
    const onChanged = jest.fn(async () => {});
    const w = new SidecarWatcher(vault.adapter, SELF, onChanged);
    await w.poll(); // trigger, prev gemerkt
    onChanged.mockClear();

    vault._files.delete(p);
    await w.poll(); // kein Trigger für Löschung
    expect(onChanged).not.toHaveBeenCalled();

    vault._files.set(p, ab());
    await w.poll(); // Map-Eintrag war weg → gilt wieder als neu → Trigger
    expect(onChanged).toHaveBeenCalledWith('note.md');
  });

  it('Initial-Scan: alle beim Start vorhandenen fremden Sidecars gelten als neu', async () => {
    const vault = makeVaultMock();
    vault._files.set('.qollab/a.md.a1b2c3d4.yjs', ab());
    vault._files.set('.qollab/sub/b.md.deadbeef.yjs', ab());
    const onChanged = jest.fn(async () => {});
    await new SidecarWatcher(vault.adapter, SELF, onChanged).poll();
    expect(onChanged).toHaveBeenCalledWith('a.md');
    expect(onChanged).toHaveBeenCalledWith('sub/b.md');
  });
});

describe('SidecarWatcher.scanNote (file-open-Sofort-Trigger)', () => {
  it('triggert für die geöffnete Note, wenn eine fremde Sidecar existiert', async () => {
    const vault = makeVaultMock();
    vault._files.set('.qollab/note.md.a1b2c3d4.yjs', ab());
    const onChanged = jest.fn(async () => {});
    await new SidecarWatcher(vault.adapter, SELF, onChanged).scanNote('note.md');
    expect(onChanged).toHaveBeenCalledWith('note.md');
  });

  it('ignoriert die eigene clientId (kein Trigger)', async () => {
    const vault = makeVaultMock();
    vault._files.set('.qollab/note.md.00000000.yjs', ab());
    const onChanged = jest.fn(async () => {});
    await new SidecarWatcher(vault.adapter, SELF, onChanged).scanNote('note.md');
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('fasst fremde Sidecars anderer Notes nicht an (exakter Match)', async () => {
    const vault = makeVaultMock();
    vault._files.set('.qollab/other.md.a1b2c3d4.yjs', ab());
    const onChanged = jest.fn(async () => {});
    await new SidecarWatcher(vault.adapter, SELF, onChanged).scanNote('note.md');
    expect(onChanged).not.toHaveBeenCalled();
  });
});

describe('SidecarWatcher.start/stop', () => {
  it('registriert Intervall (SCAN_INTERVAL_MS) + file-open und räumt beim stop() ab', async () => {
    const vault = makeVaultMock();
    const w = new SidecarWatcher(vault.adapter, SELF, jest.fn(async () => {}));
    const scanSpy = jest.spyOn(w, 'scanNote').mockResolvedValue();

    let intervalMs = 0;
    let fileOpenCb: ((p: string | null) => void) | null = null;
    const disposed: string[] = [];
    const host: SidecarWatcherHost = {
      registerInterval: (_fn, ms) => {
        intervalMs = ms;
        return () => disposed.push('interval');
      },
      onFileOpen: (cb) => {
        fileOpenCb = cb;
        return () => disposed.push('fileopen');
      },
    };

    w.start(host);
    expect(intervalMs).toBe(SCAN_INTERVAL_MS);

    // file-open einer .md → scanNote der geöffneten Note.
    expect(fileOpenCb).not.toBeNull();
    fileOpenCb!('note.md');
    expect(scanSpy).toHaveBeenCalledWith('note.md');

    // Nicht-.md und null lösen keinen Scan aus.
    fileOpenCb!('bild.png');
    fileOpenCb!(null);
    expect(scanSpy).toHaveBeenCalledTimes(1);

    w.stop();
    expect(disposed.sort()).toEqual(['fileopen', 'interval']);
  });
});

// Integration: ein Poll treibt SyncHandler.loadAndMerge über die PathQueue, und der
// gemergte Inhalt landet — analog zur früheren FileWatcher-Verdrahtung.
describe('SidecarWatcher-Verdrahtung (Integration)', () => {
  it('poll eines fremden .yjs treibt loadAndMerge → gemergter Inhalt landet', async () => {
    const vault = makeVaultMock();
    const remote = new CrdtManager();
    remote.setContent('note.md', 'Remote-Inhalt\n');
    vault._files.set(
      '.qollab/note.md.a1b2c3d4.yjs',
      toArrayBuffer(remote.encodeState('note.md'))
    );
    vault._textFiles.set('note.md', 'Remote-Inhalt\n');

    const handler = new SyncHandler(vault as any, new CrdtManager(), SELF);
    const queue = new PathQueue();
    let merged: string | null = null;

    const watcher = new SidecarWatcher(vault.adapter, SELF, async (notePath) => {
      await queue.run(notePath, async () => {
        merged = await handler.loadAndMerge(notePath);
      });
    });

    await watcher.poll();
    expect(merged).toBe('Remote-Inhalt\n');
  });
});
