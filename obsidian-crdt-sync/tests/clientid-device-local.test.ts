import { Notice, TFile } from 'obsidian';
import CrdtSyncPlugin from '../src/main';
import { CrdtManager } from '../src/crdt-manager';
import { decodeStateFile, encodeStateFile } from '../src/state-file';
import {
  makeVaultMock,
  makeLocalStorage,
  toArrayBuffer,
  type LocalStorageMock,
  type VaultMock,
} from './helpers/vault-mock';

// Task 14 — die clientId ist die GERÄTE-Identität und darf nicht mitsynchronisiert
// werden (Audit-Verify-Fund 1, critical).
//
// Ausgangslage vor dem Fix: sie lebt in data.json, also unter
// <vault>/.obsidian/plugins/qollab/ — mitten im Ordner, den der dokumentierte
// Standard-Aufbau (OneDrive/Syncthing/…) komplett synct. Beide Geräte konvergieren
// dadurch auf EINE clientId, schreiben denselben Sidecar-Pfad, und der Watcher hält
// die Peer-Datei per Self-Ignore für die eigene → der automatische Remote-Merge ist
// still tot.
//
// Nach dem Fix: Provisionierung über App.load/saveLocalStorage (Electron-Profil,
// vault-spezifisch UND gerätelokal) + Kollisionserkennung am eigenen Sidecar-Pfad.
//
// Der Vault-Mock ist hier der GETEILTE Ordner (beide Geräte sehen dieselben
// Dateien); der localStorage-Mock ist pro Gerät getrennt — genau die Asymmetrie,
// um die es geht.

const NOTE = 'note.md';
const CLIENT_ID_KEY = 'qollab-client-id';
const SHARED_ID = 'c10ec10e'; // per data.json-Sync geklonte ID (Klon-Ära)
const BASE_TEXT = 'Basis\n';
const PEER_TEXT = 'Basis\nA-Zeile\n';

function ownPathFor(notePath: string, clientId: string): string {
  return `.qollab/${notePath}.${clientId}.yjs`;
}

function ownPath(clientId: string): string {
  return ownPathFor(NOTE, clientId);
}

// Ein Gerät: eigene Plugin-Instanz + eigener localStorage, gemeinsamer Vault-Mock.
// Läuft über den ECHTEN onload-Pfad (keine nachgebaute Verdrahtung), damit der Test
// die Produktions-Verkabelung von Provisionierung, Watcher und Handler prüft.
async function bootDevice(
  vault: VaultMock,
  opts: { storage?: LocalStorageMock; data?: any } = {}
): Promise<{ plugin: any; storage: LocalStorageMock; handlers: Map<string, any> }> {
  const storage = opts.storage ?? makeLocalStorage();
  const handlers = new Map<string, (...args: any[]) => any>();
  const vaultWithEvents = Object.assign(vault, {
    on: (event: string, cb: (...args: any[]) => any) => {
      handlers.set(event, cb);
      return { __event: event };
    },
    offref: () => {},
  });
  const app = {
    vault: vaultWithEvents,
    workspace: {
      on: () => ({}),
      offref: () => {},
      onLayoutReady: () => {}, // Sweep/Initial-Scan bewusst nicht starten
    },
    loadLocalStorage: storage.loadLocalStorage,
    saveLocalStorage: storage.saveLocalStorage,
  };
  const plugin = new (CrdtSyncPlugin as any)(app, {});
  plugin._data = opts.data ?? null;
  await plugin.onload();
  return { plugin, storage, handlers };
}

function tfile(path: string): TFile {
  const f = new TFile();
  f.path = path;
  f.name = path.split('/').pop() ?? path;
  return f;
}

// Merges mitschneiden UND durchreichen (kein Mock-Ersatz: der echte Merge soll laufen).
function traceMerges(plugin: any): string[] {
  const seen: string[] = [];
  const original = plugin.onRemoteYjsUpdate.bind(plugin);
  plugin.onRemoteYjsUpdate = async (notePath: string) => {
    seen.push(notePath);
    return original(notePath);
  };
  return seen;
}

