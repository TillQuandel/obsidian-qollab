// C.2 — Regressionsnetz „Obsidian-Realität".
//
// Der Vault-Index ist blind für Dot-Ordner: getAbstractFileByPath('.qollab/…')
// liefert immer null, getFiles() enthält keine .qollab-Dateien. Der Adapter sieht
// sie dagegen. makeVaultMock bildet genau das ab.
//
// Gegen den ALTEN, index-basierten Sidecar-IO-Pfad schlugen beide Tests fehl (RED,
// im Task-Report belegt): saveState war nach der Erstanlage ein Silent-No-Op und
// listYjsFiles (aus getFiles gebaut) fand die Sidecar nie. Nach der Umstellung auf
// vault.adapter sind sie grün — der CRDT-Pfad funktioniert in echten Vaults.

import { SyncHandler } from '../src/sync-handler';
import { CrdtManager } from '../src/crdt-manager';
import { decodeStateFile } from '../src/state-file';
import { makeVaultMock, toArrayBuffer } from './helpers/vault-mock';

describe('C.2 Obsidian-Realität (Adapter sieht, was der Index nicht sieht)', () => {
  it('der Index ist blind für .qollab, der Adapter nicht (Vorbedingung)', async () => {
    const vault = makeVaultMock();
    const remote = new CrdtManager();
    remote.setContent('note.md', 'x\n');
    vault._files.set('.qollab/note.md.a1b2c3d4.yjs', toArrayBuffer(remote.encodeState('note.md')));

    // Index blind:
    expect(vault.getAbstractFileByPath('.qollab/note.md.a1b2c3d4.yjs')).toBeNull();
    expect(vault.getFiles().map((f) => f.path)).not.toContain(
      '.qollab/note.md.a1b2c3d4.yjs'
    );
    // Adapter sieht die Datei:
    expect(await vault.adapter.exists('.qollab/note.md.a1b2c3d4.yjs')).toBe(true);
  });

  it('saveState persistiert den ZWEITEN Schreibstand (kein Silent-No-Op)', async () => {
    const vault = makeVaultMock() as any;
    const mgr = new CrdtManager();
    const handler = new SyncHandler(vault, mgr, 'a1b2c3d4');

    vault._textFiles.set('note.md', 'ERSTER');
    await handler.applyLocalContent('note.md', 'ERSTER');

    vault._textFiles.set('note.md', 'ZWEITER');
    await handler.applyLocalContent('note.md', 'ZWEITER');

    const bytes = vault._files.get('.qollab/note.md.a1b2c3d4.yjs');
    expect(bytes).toBeDefined();
    const { update } = decodeStateFile(new Uint8Array(bytes));
    const check = new CrdtManager();
    check.applyUpdate('note.md', update);
    expect(check.getContent('note.md')).toBe('ZWEITER');
  });

  it('loadAndMerge findet eine fremde Sidecar, die der Index nicht kennt', async () => {
    const vault = makeVaultMock() as any;
    const remote = new CrdtManager();
    remote.setContent('note.md', 'REMOTE-INHALT\n');
    vault._files.set(
      '.qollab/note.md.a1b2c3d4.yjs',
      toArrayBuffer(remote.encodeState('note.md'))
    );
    vault._textFiles.set('note.md', 'REMOTE-INHALT\n');

    const handler = new SyncHandler(vault, new CrdtManager(), '10ca1000');
    const merged = await handler.loadAndMerge('note.md');
    expect(merged).toContain('REMOTE-INHALT');
  });
});
