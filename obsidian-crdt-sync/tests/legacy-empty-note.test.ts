// Task 19 / A (Merge-Review M-1) — die LEGITIM leere Note verliert ihren Status
//
// Task 17/R-1 verlangt für eine headerlose Sidecar den positiven Nachweis
// „trägt Yjs-Ops". Der Preis steht seit damals im Kommentar von
// `crdt-manager.ts` und ist hier der Prüfgegenstand: v0.1 rief `saveState` auch
// für eine NIE BEFÜLLTE Note, und `Y.encodeStateAsUpdate` eines leeren Docs ist
// exakt `[0x00, 0x00]` (2 Byte, gemessen). Diese Datei ist ein vollständiger,
// gesunder v0.1-State — sie trägt nur nichts.
//
// Folge im Bestand: `decodeSiblings` meldet sie als „beschädigt" (der Nutzer
// sieht „Qollab: beschädigte Sync-Datei übersprungen" für eine gesunde Datei),
// und `cleanupLegacyFile` weigert sich, sie nach dem Schreiben des eigenen
// GUID-States abzuräumen. Beides wiederholt sich in JEDER Sitzung, unbegrenzt.
//
// Abgrenzung nach unten (die Tests dazu stehen in `legacy-misclassification`
// und `crdt-manager`): Nullfüllung bleibt „Stand unbekannt". Der leere State ist
// genau 2 Byte lang; ein echter State beginnt mit `[0x01, …]` (mindestens ein
// Struct-Client), eine auf 2 Byte trunkierte Fassung eines echten States wäre
// also `[0x01, x]`, und ein größenerhaltender Platzhalter (OneDrive) mit 2 Byte
// Länge kann nur aus einer 2-Byte-Datei entstanden sein. `[0x00, 0x00]` ist
// deshalb beweisbar der leere State und nichts anderes.
//
// Zweiter Zuschnitt: Die Ausnahme gilt NUR für die v0.1-Pfadform ohne
// clientId-Segment. Eine per-Client benannte 2-Byte-Datei kann keine v0.1-Datei
// sein (die Pfadform kam erst mit dem Header, siehe `decodeSiblings`) — dort
// bleibt es bei „Stand unbekannt", damit die Adoption der lebenden
// Fremd-Inkarnation greift statt einer frisch geprägten GUID.

import * as Y from 'yjs';
import { SyncHandler } from '../src/sync-handler';
import { CrdtManager } from '../src/crdt-manager';
import { encodeStateFile, decodeStateFile } from '../src/state-file';
import { makeVaultMock, toArrayBuffer as toAB } from './helpers/vault-mock';

const NOTE = 'leer.md';
const OWN_PATH = '.qollab/leer.md.deadbeef.yjs';
const PEER_PATH = '.qollab/leer.md.00000001.yjs';
const LEGACY_PATH = '.qollab/leer.md.yjs';
const OWN_GUID = 'c'.repeat(32);
const PEER_GUID = 'a'.repeat(32);

// Exakt das, was v0.1 für eine nie befüllte Note auf die Platte schrieb.
function emptyV01Sidecar(): ArrayBuffer {
  return toAB(Y.encodeStateAsUpdate(new Y.Doc()));
}

function guidSidecar(guid: string, text: string): ArrayBuffer {
  const mgr = new CrdtManager();
  mgr.setContent(NOTE, text);
  return toAB(encodeStateFile(guid, mgr.encodeState(NOTE)));
}

describe('M-1: der leere v0.1-State ist ein Nachweis, kein Rätsel', () => {
  it('Messpunkt: der State einer nie befüllten Note ist genau [0x00,0x00]', () => {
    expect(Array.from(new Uint8Array(emptyV01Sidecar()))).toEqual([0, 0]);
  });

  it('die leere Legacy-Datei wird NICHT als beschädigt gemeldet', async () => {
    const vault = makeVaultMock();
    vault._files.set(OWN_PATH, guidSidecar(OWN_GUID, 'Inhalt\n'));
    vault._files.set(LEGACY_PATH, emptyV01Sidecar());
    vault._textFiles.set(NOTE, 'Inhalt\n');

    const corrupt: string[] = [];
    const handler = new SyncHandler(vault as any, new CrdtManager(), 'deadbeef', undefined, (p) =>
      corrupt.push(p)
    );

    await handler.loadAndMerge(NOTE);

    // Bestand: der Pfad steht hier drin, und main.ts macht daraus eine Notice
    // „beschädigte Sync-Datei übersprungen" für eine kerngesunde Datei.
    expect(corrupt).not.toContain(LEGACY_PATH);
  });

  it('die leere Legacy-Datei wird abgeräumt, sobald GUID-State existiert', async () => {
    const vault = makeVaultMock();
    vault._files.set(LEGACY_PATH, emptyV01Sidecar());
    vault._textFiles.set(NOTE, '');

    const handler = new SyncHandler(vault as any, new CrdtManager(), 'deadbeef');
    await handler.applyLocalContent(NOTE, 'Erster Satz\n');

    // Eigener GUID-State ist geschrieben …
    expect(vault._files.has(OWN_PATH)).toBe(true);
    // … also ist die v0.1-Datei obsolet. Bestand: sie bleibt für immer liegen und
    // erzeugt in jeder Sitzung erneut eine Meldung.
    expect(vault._files.has(LEGACY_PATH)).toBe(false);
  });

  it('der Inhalt der Note überlebt den Erst-Import aus dem leeren v0.1-State', async () => {
    const vault = makeVaultMock();
    vault._files.set(LEGACY_PATH, emptyV01Sidecar());
    vault._textFiles.set(NOTE, 'Erst nach der Migration getippt\n');

    const handler = new SyncHandler(vault as any, new CrdtManager(), 'deadbeef');
    const merged = await handler.applyLocalContent(NOTE, 'Erst nach der Migration getippt\n');

    expect(merged).toBe('Erst nach der Migration getippt\n');
  });
});