function readGuid(vault: VaultMock, path: string): string | null {
  return decodeStateFile(new Uint8Array(vault._files.get(path)!)).guid;
}

function readText(vault: VaultMock, path: string): string {
  const { update } = decodeStateFile(new Uint8Array(vault._files.get(path)!));
  const crdt = new CrdtManager();
  crdt.applyUpdate(NOTE, update);
  return crdt.getContent(NOTE);
}

// Der Peer (zweites Gerät der Klon-Ära) editiert die Note und sein Datei-Sync legt
// das Ergebnis unter DEMSELBEN Sidecar-Pfad ab — die geteilte GUID inklusive.
function peerWrites(vault: VaultMock, path: string, text: string): void {
  const decoded = decodeStateFile(new Uint8Array(vault._files.get(path)!));
  const peer = new CrdtManager();
  peer.applyUpdate(NOTE, decoded.update);
  peer.setContent(NOTE, text);
  vault._files.set(
    path,
    toArrayBuffer(encodeStateFile(decoded.guid!, peer.encodeState(NOTE)))
  );
  vault._mtimes.set(path, (vault._mtimes.get(path) ?? 0) + 100);
}

beforeEach(() => {
  (Notice as any).messages = [];
});

describe('Klon-Repro: geteilte clientId (Fund 1)', () => {
  it('erkennt den fremden Schreiber auf dem eigenen Pfad und provisioniert neu', async () => {
    const vault = makeVaultMock();
    vault._textFiles.set(NOTE, BASE_TEXT);

    // Beide Geräte haben dieselbe data.json-ID geerbt (Sync von .obsidian/).
    const { plugin } = await bootDevice(vault, {
      data: { enabled: true, statusNotice: false, clientId: SHARED_ID, tombstones: {} },
    });

    // Dieses Gerät erfasst die Note lokal → eigener State im (geteilten) Pfad.
    await plugin.syncHandler.applyLocalContent(NOTE, BASE_TEXT);
    expect(vault._files.has(ownPath(SHARED_ID))).toBe(true); // Vorbedingung des Funds
    await plugin.sidecarWatcher.poll(); // Baseline

    const merges = traceMerges(plugin);

    // Der Peer editiert und überschreibt via Sync exakt unsere Sidecar-Datei.
    peerWrites(vault, ownPath(SHARED_ID), PEER_TEXT);
    await plugin.sidecarWatcher.poll();

    // RED (unfixed): merges = [] und .md bleibt auf 'Basis\n' — extractForeign hält
    // die Peer-Datei für die eigene, der Remote-Merge findet nie statt.
    expect(merges).toEqual([NOTE]);
    expect(vault._textFiles.get(NOTE)).toBe(PEER_TEXT);
    expect(plugin.clientId).toMatch(/^[0-9a-f]{8}$/);
    expect(plugin.clientId).not.toBe(SHARED_ID);

    // Eigener State liegt jetzt unter dem NEUEN Pfad …
    expect(vault._files.has(ownPath(plugin.clientId))).toBe(true);
    // … und die alte Datei bleibt liegen — sie gehört jetzt dem anderen Gerät.
    expect(vault._files.has(ownPath(SHARED_ID))).toBe(true);
    // Genau eine Meldung an den Nutzer.
    expect(
      (Notice as any).messages.filter((m: string) => /Kollision/i.test(m))
    ).toHaveLength(1);
  });

  it('nach der Neu-Provisionierung kommen weitere Peer-Edits normal an', async () => {
    const vault = makeVaultMock();
    vault._textFiles.set(NOTE, BASE_TEXT);
    const { plugin } = await bootDevice(vault, {
      data: { enabled: true, statusNotice: false, clientId: SHARED_ID, tombstones: {} },
    });
    await plugin.syncHandler.applyLocalContent(NOTE, BASE_TEXT);
    await plugin.sidecarWatcher.poll();

    peerWrites(vault, ownPath(SHARED_ID), PEER_TEXT);
    await plugin.sidecarWatcher.poll(); // Kollision + Neu-Provisionierung

    // Zweiter Peer-Edit auf der (jetzt fremden) Alt-Datei.
    peerWrites(vault, ownPath(SHARED_ID), 'Basis\nA-Zeile\nA-Zeile-2\n');
    await plugin.sidecarWatcher.poll();

    expect(vault._textFiles.get(NOTE)).toBe('Basis\nA-Zeile\nA-Zeile-2\n');
  });
});

