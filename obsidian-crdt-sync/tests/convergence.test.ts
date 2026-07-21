import { CrdtManager } from '../src/crdt-manager';
import { SyncHandler } from '../src/sync-handler';

// Konvergenz-Netz für den Merge-Kern.
//
// Nach Task 2 ist setContent diff-basiert (unveränderte Zeichen behalten ihre
// Item-IDs) und der Doc-Bootstrap läuft nie über den .md-Text, sondern über
// vorhandenen State (eigene .yjs bzw. adoptierte fremde Sibling-.yjs). Damit
// dedupliziert der Merge statt zu konkatenieren.
//
// Dokumentierter Grenzfall „Simultan-Erstkontakt": Zwei Replikate, die OHNE
// jede geteilte Basis und OHNE Sibling-Dateien unabhängig denselben Text
// setzen und dann direkt auf CrdtManager-Ebene mergen, bleiben prinzipbedingt
// Konkatenation (getrennte Insert-Historien, kein gemeinsamer Ursprung). Dieser
// Fall wird von Task 2 NICHT aufgelöst und daher nicht als Test geführt — der
// reale Pfad (SyncHandler.loadAndMerge mit Basis-Adoption) ist Test 1 unten.
//
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

describe('Merge-Kern-Konvergenz', () => {
  it('Zwei-Geräte-Erstmerge über SyncHandler dedupliziert (Basis-Adoption)', async () => {
    // Realer Pfad statt Manager-Level-Simultan-Erstkontakt: Gerät B hat KEINEN
    // eigenen State, sieht aber As .yjs als Sibling und hält lokal dieselbe .md.
    // ensureDoc adoptiert As Historie als Basis und spielt die .md NICHT ein →
    // exakt ein Text, keine Verdopplung.
    const vault = makeVaultMock();
    const text = 'Hallo Welt\n';

    const A = new CrdtManager();
    A.setContent('note.md', text);
    vault._files.set(
      '.qollab/note.md.aaaa1111.yjs',
      A.encodeState('note.md').buffer as ArrayBuffer
    );

    vault._textFiles.set('note.md', text);
    const B = new CrdtManager();
    const handler = new SyncHandler(vault as any, B, 'bbbb2222');

    const merged = await handler.loadAndMerge('note.md');
    expect(merged).toBe(text);
  });

  it('Konvergenz + Korrektheit bei disjunkten Zeilen-Edits', () => {
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
    // Diff-basiert: unveränderte Zeichen behalten ihre IDs → beide Edits
    // koexistieren an ihrer Position, kein Duplikat.
    expect(A.getContent('note.md')).toBe(B.getContent('note.md'));
    expect(A.getContent('note.md')).toBe(expected);
  });

  it('Cold-Start über loadAndMerge ist idempotent', async () => {
    const vault = makeVaultMock();
    const text = 'Hallo Welt\n';

    // Note liegt als .md vor und hat eine (fremde) .yjs aus demselben Text.
    vault._textFiles.set('note.md', text);
    const source = new CrdtManager();
    source.setContent('note.md', text);
    vault._files.set(
      '.qollab/note.md.a1b2c3d4.yjs',
      source.encodeState('note.md').buffer as ArrayBuffer
    );

    // Frischer Manager — Doc nicht geladen → ensureDoc adoptiert die vorhandene
    // .yjs als Basis (statt die .md als frische Historie einzuspielen).
    const manager = new CrdtManager();
    const handler = new SyncHandler(vault as any, manager, 'local000');

    const merged = await handler.loadAndMerge('note.md');
    expect(merged).toBe(text);
  });

  it('Nur-Remote-Änderung wird ohne Verdopplung übernommen', async () => {
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
    // geladen) → ensureDoc adoptiert die Remote-Historie als Basis, die .md wird
    // NICHT eingespielt → nur die Remote-Änderung bleibt stehen.
    vault._textFiles.set('note.md', OLD);
    const manager = new CrdtManager();
    const handler = new SyncHandler(vault as any, manager, 'local000');

    const merged = await handler.loadAndMerge('note.md');
    expect(merged).toBe(NEW);
  });
});
