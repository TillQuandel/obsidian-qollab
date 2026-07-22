// R1 — Legacy-Sidecar-Lifecycle-Tests (TDD, RED before fix)
//
// v0.1-Sidecars (.qollab/<note>.md.yjs, headerlos, guid null) dürfen nach dem
// QLB1-Format-Rollout nur noch für den Erst-Import genutzt werden. Existiert
// bereits GUID-tragender State, werden sie ignoriert und gelöscht.

import { SyncHandler } from '../src/sync-handler';
import { CrdtManager } from '../src/crdt-manager';
import { encodeStateFile } from '../src/state-file';
import { makeVaultMock, toArrayBuffer as toAB } from './helpers/vault-mock';

// Baut einen Legacy-Sidecar (kein Header, raw Yjs-Update).
function makeLegacySidecar(notePath: string, text: string): ArrayBuffer {
  const mgr = new CrdtManager();
  mgr.setContent(notePath, text);
  return toAB(mgr.encodeState(notePath));
}

// Baut einen GUID-tragenden Sidecar.
function makeGuidSidecar(notePath: string, guid: string, text: string): ArrayBuffer {
  const mgr = new CrdtManager();
  mgr.setContent(notePath, text);
  return toAB(encodeStateFile(guid, mgr.encodeState(notePath)));
}

const NOTE = 'note.md';
const LEGACY_PATH = '.qollab/note.md.yjs';
const GUID_SIDECAR_PATH = '.qollab/note.md.a1b2c3d4.yjs';
const OWN_PATH = '.qollab/note.md.deadbeef.yjs';
const G_NEW = 'a'.repeat(32);
const OLD_CONTENT = 'Alter Inhalt — sollte nicht erscheinen\n';
const NEW_CONTENT = 'Neuer Inhalt der frischen Inkarnation\n';
const FIRST_IMPORT_CONTENT = 'Nur Legacy vorhanden — Erst-Import\n';

// (a) R1-Regression: Neuanlage nach Delete + zurückkehrender Legacy-Straggler
describe('R1-Regression: Legacy-Straggler nach Delete+Neuanlage', () => {
  it('alter Inhalt taucht NICHT im Merge auf; Legacy-Datei wird gelöscht', async () => {
    const vault = makeVaultMock();

    // GUID-tragender Sidecar der NEUEN Inkarnation (eigener State)
    vault._files.set(OWN_PATH, toAB(makeGuidSidecar(NOTE, G_NEW, NEW_CONTENT)));
    vault._textFiles.set(NOTE, NEW_CONTENT);

    // Legacy-Straggler mit altem Inhalt (guid null → umgeht bisherigen Tombstone-Check)
    vault._files.set(LEGACY_PATH, toAB(makeLegacySidecar(NOTE, OLD_CONTENT)));

    const mgr = new CrdtManager();
    const handler = new SyncHandler(vault as any, mgr, 'deadbeef');
    const merged = await handler.loadAndMerge(NOTE);

    // Alter Inhalt darf NICHT im Ergebnis erscheinen
    expect(merged).not.toContain('Alter Inhalt');
    // Neuer Inhalt bleibt erhalten
    expect(merged).toContain('Neuer Inhalt');
    // Legacy-Datei wurde gelöscht
    expect(vault._files.has(LEGACY_PATH)).toBe(false);
  });
});

// (b) Erst-Import: kein GUID-State → Legacy wird gemergt + danach gelöscht
describe('R1-Erst-Import: nur Legacy vorhanden', () => {
  it('mergt Legacy-Inhalt und löscht Legacy-Datei nach saveState', async () => {
    const vault = makeVaultMock();
    vault._files.set(LEGACY_PATH, toAB(makeLegacySidecar(NOTE, FIRST_IMPORT_CONTENT)));
    vault._textFiles.set(NOTE, FIRST_IMPORT_CONTENT);

    const mgr = new CrdtManager();
    const handler = new SyncHandler(vault as any, mgr, 'deadbeef');
    const merged = await handler.loadAndMerge(NOTE);

    // Legacy-Inhalt muss im Ergebnis erscheinen
    expect(merged).toContain('Nur Legacy vorhanden');
    // Legacy-Datei muss nach dem Import gelöscht sein
    expect(vault._files.has(LEGACY_PATH)).toBe(false);
    // Eigener GUID-Sidecar muss angelegt worden sein
    expect(vault._files.has(OWN_PATH)).toBe(true);
  });
});

// (c) Legacy wird ignoriert+gelöscht wenn fremder GUID-Sidecar existiert
describe('R1: Legacy ignoriert wenn fremder GUID-Sidecar vorhanden', () => {
  it('nur GUID-Inhalt im Merge; Legacy-Datei gelöscht', async () => {
    const vault = makeVaultMock();

    // Fremder GUID-Sidecar mit neuem Inhalt
    vault._files.set(GUID_SIDECAR_PATH, toAB(makeGuidSidecar(NOTE, G_NEW, NEW_CONTENT)));
    // Legacy-Datei mit altem Inhalt
    vault._files.set(LEGACY_PATH, toAB(makeLegacySidecar(NOTE, OLD_CONTENT)));
    vault._textFiles.set(NOTE, NEW_CONTENT);

    const mgr = new CrdtManager();
    const handler = new SyncHandler(vault as any, mgr, 'deadbeef');
    const merged = await handler.loadAndMerge(NOTE);

    // Alter Inhalt aus der Legacy-Datei darf NICHT erscheinen
    expect(merged).not.toContain('Alter Inhalt');
    // Neuer Inhalt aus GUID-Sidecar muss da sein
    expect(merged).toContain('Neuer Inhalt');
    // Legacy-Datei gelöscht
    expect(vault._files.has(LEGACY_PATH)).toBe(false);
  });
});
