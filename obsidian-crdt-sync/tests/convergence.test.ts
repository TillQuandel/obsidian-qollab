import { CrdtManager } from '../src/crdt-manager';
import { SyncHandler } from '../src/sync-handler';

// Rotes Netz für den kaputten Merge-Kern.
//
// Ursache: CrdtManager.setContent macht delete-all + insert-all. Zwei Y.Docs
// ohne geteilte Yjs-Historie, die denselben Text laden, erzeugen getrennte
// Insert-Historien → beim Merge wird konkateniert statt dedupliziert.
//
// Alle vier Tests sind `it.failing`: solange der Bug existiert, gelten sie als
// "passed (expected failure)" und halten die Suite grün. Wird der Merge-Kern in
// einem späteren Task gefixt, schlagen sie an und werden auf `it` umgestellt.
// Assertions ausschliesslich mit `toBe` (exakte Gleichheit), nie `toContain`.

function makeVaultMock() {
  const files = new Map<string, ArrayBuffer>();
  const textFiles = new Map<string, string>();
  return {
    getAbstractFileByPath: (path: string) =>
      files.has(path) || textFiles.has(path) ? { path } : null,
    read: async (file: { path: string }) => textFiles.get(file.path) ?? '',
    readBinary: async (file: { path: string }) => files.get(file.path)!,
    createBinary: async (path: string, data: ArrayBuffer | Uint8Array) => {
      files.set(path, toArrayBuffer(data));
    },
    modifyBinary: async (file: { path: string }, data: ArrayBuffer | Uint8Array) => {
      files.set(file.path, toArrayBuffer(data));
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

function toArrayBuffer(data: ArrayBuffer | Uint8Array): ArrayBuffer {
  return (
    data instanceof Uint8Array
      ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
      : data
  ) as ArrayBuffer;
}

describe('Merge-Kern-Konvergenz (rotes Netz)', () => {
  it.failing('Zwei-Geräte-Erstmerge dedupliziert identischen Text', () => {
    const A = new CrdtManager();
    const B = new CrdtManager();

    // Beide laden denselben Text — aber ohne geteilte Yjs-Historie.
    A.setContent('note.md', 'Hallo Welt\n');
    B.setContent('note.md', 'Hallo Welt\n');

    // B merged As State.
    B.applyUpdate('note.md', A.encodeState('note.md'));

    // Erwartung: genau ein Mal der Text. Ist-Zustand: verdoppelt.
    expect(B.getContent('note.md')).toBe('Hallo Welt\n');
  });

  it.failing('Konvergenz + Korrektheit bei disjunkten Zeilen-Edits', () => {
    const base = 'Zeile 1\nZeile 2\nZeile 3\n';

    // A und B starten mit gemeinsamer Historie desselben Ausgangstextes.
    const A = new CrdtManager();
    A.setContent('note.md', base);
    const B = new CrdtManager();
    B.applyUpdate('note.md', A.encodeState('note.md'));

    // A ändert Zeile 1, B ändert Zeile 3 (jeweils via Volltext-setContent).
    A.setContent('note.md', 'A-Zeile 1\nZeile 2\nZeile 3\n');
    B.setContent('note.md', 'Zeile 1\nZeile 2\nB-Zeile 3\n');

    // Wechselseitiger Austausch.
    A.applyUpdate('note.md', B.encodeState('note.md'));
    B.applyUpdate('note.md', A.encodeState('note.md'));

    const expected = 'A-Zeile 1\nZeile 2\nB-Zeile 3\n';
    // CRDT konvergiert (beide identisch) — aber auf den falschen Inhalt.
    expect(A.getContent('note.md')).toBe(B.getContent('note.md'));
    expect(A.getContent('note.md')).toBe(expected);
  });

  it.failing('Cold-Start über loadAndMerge ist idempotent', async () => {
    const vault = makeVaultMock();
    const text = 'Hallo Welt\n';

    // Note liegt als .md vor und hat eine eigene .yjs aus demselben Text.
    vault._textFiles.set('note.md', text);
    const source = new CrdtManager();
    source.setContent('note.md', text);
    vault._files.set(
      '.qollab/note.md.a1b2c3d4.yjs',
      source.encodeState('note.md').buffer as ArrayBuffer
    );

    // Frischer Manager — Doc nicht geladen → loadAndMerge injiziert die .md
    // als frische Historie und merged danach die (historien-fremde) .yjs.
    const manager = new CrdtManager();
    const handler = new SyncHandler(vault as any, manager, 'local000');

    const merged = await handler.loadAndMerge('note.md');
    expect(merged).toBe(text);
  });

  it.failing('Nur-Remote-Änderung wird ohne Verdopplung übernommen', async () => {
    const vault = makeVaultMock();
    const OLD = 'Zeile 1\nZeile 2\n';
    const NEW = 'Zeile 1\nZeile 2 geändert\n';

    // Gemeinsamer alter Stand als Basis-Historie.
    const base = new CrdtManager();
    base.setContent('note.md', OLD);
    const baseState = base.encodeState('note.md');

    // Remote baut seine Änderung auf dieser geteilten Historie auf.
    const remote = new CrdtManager();
    remote.applyUpdate('note.md', baseState);
    remote.setContent('note.md', NEW);
    vault._files.set(
      '.qollab/note.md.remote01.yjs',
      remote.encodeState('note.md').buffer as ArrayBuffer
    );

    // Lokale .md hält den alten Stand; lokaler Manager ist frisch (Doc nicht
    // geladen) → loadAndMerge injiziert OLD als eigene Historie, die der
    // Remote-Delete nicht trifft → alter Stand bleibt neben NEW stehen.
    vault._textFiles.set('note.md', OLD);
    const manager = new CrdtManager();
    const handler = new SyncHandler(vault as any, manager, 'local000');

    const merged = await handler.loadAndMerge('note.md');
    expect(merged).toBe(NEW);
  });
});
