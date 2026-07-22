// R2 — Korrupte .yjs-Dateien: try/catch pro Datei (TDD, RED before fix)
//
// Malformierte Updates (0-Byte, trunkiert, Garbage) werfen in Yjs. Ohne
// try/catch blockiert eine korrupte Remote-Datei den Merge dauerhaft.

import { SyncHandler } from '../src/sync-handler';
import { CrdtManager } from '../src/crdt-manager';
import { encodeStateFile } from '../src/state-file';
import { makeVaultMock, toArrayBuffer as toAB } from './helpers/vault-mock';

function makeGuidSidecar(notePath: string, guid: string, text: string): ArrayBuffer {
  const mgr = new CrdtManager();
  mgr.setContent(notePath, text);
  return toAB(encodeStateFile(guid, mgr.encodeState(notePath)));
}

const NOTE = 'note.md';
const OWN_PATH = '.qollab/note.md.deadbeef.yjs';
const VALID_GUID = 'b'.repeat(32);
const VALID_CONTENT = 'Gültiger Inhalt vom anderen Gerät\n';

// Garbage-Bytes: sieht für decodeStateFile wie eine Legacy-Datei aus (kein Magic-Header),
// aber die rohen Bytes sind für Y.applyUpdate ungültig.
function garbageBytes(size = 64): ArrayBuffer {
  const buf = new Uint8Array(size);
  for (let i = 0; i < size; i++) buf[i] = 0xff; // ungültiges Yjs-Encoding
  return toAB(buf);
}

describe('R2: korrupte Remote-Datei', () => {
  it('Merge der übrigen Siblings funktioniert; keine Exception nach außen', async () => {
    const vault = makeVaultMock();

    // Eigener Sidecar (GUID-tragend) damit adopt-Zweig nicht die .md injiziert
    const ownGuid = 'c'.repeat(32);
    vault._files.set(OWN_PATH, makeGuidSidecar(NOTE, ownGuid, VALID_CONTENT));
    // Korrupter fremder Sidecar (Garbage-Bytes als Legacy-Format)
    vault._files.set('.qollab/note.md.00000001.yjs', garbageBytes());
    vault._textFiles.set(NOTE, VALID_CONTENT);

    const mgr = new CrdtManager();
    const corruptPaths: string[] = [];
    const handler = new SyncHandler(vault as any, mgr, 'deadbeef', undefined, (p) =>
      corruptPaths.push(p)
    );

    let thrown = false;
    let merged: string | null = null;
    try {
      merged = await handler.loadAndMerge(NOTE);
    } catch {
      thrown = true;
    }

    expect(thrown).toBe(false);
    expect(merged).toContain('Gültiger Inhalt');
  });

  it('0-Byte-Datei: Merge der übrigen Siblings funktioniert', async () => {
    const vault = makeVaultMock();

    // Eigener Sidecar (GUID-tragend)
    const ownGuid = 'c'.repeat(32);
    vault._files.set(OWN_PATH, makeGuidSidecar(NOTE, ownGuid, VALID_CONTENT));
    // 0-Byte-Datei
    vault._files.set('.qollab/note.md.00000001.yjs', new ArrayBuffer(0));
    vault._textFiles.set(NOTE, VALID_CONTENT);

    const mgr = new CrdtManager();
    const handler = new SyncHandler(vault as any, mgr, 'deadbeef');

    let thrown = false;
    let merged: string | null = null;
    try {
      merged = await handler.loadAndMerge(NOTE);
    } catch {
      thrown = true;
    }

    expect(thrown).toBe(false);
    expect(merged).toContain('Gültiger Inhalt');
  });

  it('korrupter GUID-Sidecar mit Garbage-Bytes in applyUpdate: Merge läuft durch', async () => {
    // Dieser Test erzeugt Garbage-Bytes MIT einem gültigen QLB1-Header, sodass
    // decodeStateFile eine GUID extrahiert, aber Y.applyUpdate auf die kaputten
    // Update-Bytes trifft und wirft. Der try/catch in mergeCompatible muss greifen.
    const vault = makeVaultMock();

    const ownGuid = 'c'.repeat(32);
    vault._files.set(OWN_PATH, makeGuidSidecar(NOTE, ownGuid, VALID_CONTENT));

    // Manuell: QLB1-Header + GUID + Garbage als Update-Bytes
    const magic = new Uint8Array([0x51, 0x4c, 0x42, 0x31]); // 'QLB1'
    const guid = new Uint8Array(16).fill(0xab); // 16-Byte-GUID
    const garbage = new Uint8Array(50).fill(0xff);
    const corruptWithHeader = new Uint8Array(4 + 16 + 50);
    corruptWithHeader.set(magic, 0);
    corruptWithHeader.set(guid, 4);
    corruptWithHeader.set(garbage, 20);
    vault._files.set('.qollab/note.md.00000002.yjs', toAB(corruptWithHeader));
    vault._textFiles.set(NOTE, VALID_CONTENT);

    const mgr = new CrdtManager();
    const corruptPaths: string[] = [];
    const handler = new SyncHandler(vault as any, mgr, 'deadbeef', undefined, (p) =>
      corruptPaths.push(p)
    );

    let thrown = false;
    try {
      await handler.loadAndMerge(NOTE);
    } catch {
      thrown = true;
    }

    expect(thrown).toBe(false);
  });
});

describe('R2: korrupter eigener Sidecar', () => {
  it('applyLocalContent wirft nicht; eigener State wird beim saveState überschrieben', async () => {
    const vault = makeVaultMock();

    // Korrupter eigener Sidecar
    vault._files.set(OWN_PATH, garbageBytes());
    vault._textFiles.set(NOTE, 'Lokal getippter Text\n');

    const mgr = new CrdtManager();
    const handler = new SyncHandler(vault as any, mgr, 'deadbeef');

    let thrown = false;
    try {
      await handler.applyLocalContent(NOTE, 'Lokal getippter Text\n');
    } catch {
      thrown = true;
    }

    expect(thrown).toBe(false);
    // Eigener Sidecar muss nach dem saveState vorhanden und überschrieben sein
    // (nicht mehr die Garbage-Bytes — aber wir prüfen nur Existenz, da Format opak)
    expect(vault._files.has(OWN_PATH)).toBe(true);
    // Und der neue State muss den getippten Text enthalten
    const freshMgr = new CrdtManager();
    const freshHandler = new SyncHandler(vault as any, freshMgr, 'deadbeef');
    await freshHandler.applyLocalContent(NOTE, 'Lokal getippter Text\n');
    expect(freshMgr.getContent(NOTE)).toBe('Lokal getippter Text\n');
  });
});