describe('Provisionierung + Migration (data.json → localStorage)', () => {
  async function bootBare(vault: VaultMock, data: any, storage: LocalStorageMock) {
    const { plugin } = await bootDevice(vault, { storage, data });
    return plugin;
  }

  it('übernimmt eine vorhandene data.json-ID einmalig und entfernt sie aus data.json', async () => {
    const vault = makeVaultMock();
    const storage = makeLocalStorage();
    const plugin = await bootBare(
      vault,
      { enabled: true, statusNotice: true, clientId: 'a1b2c3d4', tombstones: {} },
      storage
    );

    expect(plugin.clientId).toBe('a1b2c3d4');
    expect(storage._store.get(CLIENT_ID_KEY)).toBe('a1b2c3d4');
    // data.json trägt die ID nicht mehr.
    expect(Object.keys(plugin._data)).not.toContain('clientId');
  });

  it('localStorage schlägt eine (mitgesyncte) data.json-ID', async () => {
    const vault = makeVaultMock();
    const storage = makeLocalStorage();
    storage.saveLocalStorage(CLIENT_ID_KEY, 'dede1234');

    const plugin = await bootBare(
      vault,
      { enabled: true, statusNotice: true, clientId: SHARED_ID, tombstones: {} },
      storage
    );

    expect(plugin.clientId).toBe('dede1234');
    expect(Object.keys(plugin._data)).not.toContain('clientId');
  });

  it('Zweitgerät ohne localStorage und ohne data.json-ID generiert eine eigene ID', async () => {
    const vault = makeVaultMock();
    const first = await bootBare(
      vault,
      { enabled: true, statusNotice: true, clientId: 'a1b2c3d4', tombstones: {} },
      makeLocalStorage()
    );
    // Gerät 2 bekommt die migrierte data.json (ohne clientId), aber einen eigenen
    // (leeren) localStorage.
    const second = await bootBare(vault, { ...first._data }, makeLocalStorage());

    expect(second.clientId).toMatch(/^[0-9a-f]{8}$/);
    expect(second.clientId).not.toBe(first.clientId);
  });

  it('ignoriert einen unbrauchbaren localStorage-Wert und provisioniert neu', async () => {
    const vault = makeVaultMock();
    const storage = makeLocalStorage();
    storage.saveLocalStorage(CLIENT_ID_KEY, { not: 'a hex id' });

    const plugin = await bootBare(vault, { enabled: true, tombstones: {} }, storage);

    expect(plugin.clientId).toMatch(/^[0-9a-f]{8}$/);
    expect(storage._store.get(CLIENT_ID_KEY)).toBe(plugin.clientId);
  });
});

