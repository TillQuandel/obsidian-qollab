// Task 17 / F-1 — Eine Sidecar ohne QLB1-Header ist NICHT automatisch v0.1-Legacy
//
// `hasMagic` (state-file.ts) gibt für jede Datei unter 20 Byte `false` zurück, auch
// für 0 Byte; `decodeStateFile` meldet dann `guid: null`, und das heißt im
// Legacy-Zweig von `decodeSiblings` „v0.1-Datei" — die wird gelöscht, sobald
// irgendein GUID-tragender Sibling existiert (die eigene reicht). Auslöser sind
// real: fehlgeschlagene OneDrive-Hydrierung, abgebrochener Transfer,
// Sicherheitssoftware.
//
// Diese Tests pinnen den **Bestand der Datei**, nicht nur die Abwesenheit einer
// Exception. Genau darin lag die Lücke von `corrupt-sidecar.test.ts:59-82`: dort
// ist die Löschung ein nicht assertierter Nebeneffekt, deshalb blieb der Fund
// jahrelang unbemerkt.

import { SyncHandler } from '../src/sync-handler';
import { CrdtManager } from '../src/crdt-manager';
import { encodeStateFile, decodeStateFile } from '../src/state-file';
import { makeVaultMock, toArrayBuffer as toAB } from './helpers/vault-mock';

const NOTE = 'note.md';
const OWN_PATH = '.qollab/note.md.deadbeef.yjs';
const PEER_PATH = '.qollab/note.md.00000001.yjs';
const LEGACY_PATH = '.qollab/note.md.yjs';
const OWN_GUID = 'c'.repeat(32);
const PEER_GUID = 'a'.repeat(32);
const CONTENT = 'Gemeinsamer Text\n';

function guidSidecar(guid: string, text: string): ArrayBuffer {
  const mgr = new CrdtManager();
  mgr.setContent(NOTE, text);
  return toAB(encodeStateFile(guid, mgr.encodeState(NOTE)));
}

// Headerlose Bytes ≥ 20 Byte: `hasMagic` scheitert am Magic statt an der Länge —
// dieselbe Fehlklassifikation, anderer Auslöser (Fremdbytes statt Trunkierung).
function headerlessGarbage(size = 64): ArrayBuffer {
  return toAB(new Uint8Array(size).fill(0xff));
}

// Task 17 / R-1: Nullfüllung ist die zweite Erscheinungsform unvollständig
// materialisierter Dateien (fehlgeschlagene OneDrive-Hydrierung, abgebrochener
// NTFS-Extend, Sparse-/Platzhalter-Zustände). Anders als `headerlessGarbage`
// PARST sie fehlerfrei — als leeres Update. Ein Parse-Check hält sie deshalb für
// einen nachgewiesenen v0.1-State; die Tests unten sind die 1:1-Gegenstücke zu
// den 0-Byte-Fällen oben.
function zeroFilled(size = 64): ArrayBuffer {
  return toAB(new Uint8Array(size));
}

describe('F-1: headerlose Fremd-Sidecar wird nicht als v0.1-Legacy gelöscht', () => {
  it('0-Byte-Fremd-Sidecar bleibt nach loadAndMerge auf der Platte', async () => {
    const vault = makeVaultMock();
    vault._files.set(OWN_PATH, guidSidecar(OWN_GUID, CONTENT));
    vault._files.set(PEER_PATH, new ArrayBuffer(0));
    vault._textFiles.set(NOTE, CONTENT);

    const corrupt: string[] = [];
    const handler = new SyncHandler(vault as any, new CrdtManager(), 'deadbeef', undefined, (p) =>
      corrupt.push(p)
    );

    const merged = await handler.loadAndMerge(NOTE);

    // Kern der Auflage: die Datei des anderen Geräts existiert noch. Wird sie
    // gelöscht, trägt der bidirektionale Sync die Löschung zurück und vernichtet
    // dort den echten State.
    expect(vault._files.has(PEER_PATH)).toBe(true);
    // Der eigene Stand bleibt unbeschädigt.
    expect(merged).toContain('Gemeinsamer Text');
    // Übersprungen wird gemeldet — die R2-Policy, die der Legacy-Zweig bisher umging.
    expect(corrupt).toContain(PEER_PATH);
  });

  it('headerlose Fremd-Sidecar (64 Byte Fremdbytes) bleibt auf der Platte', async () => {
    const vault = makeVaultMock();
    vault._files.set(OWN_PATH, guidSidecar(OWN_GUID, CONTENT));
    vault._files.set(PEER_PATH, headerlessGarbage());
    vault._textFiles.set(NOTE, CONTENT);

    const handler = new SyncHandler(vault as any, new CrdtManager(), 'deadbeef');
    await handler.loadAndMerge(NOTE);

    expect(vault._files.has(PEER_PATH)).toBe(true);
  });

  it('leere Datei in Legacy-Pfadform wird nicht gelöscht (Stand unbekannt)', async () => {
    const vault = makeVaultMock();
    vault._files.set(OWN_PATH, guidSidecar(OWN_GUID, CONTENT));
    // Pfadform stimmt (kein clientId-Segment), der Inhalt beweist aber nichts:
    // eine 0-Byte-Datei ist kein nachweisbarer v0.1-State.
    vault._files.set(LEGACY_PATH, new ArrayBuffer(0));
    vault._textFiles.set(NOTE, CONTENT);

    const handler = new SyncHandler(vault as any, new CrdtManager(), 'deadbeef');
    await handler.loadAndMerge(NOTE);

    expect(vault._files.has(LEGACY_PATH)).toBe(true);
  });

  it('R-1: nullgefüllte Datei in Legacy-Pfadform wird nicht gelöscht', async () => {
    const vault = makeVaultMock();
    vault._files.set(OWN_PATH, guidSidecar(OWN_GUID, CONTENT));
    vault._files.set(LEGACY_PATH, zeroFilled(64));
    vault._textFiles.set(NOTE, CONTENT);

    const corrupt: string[] = [];
    const handler = new SyncHandler(vault as any, new CrdtManager(), 'deadbeef', undefined, (p) =>
      corrupt.push(p)
    );

    await handler.loadAndMerge(NOTE);

    // 64 Byte Nullen parsen als leeres Yjs-Update — der Parse-Check hielt das
    // für einen nachgewiesenen v0.1-State und löschte die Datei.
    expect(vault._files.has(LEGACY_PATH)).toBe(true);
    expect(corrupt).toContain(LEGACY_PATH);
  });
});

