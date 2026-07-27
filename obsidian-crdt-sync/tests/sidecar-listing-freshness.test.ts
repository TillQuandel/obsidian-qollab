// Task 12 — Verlässliche Sidecar-Sicht.
//
// Realtest-Befund (Lauf 3): Bs Sidecar lag seit t=0 auf der Disk, `adapter.list`
// lieferte sie aber ~50 s lang NICHT (Watcher-Poll t+20 s und mergePendingForeign
// t+28 s sahen sie nicht, der Poll t+50 s sah sie). Folge: mergePendingForeign
// merged nichts → base === mergedText → der 3-Wege-Kurzschluss greift nicht →
// threeWayMerge erfindet die Fremd-Zeile als lokale Op unter EIGENER Client-ID.
// Der spätere Merge von Bs Original-Ops dupliziert sie dauerhaft.
//
// Zwei Ursachen, beide hier abgedeckt:
//   H1  gecachte/verzögerte Adapter-Sicht auf den Dot-Ordner → cache-freies Listing
//   H2  transienter Lesefehler (EBUSY) wurde zu einem stillen „existiert nicht"
//
// Harte Leitplanke: „korrupt" (Read ok, Parse/applyUpdate scheitert) bleibt vom
// transienten IO-Fehler getrennt — eine dauerhaft korrupte Datei darf lokale
// Edits NICHT blockieren (Szenario-6-Regression).

import * as fs from 'fs';
import * as os from 'os';
import * as nodePath from 'path';
import * as Y from 'yjs';

import { SyncHandler } from '../src/sync-handler';
import { CrdtManager } from '../src/crdt-manager';
import { encodeStateFile } from '../src/state-file';
import { makeVaultMock, toArrayBuffer } from './helpers/vault-mock';

const GUID = 'aabbccddeeff00112233445566778899';
const A_ID = 'aaaaaaaa';
const B_ID = 'bbbbbbbb';
const C_ID = 'cccccccc';
const NOTE = 'note.md';
const A_PATH = `.qollab/${NOTE}.${A_ID}.yjs`;
const B_PATH = `.qollab/${NOTE}.${B_ID}.yjs`;
const C_PATH = `.qollab/${NOTE}.${C_ID}.yjs`;

const BASE_X = 'line-0\nEDIT-A\n'; // A editierte Punkt 1
const BASE_X_Y = 'line-0\nEDIT-A\nEDIT-B\n'; // B mergte A + editierte Punkt 2
const BASE_X_Z = 'line-0\nEDIT-A\nEDIT-Z\n'; // echter lokaler Edit Z

const countB = (s: string) => s.split('EDIT-B').length - 1;
const countZ = (s: string) => s.split('EDIT-Z').length - 1;

// Provenienz-Probe: Zahl der Yjs-Clients im Doc. Erfindet applyLocalContent die
// Fremd-Zeile als eigene Op, taucht ein DRITTER Client (der lokale Doc selbst)
// neben Basis-Client und Fremd-Client auf.
function clientCount(mgr: CrdtManager): number {
  return Y.decodeStateVector(Y.encodeStateVectorFromUpdate(mgr.encodeState(NOTE))).size;
}

function buildBaseWithA(): CrdtManager {
  const a = new CrdtManager();
  a.setContent(NOTE, BASE_X);
  return a;
}

function sidecarA(a: CrdtManager): ArrayBuffer {
  return toArrayBuffer(encodeStateFile(GUID, a.encodeState(NOTE)));
}

// Bs Sidecar leitet von As Basis ab, damit As Edit dieselben Item-IDs trägt
// (dedupliziert) und nur EDIT-B unter Bs Client-ID steht.
function sidecarB(a: CrdtManager): ArrayBuffer {
  const bDoc = new CrdtManager();
  bDoc.applyUpdate(NOTE, a.encodeState(NOTE));
  bDoc.setContent(NOTE, BASE_X_Y);
  return toArrayBuffer(encodeStateFile(GUID, bDoc.encodeState(NOTE)));
}