describe('Keine False Positives: eigene Writes lösen keine Neu-Provisionierung aus', () => {
  it('wiederholte eigene saveState-Writes bleiben unauffällig', async () => {
    const vault = makeVaultMock();
    vault._textFiles.set(NOTE, BASE_TEXT);
    const { plugin } = await bootDevice(vault);
    const id = plugin.clientId;

    await plugin.syncHandler.applyLocalContent(NOTE, BASE_TEXT);
    await plugin.sidecarWatcher.poll();
    await plugin.syncHandler.applyLocalContent(NOTE, 'Basis\nEigene Zeile\n');
    await plugin.sidecarWatcher.poll();
    await plugin.syncHandler.applyLocalContent(NOTE, 'Basis\nEigene Zeile 2\n');
    await plugin.sidecarWatcher.poll();

    expect(plugin.clientId).toBe(id);
    expect((Notice as any).messages.filter((m: string) => /Kollision/i.test(m))).toEqual([]);
    expect(vault._files.has(ownPath(id))).toBe(true);
  });

  it('ein mtime-Bump ohne Inhaltsänderung (Sync-Tool) ist keine Kollision', async () => {
    const vault = makeVaultMock();
    vault._textFiles.set(NOTE, BASE_TEXT);
    const { plugin } = await bootDevice(vault);
    const id = plugin.clientId;

    await plugin.syncHandler.applyLocalContent(NOTE, BASE_TEXT);
    await plugin.sidecarWatcher.poll();

    // Datei-Sync kopiert unsere eigene Datei zurück: neue mtime, gleiche Bytes.
    vault._mtimes.set(ownPath(id), (vault._mtimes.get(ownPath(id)) ?? 0) + 100);
    await plugin.sidecarWatcher.poll();

    expect(plugin.clientId).toBe(id);
    expect((Notice as any).messages.filter((m: string) => /Kollision/i.test(m))).toEqual([]);
  });

  // Task 13 schreibt die EIGENE Sidecar in Pfaden neu, die nicht von einem lokalen
  // Edit ausgehen: verliert die eigene Inkarnation den GUID-Tie-Break, vereinigt
  // switchToGuid den Stand und saveState legt die eigene Datei mit fremder GUID neu
  // an. Das darf die Kollisionserkennung nicht als fremden Schreiber lesen.
  it('Task-13-Inkarnationswechsel (switchToGuid) provisioniert nicht neu', async () => {
    const vault = makeVaultMock();
    vault._textFiles.set(NOTE, BASE_TEXT);
    const { plugin } = await bootDevice(vault);
    const id = plugin.clientId;

    await plugin.syncHandler.applyLocalContent(NOTE, 'Basis\nEigene Zeile\n');
    await plugin.sidecarWatcher.poll(); // Baseline auf die eigene Datei
    const ownGuid = readGuid(vault, ownPath(id));

    // Fremd-Sidecar mit kleinerer GUID → sie gewinnt den Tie-Break.
    const winnerGuid = '0'.repeat(31) + '1';
    const foreign = new CrdtManager();
    foreign.setContent(NOTE, 'Basis\nFremde Zeile\n');
    const foreignPath = `.qollab/${NOTE}.beef0001.yjs`;
    vault._files.set(
      foreignPath,
      toArrayBuffer(encodeStateFile(winnerGuid, foreign.encodeState(NOTE)))
    );
    vault._mtimes.set(foreignPath, 500);

    await plugin.sidecarWatcher.poll(); // Merge → switchToGuid → eigener Re-Save
    expect(readGuid(vault, ownPath(id))).not.toBe(ownGuid);
    expect(readGuid(vault, ownPath(id))).toBe(winnerGuid); // Wechsel fand statt

    // Die eigene Datei hat sich seit der Baseline geändert — von UNS.
    await plugin.sidecarWatcher.poll();
    await plugin.sidecarWatcher.poll();

    expect(plugin.clientId).toBe(id);
    expect((Notice as any).messages.filter((m: string) => /Kollision/i.test(m))).toEqual([]);
  });

  // Review I-1: Der rename-Handler verschiebt die Sidecar am SyncHandler vorbei
  // (kein saveState). Bleibt die Signatur des alten Pfads stehen, trifft sie nach
  // einem Rename ZURÜCK auf eine inzwischen editierte Datei — mtime und size hat der
  // Rename erhalten, der Byte-Vergleich läuft gegen den Stand von vor dem Edit →
  // erfundene Kollision samt Nutzer-Notice und verwaister Sidecar.
  it('Rename A→B, Edit, Rename zurück meldet keine Kollision', async () => {
    const vault = makeVaultMock();
    const A = 'A.md';
    const B = 'B.md';
    vault._textFiles.set(A, BASE_TEXT);
    const { plugin, handlers } = await bootDevice(vault);
    const id = plugin.clientId;

    await plugin.syncHandler.applyLocalContent(A, BASE_TEXT);
    await plugin.sidecarWatcher.poll(); // Baseline auf .qollab/A.md.<id>.yjs

    // Rename A → B: Obsidian benennt die .md um, dann feuert das Event.
    vault._textFiles.set(B, vault._textFiles.get(A)!);
    vault._textFiles.delete(A);
    await handlers.get('rename')!(tfile(B), A);

    // Edit unter dem neuen Namen → Sidecar-Inhalt ändert sich.
    vault._textFiles.set(B, 'Basis\nEdit unter B\n');
    await plugin.syncHandler.applyLocalContent(B, 'Basis\nEdit unter B\n');
    await plugin.sidecarWatcher.poll();

    // … und wieder zurück auf den alten Namen.
    vault._textFiles.set(A, vault._textFiles.get(B)!);
    vault._textFiles.delete(B);
    await handlers.get('rename')!(tfile(A), B);

    await plugin.sidecarWatcher.poll();

    // RED (vor dem Fix): clientId neu vergeben + 1 Kollisions-Notice.
    expect((Notice as any).messages.filter((m: string) => /Kollision/i.test(m))).toEqual([]);
    expect(plugin.clientId).toBe(id);
    expect(vault._files.has(ownPathFor(A, id))).toBe(true);
    expect([...vault._files.keys()].filter((p) => p.endsWith('.yjs'))).toHaveLength(1);
  });

  it('Task-12-Retry-Pfad (abgebrochener Lauf + Nachholen) provisioniert nicht neu', async () => {
    const vault = makeVaultMock() as any;
    vault._textFiles.set(NOTE, BASE_TEXT);
    const { plugin } = await bootDevice(vault);
    const id = plugin.clientId;

    await plugin.syncHandler.applyLocalContent(NOTE, BASE_TEXT);
    await plugin.sidecarWatcher.poll();

    // Sidecar-Read wirft (EBUSY) → applyLocalContent bricht ab (abortedReads).
    const rawRead = vault.adapter.readBinary.bind(vault.adapter);
    const io = { failing: true };
    vault.adapter.readBinary = async (p: string) => {
      if (io.failing && p === ownPath(id)) throw new Error('EBUSY: resource busy or locked');
      return rawRead(p);
    };
    await plugin.syncHandler.applyLocalContent(NOTE, 'Basis\nEdit im IO-Fehler\n');
    expect(plugin.syncHandler.hasAbortedRead(NOTE)).toBe(true);
    await plugin.sidecarWatcher.poll();

    // IO erholt sich, der Lauf wird nachgeholt → eigener Write.
    io.failing = false;
    await plugin.syncHandler.applyLocalContent(NOTE, 'Basis\nEdit im IO-Fehler\n');
    await plugin.sidecarWatcher.poll();

    expect(plugin.clientId).toBe(id);
    expect((Notice as any).messages.filter((m: string) => /Kollision/i.test(m))).toEqual([]);
  });
});