describe('M-1: der Zuschnitt der Ausnahme', () => {
  it('2 Byte in PER-CLIENT-Pfadform bleiben „Stand unbekannt"', async () => {
    const vault = makeVaultMock();
    // Kein v0.1-Erbe: die per-Client-Form kam erst mit dem QLB1-Header. Die Datei
    // ist unfertig — die lebende Fremd-Inkarnation muss adoptiert werden.
    vault._files.set(PEER_PATH, emptyV01Sidecar());
    vault._files.set('.qollab/leer.md.00000002.yjs', guidSidecar(PEER_GUID, 'Peer-Text\n'));
    vault._textFiles.set(NOTE, 'Peer-Text\n');

    const corrupt: string[] = [];
    const handler = new SyncHandler(vault as any, new CrdtManager(), 'deadbeef', undefined, (p) =>
      corrupt.push(p)
    );

    await handler.loadAndMerge(NOTE);

    expect(corrupt).toContain(PEER_PATH);
    expect(vault._files.has(PEER_PATH)).toBe(true);
  });

  it('eigene 2-Byte-Sidecar prägt keine frische Inkarnation', async () => {
    const vault = makeVaultMock();
    vault._files.set(OWN_PATH, emptyV01Sidecar());
    vault._files.set(PEER_PATH, guidSidecar(PEER_GUID, 'Peer-Text\n'));
    vault._textFiles.set(NOTE, 'Peer-Text\n');

    const handler = new SyncHandler(vault as any, new CrdtManager(), 'deadbeef');
    await handler.applyLocalContent(NOTE, 'Peer-Text\n');

    const own = decodeStateFile(new Uint8Array(vault._files.get(OWN_PATH)!));
    expect(own.guid).toBe(PEER_GUID);
  });
});

// Kontrollmessung zu Merge-Review §3 Punkt 8. Dort ist der Schaden (Adoption
// 8/8 → 0/8, neue GUID je Start, Korrupt-Meldung) für die PROTOTYP-Option „O5"
// gemessen, die den Ops-Nachweis zusätzlich auf header-tragende Dateien
// ausdehnt. Master tut das NICHT: `carriesYjsOps` wird ausschließlich für
// `guid === null` konsultiert. Diese Tests halten fest, dass die
// header-tragende leere Note im Bestand gesund ist — damit ist belegt, welcher
// Teil von M-1 hier überhaupt zu beheben war.
describe('M-1: Kontrollmessung — mit Header ist die leere Note im Bestand gesund', () => {
  it('behält ihre Kennung und meldet nichts', async () => {
    const vault = makeVaultMock();
    // Genau der 22-Byte-Fall aus dem Review: QLB1 + GUID + [0x00,0x00].
    vault._files.set(OWN_PATH, toAB(encodeStateFile(OWN_GUID, new Uint8Array([0, 0]))));
    vault._textFiles.set(NOTE, '');

    const corrupt: string[] = [];
    const handler = new SyncHandler(vault as any, new CrdtManager(), 'deadbeef', undefined, (p) =>
      corrupt.push(p)
    );

    expect(new Uint8Array(vault._files.get(OWN_PATH)!).byteLength).toBe(22);
    await handler.loadAndMerge(NOTE);

    expect(corrupt).toEqual([]);
    expect(await handler.currentGuid(NOTE)).toBe(OWN_GUID);
  });

  it('adoptiert eine leere Fremd-Inkarnation statt eine neue zu prägen', async () => {
    const vault = makeVaultMock();
    vault._files.set(PEER_PATH, toAB(encodeStateFile(PEER_GUID, new Uint8Array([0, 0]))));
    vault._textFiles.set(NOTE, '');

    const handler = new SyncHandler(vault as any, new CrdtManager(), 'deadbeef');
    expect(await handler.hasAdoptableGuid(NOTE)).toBe(true);

    await handler.applyLocalContent(NOTE, '');
    expect(await handler.currentGuid(NOTE)).toBe(PEER_GUID);
  });
});