describe('Task 12 A: cache-freies Sidecar-Listing (adapter.list-Lag)', () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'qollab-t12-'));
    fs.mkdirSync(nodePath.join(baseDir, '.qollab'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(baseDir, { recursive: true, force: true });
  });

  // Legt eine Sidecar sowohl in der In-Memory-Ablage des Mocks (readBinary) ALS AUCH
  // auf der echten Platte (fs-Listing) ab — genau die Realtest-Lage: Datei liegt da,
  // die Adapter-Sicht hinkt hinterher.
  function placeOnDisk(vault: any, path: string, bytes: ArrayBuffer): void {
    vault._files.set(path, bytes);
    fs.writeFileSync(nodePath.join(baseDir, ...path.split('/')), Buffer.from(bytes));
  }

  it('Repro: verzögerte adapter.list-Sicht auf eine vorhandene Fremd-Sidecar erfindet keine lokale Op', async () => {
    const vault = makeVaultMock() as any;
    const a = buildBaseWithA();
    const adapter = vault.adapter;

    // Desktop-Realität: der Adapter kennt den echten Basispfad des Vaults.
    adapter.getBasePath = () => baseDir;
    // adapter.writeBinary/remove spiegeln in die echte Ablage, damit das
    // fs-Listing und die Mock-Ablage nicht auseinanderlaufen.
    const rawWrite = adapter.writeBinary.bind(adapter);
    adapter.writeBinary = async (p: string, data: ArrayBuffer | Uint8Array) => {
      await rawWrite(p, data);
      const abs = nodePath.join(baseDir, ...p.split('/'));
      fs.mkdirSync(nodePath.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, Buffer.from(toArrayBuffer(data)));
    };

    // Der simulierte Lag: adapter.list verschweigt Bs Sidecar, solange das
    // Cache-Fenster offen ist. Der Direktzugriff aufs Dateisystem sieht sie.
    const lag = { active: false };
    const rawList = adapter.list.bind(adapter);
    adapter.list = async (dir: string) => {
      const res = await rawList(dir);
      if (!lag.active) return res;
      return { files: res.files.filter((f: string) => f !== B_PATH), folders: res.folders };
    };

    // Ausgangslage: A hat Punkt 1 editiert, eigener State liegt auf der Platte.
    placeOnDisk(vault, A_PATH, sidecarA(a));
    vault._textFiles.set(NOTE, BASE_X);
    const manager = new CrdtManager();
    const handler = new SyncHandler(vault, manager, A_ID);
    await handler.loadAndMerge(NOTE); // Doc = base+X, GUID etabliert

    // Bs Sync trifft ein: Fremd-Sidecar UND die bereits gemergte .md landen
    // gleichzeitig auf der Platte — die Adapter-Sicht hinkt aber hinterher.
    lag.active = true;
    placeOnDisk(vault, B_PATH, sidecarB(a));
    vault._textFiles.set(NOTE, BASE_X_Y);

    // modify-Event auf der übersyncten .md.
    await handler.applyLocalContent(NOTE, BASE_X_Y);

    // Lag-Fenster vorbei (im Realtest: Poll t+50 s) → Watcher zieht Bs Sidecar ein.
    lag.active = false;
    const merged = await handler.loadAndMerge(NOTE);

    expect(merged).not.toBeNull();
    expect(countB(merged as string)).toBe(1); // RED (unfixed): 2
    // Kein dritter Client: die Fremd-Zeile stammt aus Bs Ops, nicht aus einer
    // erfundenen A-Op.
    expect(clientCount(manager)).toBe(2); // RED (unfixed): 3
  });
});

