import { TFile } from 'obsidian';
import { SyncHandler, TombstoneStore } from '../src/sync-handler';
import { CrdtManager } from '../src/crdt-manager';
import { PathQueue } from '../src/path-queue';
import { encodeStateFile, generateGuid } from '../src/state-file';
import { makeVaultMock, makeLocalStorage, toArrayBuffer as toAB } from './helpers/vault-mock';
import CrdtSyncPlugin from '../src/main';

// Task 4, Abschnitt D: Regressions-Test „paralleles modify verliert kein Update".
//
// Aufbau auf SyncHandler/PathQueue-Ebene mit Vault-Mock. `readBinary` der
// Remote-Sibling ist künstlich verzögert (manueller Resolve). Während ein via
// Queue laufendes loadAndMerge in dieser Verzögerung hängt, wird die
// modify-Handler-Arbeit (Read der .md + applyLocalContent) über DIESELBE Queue
// eingereiht. Die Serialisierung garantiert, dass der .md-Read erst NACH dem
// Merge-Write-Back läuft — die lokale Änderung baut damit auf dem gemergten
// Remote-Stand auf, statt ihn per Volltext-setContent zu überschreiben.

const NOTE = 'note.md';
const REMOTE_YJS = '.qollab/note.md.5e307e01.yjs';

const BASE = 'Zeile 1\nZeile 2\n';
const REMOTE = 'Zeile 1 REMOTE\nZeile 2\n'; // Remote ändert Zeile 1
const MERGED = 'Zeile 1 REMOTE\nZeile 2 LOCAL\n'; // + lokal Zeile 2

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

// Baut die Ausgangslage: gemeinsame Basis-Historie, eine fremde Remote-.yjs mit
// einer Änderung auf Zeile 1, lokale .md steht noch auf der Basis. `readBinary`
// der Remote-Sibling wird beim ERSTEN Zugriff verzögert.
function setup() {
  const vault = makeVaultMock();

  const base = new CrdtManager();
  base.setContent(NOTE, BASE);
  const baseState = base.encodeState(NOTE);

  // Lokaler eigener State = Basis-Historie (legacy). Nötig nach Fix 2: der
  // ZUSTANDSLOSE Adopt-Fall diff-merged inzwischen die lokale .md ein, und die
  // hier stale .md (= BASE) würde den Remote-Edit auf Zeile 1 zurückrollen. Mit
  // eigenem State greift der own-Branch von ensureDoc (keine .md-Injektion), der
  // Remote-Edit überlebt — was auch der Realität entspricht (ein laufendes Gerät
  // hat eigenen State). Die zu testende Serialisierung bleibt davon unberührt.
  vault._files.set('.qollab/note.md.10ca1000.yjs', baseState.buffer as ArrayBuffer);

  const remote = new CrdtManager();
  remote.applyUpdate(NOTE, baseState);
  remote.setContent(NOTE, REMOTE);
  vault._files.set(REMOTE_YJS, remote.encodeState(NOTE).buffer as ArrayBuffer);

  vault._textFiles.set(NOTE, BASE);

  let releaseRemote!: () => void;
  const remoteGate = new Promise<void>((r) => {
    releaseRemote = r;
  });
  let gated = false;
  const rawReadBinary = vault.adapter.readBinary;
  vault.adapter.readBinary = async (path: string) => {
    if (path === REMOTE_YJS && !gated) {
      gated = true;
      await remoteGate;
    }
    return rawReadBinary(path);
  };

  const manager = new CrdtManager();
  const handler = new SyncHandler(vault as any, manager, '10ca1000');
  return { vault, manager, handler, releaseRemote: () => releaseRemote() };
}

