import { SyncHandler } from '../src/sync-handler';
import { CrdtManager } from '../src/crdt-manager';
import { PathQueue } from '../src/path-queue';

// Task 4, Abschnitt D: Regressions-Test „paralleles modify verliert kein Update".
//
// Aufbau auf SyncHandler/PathQueue-Ebene mit Vault-Mock. `readBinary` der
// Remote-Sibling ist künstlich verzögert (manueller Resolve). Während ein via
// Queue laufendes loadAndMerge in dieser Verzögerung hängt, wird die
// modify-Handler-Arbeit (Read der .md + applyLocalContent) über DIESELBE Queue
// eingereiht. Die Serialisierung garantiert, dass der .md-Read erst NACH dem
// Merge-Write-Back läuft — die lokale Änderung baut damit auf dem gemergten
// Remote-Stand auf, statt ihn per Volltext-setContent zu überschreiben.

const NOTE = 'note.md';
const REMOTE_YJS = '.qollab/note.md.remote01.yjs';

const BASE = 'Zeile 1\nZeile 2\n';
const REMOTE = 'Zeile 1 REMOTE\nZeile 2\n'; // Remote ändert Zeile 1
const MERGED = 'Zeile 1 REMOTE\nZeile 2 LOCAL\n'; // + lokal Zeile 2

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function toAB(data: ArrayBuffer | Uint8Array): ArrayBuffer {
  return (
    data instanceof Uint8Array
      ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
      : data
  ) as ArrayBuffer;
}

function makeVaultMock() {
  const files = new Map<string, ArrayBuffer>();
  const textFiles = new Map<string, string>();
  return {
    getAbstractFileByPath: (path: string) =>
      files.has(path) || textFiles.has(path) ? { path } : null,
    read: async (file: { path: string }) => textFiles.get(file.path) ?? '',
    readBinary: async (file: { path: string }) => files.get(file.path)!,
    createBinary: async (path: string, data: ArrayBuffer | Uint8Array) => {
      files.set(path, toAB(data));
    },
    modifyBinary: async (file: { path: string }, data: ArrayBuffer | Uint8Array) => {
      files.set(file.path, toAB(data));
    },
    createFolder: async (_path: string) => {},
    listYjsFiles: (notePath: string) =>
      Array.from(files.keys()).filter(
        (p) => p.startsWith(`.qollab/${notePath}.`) && p.endsWith('.yjs')
      ),
    _files: files,
    _textFiles: textFiles,
  };
}

// Baut die Ausgangslage: gemeinsame Basis-Historie, eine fremde Remote-.yjs mit
// einer Änderung auf Zeile 1, lokale .md steht noch auf der Basis. `readBinary`
// der Remote-Sibling wird beim ERSTEN Zugriff verzögert.
function setup() {
  const vault = makeVaultMock();

  const base = new CrdtManager();
  base.setContent(NOTE, BASE);
  const baseState = base.encodeState(NOTE);

  const remote = new CrdtManager();
  remote.applyUpdate(NOTE, baseState);
  remote.setContent(NOTE, REMOTE);
  vault._files.set(REMOTE_YJS, remote.encodeState(NOTE).buffer as ArrayBuffer);

  vault._textFiles.set(NOTE, BASE);

  let releaseRemote!: () => void;
  const remoteGate = new Promise<void>((r) => {
    releaseRemote = r;
  });
  let gated = false;
  const rawReadBinary = vault.readBinary;
  vault.readBinary = async (file: { path: string }) => {
    if (file.path === REMOTE_YJS && !gated) {
      gated = true;
      await remoteGate;
    }
    return rawReadBinary(file);
  };

  const manager = new CrdtManager();
  const handler = new SyncHandler(vault as any, manager, 'local000');
  return { vault, manager, handler, releaseRemote: () => releaseRemote() };
}

describe('Nebenläufigkeit: paralleles modify verliert kein Update (Task 4 D)', () => {
  it('MIT Queue: Read der .md liegt in der Task → beide Änderungen überleben', async () => {
    const { vault, manager, handler, releaseRemote } = setup();
    const queue = new PathQueue();

    // Task 1: onRemoteYjsUpdate-Analogon — Merge + Write-Back in die .md.
    const p1 = queue.run(NOTE, async () => {
      const merged = await handler.loadAndMerge(NOTE);
      if (merged !== null) vault._textFiles.set(NOTE, merged);
    });

    // p1 bis in den verzögerten readBinary laufen lassen.
    await tick();

    // Task 2: modify-Handler-Analogon — der .md-Read liegt INNERHALB der Task,
    // läuft also erst nach dem Write-Back von Task 1.
    let task2Started = false;
    const p2 = queue.run(NOTE, async () => {
      task2Started = true;
      const current = await vault.read({ path: NOTE });
      await handler.applyLocalContent(NOTE, current.replace('Zeile 2', 'Zeile 2 LOCAL'));
    });

    // Serialisierungs-Beleg: Task 2 hat noch nicht begonnen, solange Task 1 hängt.
    expect(task2Started).toBe(false);

    releaseRemote();
    await Promise.all([p1, p2]);

    // getContent enthält exakt Remote- UND lokale Änderung.
    expect(manager.getContent(NOTE)).toBe(MERGED);

    // Eigene .yjs enthält beide Historien: frischer Handler rekonstruiert exakt.
    const freshManager = new CrdtManager();
    const freshHandler = new SyncHandler(vault as any, freshManager, 'local000');
    const reloaded = await freshHandler.loadAndMerge(NOTE);
    expect(reloaded).toBe(MERGED);
  });

  it('OHNE Serialisierung (alter Stand): stale .md-Read überschreibt den Remote-Merge (Race-Beleg)', async () => {
    // Charakterisiert die Race-Anfälligkeit des alten, nicht queue-gebundenen
    // modify-Handlers: er liest die .md zum Event-Zeitpunkt (noch Basis, vor dem
    // Write-Back) und sein Volltext-setContent landet als letzte Mutation — die
    // frisch gemergte Remote-Änderung geht verloren.
    const { vault, manager, handler, releaseRemote } = setup();

    // Alter modify-Handler: liest die .md sofort (stale = Basis).
    const stale = await vault.read({ path: NOTE });

    // Remote-Merge läuft (ohne Serialisierung) und schreibt zurück.
    releaseRemote();
    const merged = await handler.loadAndMerge(NOTE);
    if (merged !== null) vault._textFiles.set(NOTE, merged);

    // Stale lokale Änderung landet zuletzt → überschreibt Zeile 1 zurück.
    await handler.applyLocalContent(NOTE, stale.replace('Zeile 2', 'Zeile 2 LOCAL'));

    expect(manager.getContent(NOTE)).toBe('Zeile 1\nZeile 2 LOCAL\n');
    expect(manager.getContent(NOTE)).not.toBe(MERGED); // Remote-Änderung verloren
  });
});