describe('Task 12 B: transienter IO-Fehler ist kein „kein State"', () => {
  function setup() {
    const vault = makeVaultMock() as any;
    const a = buildBaseWithA();
    vault._files.set(A_PATH, sidecarA(a));
    vault._textFiles.set(NOTE, BASE_X);
    const manager = new CrdtManager();
    const corrupt: string[] = [];
    const handler = new SyncHandler(vault, manager, A_ID, undefined, (p: string) =>
      corrupt.push(p)
    );
    return { vault, a, manager, handler, corrupt };
  }

  it('readBinary wirft (EBUSY-artig) → applyLocalContent bricht ab, ohne Ops und ohne saveState', async () => {
    const { vault, a, manager, handler, corrupt } = setup();
    await handler.loadAndMerge(NOTE); // Doc = base+X

    // Bs Sidecar liegt da, ist aber gerade nicht lesbar (Handle/EBUSY).
    vault._files.set(B_PATH, sidecarB(a));
    vault._textFiles.set(NOTE, BASE_X_Y);
    const rawRead = vault.adapter.readBinary.bind(vault.adapter);
    let failing = true;
    vault.adapter.readBinary = async (p: string) => {
      if (failing && p === B_PATH) throw new Error('EBUSY: resource busy or locked');
      return rawRead(p);
    };

    const writesBefore = vault._writeCount.get(A_PATH) ?? 0;
    await handler.applyLocalContent(NOTE, BASE_X_Y);

    // Abbruch: kein setContent (Doc unverändert), kein saveState.
    expect(manager.getContent(NOTE)).toBe(BASE_X);
    expect(vault._writeCount.get(A_PATH) ?? 0).toBe(writesBefore);
    // Ein transienter IO-Fehler ist NICHT „korrupt" — keine Notice.
    expect(corrupt).toEqual([]);

    // Nächster Trigger ohne Fehler konvergiert korrekt.
    failing = false;
    await handler.applyLocalContent(NOTE, BASE_X_Y);
    expect(countB(manager.getContent(NOTE))).toBe(1);
    expect(clientCount(manager)).toBe(2);

    const merged = await handler.loadAndMerge(NOTE);
    expect(countB(merged as string)).toBe(1);
  });

  it('readBinary wirft im loadAndMerge → kein Merge auf Halbwissen, kein Write-Back-Stand', async () => {
    const { vault, a, manager, handler } = setup();
    await handler.loadAndMerge(NOTE);

    vault._files.set(B_PATH, sidecarB(a));
    const rawRead = vault.adapter.readBinary.bind(vault.adapter);
    let failing = true;
    vault.adapter.readBinary = async (p: string) => {
      if (failing && p === B_PATH) throw new Error('EBUSY: resource busy or locked');
      return rawRead(p);
    };

    const merged = await handler.loadAndMerge(NOTE);
    expect(merged).toBeNull(); // kein halber Stand nach außen
    expect(manager.getContent(NOTE)).toBe(BASE_X);

    failing = false;
    const merged2 = await handler.loadAndMerge(NOTE);
    expect(countB(merged2 as string)).toBe(1);
  });
});

describe('Task 12 Wächter: korrupt ≠ IO-Fehler (Szenario 6)', () => {
  it('dauerhaft korrupte Fremd-Sidecar blockiert lokale Edits nicht', async () => {
    const vault = makeVaultMock() as any;
    const a = buildBaseWithA();
    vault._files.set(A_PATH, sidecarA(a));
    vault._textFiles.set(NOTE, BASE_X);
    const manager = new CrdtManager();
    const corrupt: string[] = [];
    const handler = new SyncHandler(vault, manager, A_ID, undefined, (p: string) =>
      corrupt.push(p)
    );
    await handler.loadAndMerge(NOTE);

    // Read GELINGT, aber die Update-Bytes sind Garbage (gleiche GUID → kompatibel,
    // also läuft applyUpdate und wirft). Das ist „korrupt", nicht „transient".
    vault._files.set(C_PATH, toArrayBuffer(encodeStateFile(GUID, new Uint8Array(50).fill(0xff))));

    // Lokaler Edit muss trotzdem durchlaufen: Datei überspringen, Notice, weiter.
    const writesBefore = vault._writeCount.get(A_PATH) ?? 0;
    vault._textFiles.set(NOTE, BASE_X_Z);
    await handler.applyLocalContent(NOTE, BASE_X_Z);

    expect(countZ(manager.getContent(NOTE))).toBe(1);
    expect(vault._writeCount.get(A_PATH) ?? 0).toBeGreaterThan(writesBefore);
    expect(corrupt).toContain(C_PATH);

    // Keine dauerhafte Blockade: zweiter Edit landet ebenfalls.
    const writesMid = vault._writeCount.get(A_PATH) ?? 0;
    await handler.applyLocalContent(NOTE, `${BASE_X_Z}EDIT-W\n`);
    expect(manager.getContent(NOTE)).toContain('EDIT-W');
    expect(vault._writeCount.get(A_PATH) ?? 0).toBeGreaterThan(writesMid);

    // Und der Merge-Pfad läuft ebenfalls weiter (überspringt nur die kaputte Datei).
    const merged = await handler.loadAndMerge(NOTE);
    expect(merged).not.toBeNull();
    expect(countZ(merged as string)).toBe(1);
  });
});