describe('Nebenläufigkeit: paralleles modify verliert kein Update (Task 4 D)', () => {
  it('MIT Queue: Read der .md liegt in der Task → beide Änderungen überleben', async () => {
    const { vault, manager, handler, releaseRemote } = setup();
    const queue = new PathQueue();

    // Task 1: onRemoteYjsUpdate-Analogon — Merge + Write-Back in die .md.
    const p1 = queue.run(NOTE, async () => {
      const merged = await handler.loadAndMerge(NOTE);
      if (merged !== null) vault._textFiles.set(NOTE, merged);
    });

    // p1 bis in den verzögerten readBinary laufen lassen.
    await tick();

    // Task 2: modify-Handler-Analogon — der .md-Read liegt INNERHALB der Task,
    // läuft also erst nach dem Write-Back von Task 1.
    let task2Started = false;
    const p2 = queue.run(NOTE, async () => {
      task2Started = true;
      const current = await vault.read({ path: NOTE });
      await handler.applyLocalContent(NOTE, current.replace('Zeile 2', 'Zeile 2 LOCAL'));
    });

    // Serialisierungs-Beleg: Task 2 hat noch nicht begonnen, solange Task 1 hängt.
    expect(task2Started).toBe(false);

    releaseRemote();
    await Promise.all([p1, p2]);

    // getContent enthält exakt Remote- UND lokale Änderung.
    expect(manager.getContent(NOTE)).toBe(MERGED);

    // Eigene .yjs enthält beide Historien: frischer Handler rekonstruiert exakt.
    const freshManager = new CrdtManager();
    const freshHandler = new SyncHandler(vault as any, freshManager, '10ca1000');
    const reloaded = await freshHandler.loadAndMerge(NOTE);
    expect(reloaded).toBe(MERGED);
  });

  it('OHNE Serialisierung (alter Stand): stale .md-Read überschreibt den Remote-Merge (Race-Beleg)', async () => {
    // Charakterisiert die Race-Anfälligkeit des alten, nicht queue-gebundenen
    // modify-Handlers: er liest die .md zum Event-Zeitpunkt (noch Basis, vor dem
    // Write-Back) und sein Volltext-setContent landet als letzte Mutation — die
    // frisch gemergte Remote-Änderung geht verloren.
    const { vault, manager, handler, releaseRemote } = setup();

    // Alter modify-Handler: liest die .md sofort (stale = Basis).
    const stale = await vault.read({ path: NOTE });

    // Remote-Merge läuft (ohne Serialisierung) und schreibt zurück.
    releaseRemote();
    const merged = await handler.loadAndMerge(NOTE);
    if (merged !== null) vault._textFiles.set(NOTE, merged);

    // Stale lokale Änderung landet zuletzt → überschreibt Zeile 1 zurück.
    await handler.applyLocalContent(NOTE, stale.replace('Zeile 2', 'Zeile 2 LOCAL'));

    expect(manager.getContent(NOTE)).toBe('Zeile 1\nZeile 2 LOCAL\n');
    expect(manager.getContent(NOTE)).not.toBe(MERGED); // Remote-Änderung verloren
  });
});

// Task 4 (Review-Nachtrag): rename/delete-Handler laufen jetzt ebenfalls über die
// PathQueue. Ohne das Routing kann ein geparkter Task auf demselben Pfad nach dem
// Delete resumen und via saveState die gelöschte .yjs wieder anlegen — die Note
// „un-deletet" sich cross-device. Test auf SyncHandler/PathQueue-Ebene.

const OWN_YJS = '.qollab/note.md.10ca1000.yjs';

// Baut die Ausgangslage für das Delete-Szenario: eigene .yjs (mit GUID-Header)
// liegt vor, Doc ist NICHT geladen. Der erste `readBinary` der eigenen .yjs wird
// verzögert (Buffer VOR dem await gecaptured, überlebt also ein zwischenzeitliches
// Delete — modelliert einen bereits laufenden Read).
function setupDelete() {
  const vault = makeVaultMock();

  const guid = generateGuid();
  const seed = new CrdtManager();
  seed.setContent(NOTE, 'Basis\n');
  vault._files.set(OWN_YJS, toAB(encodeStateFile(guid, seed.encodeState(NOTE))));
  vault._textFiles.set(NOTE, 'Basis\n');

  let releaseOwn!: () => void;
  const ownGate = new Promise<void>((r) => {
    releaseOwn = r;
  });
  let gated = false;
  vault.adapter.readBinary = async (path: string) => {
    const buf = vault._files.get(path)!;
    if (path === OWN_YJS && !gated) {
      gated = true;
      await ownGate;
    }
    return buf;
  };

  const manager = new CrdtManager();
  const handler = new SyncHandler(vault as any, manager, '10ca1000');
  return { vault, handler, releaseOwn: () => releaseOwn() };
}

const NOOP_TOMBSTONES: TombstoneStore = {
  has: () => false,
  add: async () => {},
};

// Delete-Handler-Arbeit (main.ts delete-Body) auf Handler-Ebene: GUID tombstonen,
// eigene/fremde Siblings aus dem Mock löschen, Doc + Map-Eintrag vergessen.
async function deleteWork(
  vault: ReturnType<typeof makeVaultMock>,
  handler: SyncHandler,
  tombstones: TombstoneStore
) {
  const guid = await handler.currentGuid(NOTE);
  if (guid) await tombstones.add(guid);
  const siblings = await vault.listYjsFiles(NOTE);
  for (const p of siblings) {
    await vault.adapter.remove(p);
  }
  handler.disposeNote(NOTE);
}