describe('localStorage-Verlust bleibt gutartig', () => {
  it('neues Profil → neue ID; die Alt-Datei konvergiert als Fremd-Sidecar gleicher GUID', async () => {
    const vault = makeVaultMock();
    const TEXT = 'Basis\nAlte Zeile\n';
    vault._textFiles.set(NOTE, TEXT);

    const first = await bootDevice(vault);
    await first.plugin.syncHandler.applyLocalContent(NOTE, TEXT);
    const oldId = first.plugin.clientId;
    const guid = readGuid(vault, ownPath(oldId));
    expect(guid).not.toBeNull();

    // Neustart mit verlorenem localStorage (neues Electron-Profil), Vault unverändert.
    const second = await bootDevice(vault, { data: { ...first.plugin._data } });
    expect(second.plugin.clientId).not.toBe(oldId);

    await second.plugin.sidecarWatcher.poll();

    const newPath = ownPath(second.plugin.clientId);
    expect(vault._files.has(newPath)).toBe(true);
    expect(readGuid(vault, newPath)).toBe(guid); // gleiche Inkarnation
    expect(readText(vault, newPath)).toBe(TEXT); // Historie übernommen
    expect(vault._textFiles.get(NOTE)).toBe(TEXT); // kein Verlust in der .md
  });
});