describe('F-1: eigene headerlose Sidecar prägt keine frische Inkarnation', () => {
  it('0-Byte eigene Sidecar übernimmt die GUID des Peers statt eine neue zu prägen', async () => {
    const vault = makeVaultMock();
    // Eigene Sidecar unvollständig materialisiert (0 Byte) …
    vault._files.set(OWN_PATH, new ArrayBuffer(0));
    // … während die lebende Inkarnation des Peers vorliegt.
    vault._files.set(PEER_PATH, guidSidecar(PEER_GUID, CONTENT));
    vault._textFiles.set(NOTE, CONTENT);

    const handler = new SyncHandler(vault as any, new CrdtManager(), 'deadbeef');
    await handler.applyLocalContent(NOTE, CONTENT);

    // Vorher: `own.guid ?? generateGuid()` prägte hier eine frische GUID —
    // Inkarnationsspaltung, danach unionMerge mit doppelten Zeilen.
    const own = decodeStateFile(new Uint8Array(vault._files.get(OWN_PATH)!));
    expect(own.guid).toBe(PEER_GUID);
    // Und die Datei des Peers steht noch.
    expect(vault._files.has(PEER_PATH)).toBe(true);
  });

  it('R-1: nullgefüllte eigene Sidecar übernimmt die GUID des Peers', async () => {
    const vault = makeVaultMock();
    // Eigene Sidecar nullgefüllt statt 0 Byte — sie PARST, `applyUpdate` gelingt
    // als No-op, und `own.guid ?? generateGuid()` prägte eine frische GUID über
    // die lebende Peer-Inkarnation: Spaltung, danach unionMerge ohne
    // gemeinsamen Vorfahren.
    vault._files.set(OWN_PATH, zeroFilled(64));
    vault._files.set(PEER_PATH, guidSidecar(PEER_GUID, CONTENT));
    vault._textFiles.set(NOTE, CONTENT);

    const handler = new SyncHandler(vault as any, new CrdtManager(), 'deadbeef');
    await handler.applyLocalContent(NOTE, CONTENT);

    const own = decodeStateFile(new Uint8Array(vault._files.get(OWN_PATH)!));
    expect(own.guid).toBe(PEER_GUID);
    expect(vault._files.has(PEER_PATH)).toBe(true);
  });
});

// Dritter Löschpfad: `cleanupLegacyFile` läuft NACH saveState und prüfte
// dieselbe Bedingung eigenständig. Der Zuschnitt hier isoliert ihn — solange
// kein GUID-State existiert, rührt `decodeSiblings` die Legacy-Datei nicht an;
// erst der eigene, gerade geschriebene State macht sie aus Sicht des Cleanups
// „obsolet".
describe('F-1: cleanupLegacyFile löscht nur bei nachgewiesenem Inhalt', () => {
  it('R-1: nullgefüllte Legacy-Datei überlebt den Cleanup nach saveState', async () => {
    const vault = makeVaultMock();
    vault._files.set(LEGACY_PATH, zeroFilled(64));
    vault._textFiles.set(NOTE, CONTENT);

    const handler = new SyncHandler(vault as any, new CrdtManager(), 'deadbeef');
    await handler.applyLocalContent(NOTE, CONTENT);

    // Der eigene State ist geschrieben …
    expect(vault._files.has(OWN_PATH)).toBe(true);
    // … die Legacy-Datei unbewiesenen Inhalts bleibt trotzdem liegen.
    expect(vault._files.has(LEGACY_PATH)).toBe(true);
  });
});