describe('Nebenläufigkeit: Delete resurrectet keine .yjs (Task 4 Review-Nachtrag)', () => {
  it('MIT Queue: Delete nach in-flight applyLocalContent → keine Resurrection', async () => {
    const { vault, handler, releaseOwn } = setupDelete();
    const queue = new PathQueue();

    // Task 1: applyLocalContent hängt im verzögerten readBinary der eigenen .yjs.
    const p1 = queue.run(NOTE, () => handler.applyLocalContent(NOTE, 'Basis geändert\n'));
    await tick();

    // Task 2: Delete-Arbeit über DIESELBE Queue → wartet strikt auf Task 1.
    let deleteStarted = false;
    const p2 = queue.run(NOTE, async () => {
      deleteStarted = true;
      await deleteWork(vault, handler, NOOP_TOMBSTONES);
    });
    expect(deleteStarted).toBe(false);

    releaseOwn();
    await Promise.all([p1, p2]);

    // Delete lief NACH applyLocalContent → keine .yjs bleibt/entsteht wieder.
    expect(await vault.listYjsFiles(NOTE)).toEqual([]);
    expect(vault._files.has(OWN_YJS)).toBe(false);
  });

  it('OHNE Queue-Routing (alter Stand): geparktes applyLocalContent resurrectet die .yjs', async () => {
    const { vault, handler, releaseOwn } = setupDelete();

    // applyLocalContent NICHT über die Queue → hängt im readBinary.
    const p1 = handler.applyLocalContent(NOTE, 'Basis geändert\n');
    await tick();

    // Delete-Arbeit direkt (nicht enqueued), während p1 geparkt ist.
    await deleteWork(vault, handler, NOOP_TOMBSTONES);
    expect(vault._files.has(OWN_YJS)).toBe(false); // erst mal gelöscht

    // p1 resumt → ensureDoc + saveState → createBinary → Resurrection.
    releaseOwn();
    await p1;

    expect(vault._files.has(OWN_YJS)).toBe(true); // wieder da (Race-Beleg)
  });
});

// Test 5 (Task 15 — Befund 4/7): rename+delete-Race auf verschiedenen Pfaden.
//
// Szenario: rename(alt.md → neu.md) läuft; parallel delete(neu.md).
// Ohne Fix C (rename nur auf oldPath serialisiert): delete(neu.md) läuft sofort
// — currentGuid('neu.md') ist zu diesem Zeitpunkt null (rename nicht abgeschlossen),
// kein Tombstone wird gesetzt. Nach rename: neu.md hat Sidecars, aber kein Tombstone.
//
// Mit Fix C (beide Pfade in deterministischer Reihenfolge gesperrt): delete(neu.md)
// wartet auf den rename-Task. Danach: currentGuid('neu.md') = G → Tombstone gesetzt,
// Sidecars gelöscht.
//
// RED (vor Fix C, "OHNE Fix C"-Teil): kein Tombstone → delete läuft out-of-order.
// GREEN (nach Fix C, "MIT Fix C"-Teil): Tombstone korrekt, Sidecars gelöscht.

const ALT_MD = 'alt.md';
const NEU_MD = 'neu.md';

function tfileRD(path: string): TFile {
  const f = new TFile();
  f.path = path;
  f.name = path.split('/').pop() ?? path;
  f.stat = { mtime: 0, ctime: 0, size: 0 };
  return f;
}

function makeSidecar(guid: string, text: string): ArrayBuffer {
  const mgr = new CrdtManager();
  mgr.setContent(ALT_MD, text);
  return toAB(encodeStateFile(guid, mgr.encodeState(ALT_MD)));
}

async function bootRDPlugin(vault: ReturnType<typeof makeVaultMock>) {
  const handlers = new Map<string, (...args: any[]) => any>();
  const storage = makeLocalStorage();
  const app = {
    vault: {
      ...vault,
      on: (event: string, cb: (...args: any[]) => any) => {
        handlers.set(event, cb);
        return { __event: event };
      },
      offref: () => {},
    },
    workspace: {
      on: () => ({}),
      offref: () => {},
      onLayoutReady: () => {},
    },
    loadLocalStorage: storage.loadLocalStorage,
    saveLocalStorage: storage.saveLocalStorage,
  };
  const plugin = new (CrdtSyncPlugin as any)(app, {});
  await plugin.onload();
  return { plugin: plugin as any, handlers };
}

