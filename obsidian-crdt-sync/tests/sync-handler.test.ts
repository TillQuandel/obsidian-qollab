import { SyncHandler } from '../src/sync-handler';
import { CrdtManager } from '../src/crdt-manager';
import { encodeStateFile } from '../src/state-file';
import { makeVaultMock, toArrayBuffer, toArrayBuffer as toAB } from './helpers/vault-mock';

describe('SyncHandler', () => {
  it('stateFilePath gibt per-User .yjs-Pfad zurück', () => {
    const vault = makeVaultMock() as any;
    const handler = new SyncHandler(vault, new CrdtManager(), 'a1b2c3d4');
    expect(handler.stateFilePath('folder/note.md')).toBe('.qollab/folder/note.md.a1b2c3d4.yjs');
  });

  it('saveState schreibt .yjs-Datei in Vault', async () => {
    const vault = makeVaultMock() as any;
    const manager = new CrdtManager();
    manager.setContent('note.md', 'Hallo');
    const handler = new SyncHandler(vault, manager, 'a1b2c3d4');

    await handler.saveState('note.md');

    expect(vault._files.has('.qollab/note.md.a1b2c3d4.yjs')).toBe(true);
  });

  it('loadAndMerge liest .yjs-Datei und gibt gemergten Inhalt zurück', async () => {
    const vault = makeVaultMock() as any;

    const remote = new CrdtManager();
    remote.setContent('note.md', 'Remote-Inhalt');
    vault._files.set('.qollab/note.md.a1b2c3d4.yjs', remote.encodeState('note.md').buffer);

    const manager = new CrdtManager();
    manager.setContent('note.md', 'Lokal-Inhalt');
    const handler = new SyncHandler(vault, manager, 'a1b2c3d4');

    const merged = await handler.loadAndMerge('note.md');
    expect(merged).toContain('Remote-Inhalt');
    expect(merged).toContain('Lokal-Inhalt');
  });

  it('loadAndMerge übernimmt persistierten State und spielt stale .md NICHT ein (Task 2, D.3)', async () => {
    // Neue Semantik: loadAndMerge bootstrappt den Doc aus persistiertem State
    // (hier die vorhandene .yjs) und injiziert den lokalen .md-Text NICHT mehr.
    // Eine ggf. veraltete .md wird ignoriert — sonst würde sie ankommende
    // Remote-Edits rückgängig machen. Frühere Fassung dieses Tests pinnte genau
    // die entfernte .md-Injektion; sie ist durch D.3 obsolet.
    const vault = makeVaultMock() as any;

    // Stale lokaler Text, seit Plugin-Start nie in den CRDT gebracht.
    vault._textFiles.set('note.md', 'Alices stale lokaler Text');

    // Persistierter Stand liegt in der .yjs.
    const remote = new CrdtManager();
    remote.setContent('note.md', 'Bobs Remote-Text');
    vault._files.set('.qollab/note.md.a1b2c3d4.yjs', remote.encodeState('note.md').buffer);

    const manager = new CrdtManager(); // leerer Doc — kein setContent
    const handler = new SyncHandler(vault, manager, 'a1b2c3d4');

    const merged = await handler.loadAndMerge('note.md');
    expect(merged).toBe('Bobs Remote-Text');
  });

  it('loadAndMerge persistiert die übernommene Fremd-Historie (Neustart-fest)', async () => {
    const vault = makeVaultMock() as any;

    // Fremde Sibling-.yjs mit dem gemergten Stand.
    const remote = new CrdtManager();
    remote.setContent('note.md', 'Gemergter Stand\n');
    vault._files.set('.qollab/note.md.5e307e01.yjs', remote.encodeState('note.md').buffer);
    // Task 13/C: Ohne existierende .md würde der Phantom-Guard greifen (kein
    // eigener State für eine Note, die es hier nicht gibt) — die .md gehört zu
    // diesem Szenario ohnehin dazu.
    vault._textFiles.set('note.md', 'Gemergter Stand\n');

    const manager = new CrdtManager();
    const handler = new SyncHandler(vault, manager, '10ca1000');

    const merged = await handler.loadAndMerge('note.md');
    expect(merged).toBe('Gemergter Stand\n');
    // Eigene .yjs wurde geschrieben.
    expect(vault._files.has('.qollab/note.md.10ca1000.yjs')).toBe(true);

    // Neustart: fremde .yjs verschwindet, nur die eigene bleibt sichtbar.
    vault._files.delete('.qollab/note.md.5e307e01.yjs');
    const freshManager = new CrdtManager();
    const freshHandler = new SyncHandler(vault, freshManager, '10ca1000');

    const reloaded = await freshHandler.loadAndMerge('note.md');
    expect(reloaded).toBe('Gemergter Stand\n');
  });

  it('loadAndMerge gibt null zurück wenn keine .yjs-Datei existiert', async () => {
    const vault = makeVaultMock() as any;
    const handler = new SyncHandler(vault, new CrdtManager(), 'a1b2c3d4');
    expect(await handler.loadAndMerge('nicht-vorhanden.md')).toBeNull();
  });

  it('loadAndMerge merged Änderungen von zwei verschiedenen Clients', async () => {
    const vault = makeVaultMock() as any;

    const alice = new CrdtManager();
    alice.setContent('note.md', 'Alices Text\n');
    vault._files.set('.qollab/note.md.a11ce001.yjs', alice.encodeState('note.md').buffer);

    const bob = new CrdtManager();
    bob.setContent('note.md', 'Bobs Text\n');
    vault._files.set('.qollab/note.md.b0b00001.yjs', bob.encodeState('note.md').buffer);

    // Task 13/C: Die Note existiert lokal (sonst greift der Phantom-Guard).
    vault._textFiles.set('note.md', 'Alices Text\n');

    const manager = new CrdtManager();
    const handler = new SyncHandler(vault, manager, '10ca1000');

    const merged = await handler.loadAndMerge('note.md');
    expect(merged).toContain('Alices Text');
    expect(merged).toContain('Bobs Text');
  });

  // R1-Semantik: Legacy-Datei (.qollab/note.md.yjs, kein Header, guid null) wird
  // ignoriert und gelöscht, sobald ein GUID-tragender Sidecar existiert.
  // Testfall (a): GUID-Sidecar vorhanden → Legacy-Inhalt taucht NICHT im Merge auf.
  it('loadAndMerge ignoriert Legacy .yjs und löscht sie wenn GUID-Sidecar existiert (R1)', async () => {
    const vault = makeVaultMock() as any;

    // Legacy-Datei mit altem Inhalt (kein QLB1-Header)
    const old = new CrdtManager();
    old.setContent('note.md', 'Alter Inhalt\n');
    vault._files.set('.qollab/note.md.yjs', old.encodeState('note.md').buffer);

    // GUID-tragender Sidecar mit neuem Inhalt. Task 13: vorher wurde hier ein
    // ROHER State ohne QLB1-Header abgelegt — damit war auch diese Datei Legacy,
    // die R1-Regel (Legacy nur ohne GUID-State) griff gar nicht, und der Test war
    // nur grün, weil das anschließende 2-Wege-`setContent(mdText)` den
    // Legacy-Inhalt wieder aus dem Doc löschte. Jetzt mit echtem Header.
    const remote = new CrdtManager();
    remote.setContent('note.md', 'Neuer Inhalt\n');
    vault._files.set(
      '.qollab/note.md.a1b2c3d4.yjs',
      toAB(encodeStateFile('11111111111111111111111111111111', remote.encodeState('note.md')))
    );
    vault._textFiles.set('note.md', 'Neuer Inhalt\n');

    const manager = new CrdtManager();
    const handler = new SyncHandler(vault, manager, '10ca1000');

    const merged = await handler.loadAndMerge('note.md');
    // Alter Legacy-Inhalt darf NICHT im Ergebnis erscheinen
    expect(merged).not.toContain('Alter Inhalt');
    // GUID-Sidecar-Inhalt muss da sein
    expect(merged).toContain('Neuer Inhalt');
    // Legacy-Datei muss gelöscht worden sein
    expect(vault._files.has('.qollab/note.md.yjs')).toBe(false);
  });

  // Testfall (b): Nur Legacy vorhanden → wird gemergt; nach saveState gelöscht.
  it('loadAndMerge mergt Legacy .yjs bei Erst-Import (kein GUID-State) und löscht sie danach (R1)', async () => {
    const vault = makeVaultMock() as any;

    const old = new CrdtManager();
    old.setContent('note.md', 'Legacy-Inhalt\n');
    vault._files.set('.qollab/note.md.yjs', old.encodeState('note.md').buffer);
    vault._textFiles.set('note.md', 'Legacy-Inhalt\n');

    const manager = new CrdtManager();
    const handler = new SyncHandler(vault, manager, '10ca1000');

    const merged = await handler.loadAndMerge('note.md');
    expect(merged).toContain('Legacy-Inhalt');
    // Legacy-Datei wurde nach dem Erst-Import gelöscht
    expect(vault._files.has('.qollab/note.md.yjs')).toBe(false);
    // Eigener GUID-Sidecar wurde angelegt
    expect(vault._files.has('.qollab/note.md.10ca1000.yjs')).toBe(true);
  });

  it('saveState schreibt .yjs-Datei für Note in Unterverzeichnis', async () => {
    const vault = makeVaultMock() as any;
    const manager = new CrdtManager();
    manager.setContent('03-privat/daily-notes/2026-05-19.md', 'Hallo');
    const handler = new SyncHandler(vault, manager, 'a1b2c3d4');

    await handler.saveState('03-privat/daily-notes/2026-05-19.md');

    expect(vault._files.has('.qollab/03-privat/daily-notes/2026-05-19.md.a1b2c3d4.yjs')).toBe(true);
  });

  it('makeVaultMock.listYjsFiles returns matching paths (adapter-backed, async)', async () => {
    const vault = makeVaultMock() as any;
    vault._files.set('.qollab/note.md.a1b2c3d4.yjs', new ArrayBuffer(0));
    vault._files.set('.qollab/note.md.b5c6d7e8.yjs', new ArrayBuffer(0));
    vault._files.set('.qollab/other.md.a1b2c3d4.yjs', new ArrayBuffer(0));
    expect(await vault.listYjsFiles('note.md')).toEqual(
      expect.arrayContaining(['.qollab/note.md.a1b2c3d4.yjs', '.qollab/note.md.b5c6d7e8.yjs'])
    );
    expect(await vault.listYjsFiles('note.md')).not.toContain('.qollab/other.md.a1b2c3d4.yjs');
  });

  // Resave-Loop-Schutz: writeBinary bumpt die mtime auch bei byte-identischem
  // State. Ohne Skip erkennt der Peer-Poll den Bump → merge → resave → … (endloser
  // 30s-Zyklus zwischen konvergierten Peers). saveState darf nicht schreiben, wenn
  // die encodierten Bytes bereits auf der Platte stehen.
  it('loadAndMerge schreibt die eigene Sidecar nicht neu, wenn sich nichts ändert', async () => {
    const vault = makeVaultMock() as any;
    const remote = new CrdtManager();
    remote.setContent('note.md', 'Gemeinsamer Stand\n');
    vault._files.set(
      '.qollab/note.md.a1b2c3d4.yjs',
      toArrayBuffer(remote.encodeState('note.md'))
    );
    vault._textFiles.set('note.md', 'Gemeinsamer Stand\n');

    const handler = new SyncHandler(vault, new CrdtManager(), '10ca1000');
    const own = '.qollab/note.md.10ca1000.yjs';

    await handler.loadAndMerge('note.md'); // konvergiert + schreibt eigene Sidecar
    const writes1 = vault._writeCount.get(own) ?? 0;
    expect(writes1).toBeGreaterThanOrEqual(1);

    await handler.loadAndMerge('note.md'); // nichts geändert → KEIN erneuter Write
    expect(vault._writeCount.get(own) ?? 0).toBe(writes1);
  });

  it('saveState schreibt weiterhin, wenn sich der State tatsächlich geändert hat', async () => {
    const vault = makeVaultMock() as any;
    const manager = new CrdtManager();
    const handler = new SyncHandler(vault, manager, 'a1b2c3d4');
    const own = '.qollab/note.md.a1b2c3d4.yjs';

    manager.setContent('note.md', 'A');
    await handler.saveState('note.md');
    const writes1 = vault._writeCount.get(own) ?? 0;
    expect(writes1).toBe(1);

    // Identischer State → kein Write.
    await handler.saveState('note.md');
    expect(vault._writeCount.get(own) ?? 0).toBe(1);

    // Echte Änderung → Write.
    manager.setContent('note.md', 'AB');
    await handler.saveState('note.md');
    expect(vault._writeCount.get(own) ?? 0).toBe(2);
  });
});