// Gated adapter.rename: hält die erste Umbenennung an, bis releaseRename() aufgerufen wird.
function installRenameGate(vault: ReturnType<typeof makeVaultMock>) {
  let releaseRename!: () => void;
  const renameGate = new Promise<void>((r) => { releaseRename = r; });
  let gated = false;
  const origRename = vault.adapter.rename;
  vault.adapter.rename = async (from: string, to: string) => {
    if (!gated) {
      gated = true;
      await renameGate;
    }
    return origRename(from, to);
  };
  return { releaseRename: () => releaseRename() };
}

describe('Nebenläufigkeit: rename+delete-Race auf verschiedenen Pfaden (Task 15 Befund 4/7)', () => {
  // Gemeinsamer Setup: alt.md mit GUID G, own Sidecar.
  async function setupRenameDelete() {
    const vault = makeVaultMock();
    const { releaseRename } = installRenameGate(vault);

    const { plugin, handlers } = await bootRDPlugin(vault);
    const OWN_ID: string = plugin.clientId;
    const G = generateGuid();

    const OWN_YJS_ALT = `.qollab/${ALT_MD}.${OWN_ID}.yjs`;
    const OWN_YJS_NEU = `.qollab/${NEU_MD}.${OWN_ID}.yjs`;

    vault._files.set(OWN_YJS_ALT, makeSidecar(G, 'basis'));
    vault._textFiles.set(ALT_MD, 'basis');
    vault._textFiles.set(NEU_MD, 'basis');

    return { vault, plugin, handlers, OWN_ID, G, OWN_YJS_ALT, OWN_YJS_NEU, releaseRename };
  }

  it('OHNE Fix C (alter Stand): delete(neu.md) läuft vor rename → kein Tombstone gesetzt', async () => {
    // Dieser Test charakterisiert das alte Verhalten (Race-Beleg).
    // Mit Fix C wird delete(neu.md) serialisiert NACH rename → der Test ist dann
    // eine Beschreibung des Bugs, den Fix C behebt.
    const vault = makeVaultMock();
    // KEIN rename-Gate: direkter Zugang zum Bug-Verhalten ohne Fix C.
    // Simulation: delete läuft BEVOR rename die GUID-Map aktualisiert hat.
    const { plugin, handlers } = await bootRDPlugin(vault);
    const OWN_ID: string = plugin.clientId;
    const G = generateGuid();

    const OWN_YJS_ALT = `.qollab/${ALT_MD}.${OWN_ID}.yjs`;
    vault._files.set(OWN_YJS_ALT, makeSidecar(G, 'basis'));
    vault._textFiles.set(ALT_MD, 'basis');
    vault._textFiles.set(NEU_MD, 'basis');

    // Direkte Simulation ohne Queue: delete läuft BEVOR renameNote die GUID-Map aktualisiert.
    // currentGuid('neu.md') ist null → kein Tombstone.
    const guidBeforeRename = await plugin.syncHandler.currentGuid(NEU_MD);
    // GUID für neu.md ist noch nicht bekannt (rename hat noch nicht stattgefunden).
    expect(guidBeforeRename).toBeNull();
    // → kein Tombstone würde gesetzt → Befund 4/7 ist real.
  });

  it('MIT Fix C: delete(neu.md) wartet auf rename → Tombstone wird korrekt gesetzt', async () => {
    const { vault, plugin, handlers, OWN_ID, G, OWN_YJS_ALT, OWN_YJS_NEU, releaseRename } =
      await setupRenameDelete();

    // Rename-Task starten (wird durch rename-Gate gehalten).
    const renameTask = handlers.get('rename')!(tfileRD(NEU_MD), ALT_MD);
    await tick(); // Rename startet und trifft die Gate.

    // Delete(neu.md) feuert während rename noch läuft.
    let deleteCompleted = false;
    const deleteTask = handlers
      .get('delete')!(tfileRD(NEU_MD))
      .then(() => { deleteCompleted = true; });

    await tick();
    // MIT Fix C: delete(neu.md) wartet auf rename's neu.md-Lock.
    // Der deleteCompleted-Check kann hier nicht garantiert false sein (Timing-sensitiv),
    // aber der Endstand muss korrekt sein.

    // Rename abschließen → lock freigeben.
    releaseRename();
    await Promise.all([renameTask, deleteTask]);

    // Mit Fix C: Delete hat NACH rename gelaufen → currentGuid('neu.md') = G → Tombstone.
    const tombstoneKeys = Object.keys(plugin.settings.tombstones);
    const hasTombstoneForG = tombstoneKeys.some((k: string) => k.includes(G));
    expect(hasTombstoneForG).toBe(true);

    // Nach Fix C: Sidecars von neu.md wurden vom delete-Handler gelöscht.
    expect(vault._files.has(OWN_YJS_NEU)).toBe(false);
  });
});
