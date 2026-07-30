// Task 16 — Der Y.Doc darf der .md nicht unbemerkt vorauslaufen.
//
// Ausgangslage: `applyLocalContent` zieht ausstehende Fremd-Sidecars in den Doc
// (Task 11/12), schreibt die .md aber NICHT zurück — das passiert allein im
// Write-Back von `onRemoteYjsUpdate` (Poll, 30 s). Zwischen Fremd-Merge und Poll
// gilt: der Doc kennt den Fremd-Edit, die .md nicht.
//
// Nimmt der nächste lokale Diff den Doc als Basis, ist das Delta „Basis → .md"
// genau die LÖSCHUNG des Fremd-Edits. `setContent` schreibt sie als Delete-Op,
// `saveState` persistiert sie, der Sync trägt sie zur Gegenseite — der Satz ist
// auf beiden Geräten weg, ohne Meldung und unheilbar (fund-endzustaende.md, Fund 1).
//
// Getestet wird auf zwei Ebenen:
//   - Plugin-Ebene (echter modify-Handler, echter Watcher): zwei Tastendrücke
//     ohne Poll dazwischen.
//   - Handler-Ebene: die Invariante von `mergeForLocalDiff` selbst — ein Doc-
//     Vorlauf darf nie als lokale Löschung verbucht werden, unabhängig davon, ob
//     ein Aufrufer die .md zwischendurch zurückschreibt.

import { TFile } from 'obsidian';
import CrdtSyncPlugin from '../src/main';
import { SyncHandler } from '../src/sync-handler';
import { CrdtManager } from '../src/crdt-manager';
import { decodeStateFile, encodeStateFile } from '../src/state-file';
import {
  makeVaultMock,
  makeLocalStorage,
  toArrayBuffer,
  type VaultMock,
} from './helpers/vault-mock';

const NOTE = 'note.md';
const OWN_ID = 'aaaa1111';
const FOREIGN_ID = 'bbbb2222';
const OWN_PATH = `.qollab/${NOTE}.${OWN_ID}.yjs`;
const FOREIGN_PATH = `.qollab/${NOTE}.${FOREIGN_ID}.yjs`;

const BASE = 'L1\nL2\nL3\n';
const WITH_FOREIGN = 'L1\nL2\nL3\nFREMD\n';

const count = (text: string, needle: string): number => text.split(needle).length - 1;

function tfile(path: string): TFile {
  const f = new TFile();
  f.path = path;
  f.name = path.split('/').pop() ?? path;
  return f;
}

// Ein Gerät über den ECHTEN onload-Pfad (modify-Handler, Watcher, Write-Back).
// onLayoutReady bleibt ein No-op — Sweep/Initial-Scan werden gezielt gerufen.
async function bootDevice(vault: VaultMock): Promise<{
  plugin: any;
  handlers: Map<string, (...args: any[]) => any>;
}> {
  const storage = makeLocalStorage();
  storage.saveLocalStorage('qollab-client-id', OWN_ID);
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
    workspace: { on: () => ({}), offref: () => {}, onLayoutReady: () => {} },
    loadLocalStorage: storage.loadLocalStorage,
    saveLocalStorage: storage.saveLocalStorage,
  };
  const plugin = new (CrdtSyncPlugin as any)(app, {});
  plugin._data = { enabled: true, statusNotice: false, tombstones: {} };
  await plugin.onload();
  return { plugin, handlers };
}

// Ein Tastendruck: neuer .md-Inhalt + Obsidians modify-Event.
async function type(
  vault: VaultMock,
  handlers: Map<string, (...args: any[]) => any>,
  text: string
): Promise<void> {
  vault._textFiles.set(NOTE, text);
  vault._mdMtimes.set(NOTE, (vault._mdMtimes.get(NOTE) ?? 0) + 1);
  await handlers.get('modify')!(tfile(NOTE));
}

// Fremd-Sidecar des Peers: leitet von UNSEREM Stand ab, damit die gemeinsamen
// Zeilen dieselben Yjs-Item-IDs tragen (sonst dedupliziert der Merge nicht) und
// nur `FREMD` die Client-ID des Peers trägt. Die zugehörige .md kommt bewusst
// NICHT mit — genau die vom README beschriebene Ankunftsreihenfolge.
function placeForeignSidecar(vault: VaultMock, fromPath = OWN_PATH): void {
  const own = decodeStateFile(new Uint8Array(vault._files.get(fromPath)!));
  const peer = new CrdtManager();
  peer.applyUpdate(NOTE, own.update);
  peer.setContent(NOTE, WITH_FOREIGN);
  vault._files.set(
    FOREIGN_PATH,
    toArrayBuffer(encodeStateFile(own.guid!, peer.encodeState(NOTE)))
  );
  vault._mtimes.set(FOREIGN_PATH, (vault._mtimes.get(OWN_PATH) ?? 0) + 1);
}

describe('Doc-Vorlauf: lokaler Diff darf einen gemergten Fremd-Edit nicht löschen', () => {
  it('Plugin-Ebene: zweiter Tastendruck ohne Poll dazwischen behält den Fremd-Edit', async () => {
    const vault = makeVaultMock();
    vault._textFiles.set(NOTE, BASE);
    vault._mdMtimes.set(NOTE, 1);
    const { plugin, handlers } = await bootDevice(vault);

    // Erster Kontakt: unsere Note wird erfasst, eigene Sidecar entsteht.
    await type(vault, handlers, BASE);
    expect(vault._files.has(OWN_PATH)).toBe(true);

    // Der Datei-Sync bringt NUR die Sidecar des Peers (die .md ist noch unterwegs).
    placeForeignSidecar(vault);

    // Tastendruck 1: mergePendingForeign zieht FREMD in den Doc.
    await type(vault, handlers, `${BASE}LOKAL1\n`);
    expect(plugin.crdtManager.getContent(NOTE)).toContain('FREMD');

    // Tastendruck 2 — OHNE Poll dazwischen. Der Nutzer tippt auf dem Text weiter,
    // den seine Datei aktuell trägt (was auch immer davon zurückgeschrieben wurde).
    await type(vault, handlers, `${vault._textFiles.get(NOTE)}LOKAL2\n`);

    const doc = plugin.crdtManager.getContent(NOTE);
    expect(count(doc, 'FREMD')).toBe(1); // RED (ohne Fix): 0 — als Delete-Op verworfen
    expect(count(doc, 'LOKAL1')).toBe(1);
    expect(count(doc, 'LOKAL2')).toBe(1);

    // Und die Löschung darf auch nicht in der eigenen Sidecar stehen (sie ist das,
    // was der Sync zur Gegenseite trägt).
    const persisted = new CrdtManager();
    persisted.applyUpdate(NOTE, decodeStateFile(new Uint8Array(vault._files.get(OWN_PATH)!)).update);
    expect(count(persisted.getContent(NOTE), 'FREMD')).toBe(1);
  });

  it('Plugin-Ebene Kontrolle: Poll (Write-Back) zwischen den Tastendrücken bleibt heil', async () => {
    const vault = makeVaultMock();
    vault._textFiles.set(NOTE, BASE);
    vault._mdMtimes.set(NOTE, 1);
    const { plugin, handlers } = await bootDevice(vault);
    await type(vault, handlers, BASE);
    placeForeignSidecar(vault);

    await type(vault, handlers, `${BASE}LOKAL1\n`);
    // Der 30-s-Poll holt die .md auf den Doc-Stand.
    await plugin.sidecarWatcher.poll();
    expect(vault._textFiles.get(NOTE)).toContain('FREMD');

    await type(vault, handlers, `${vault._textFiles.get(NOTE)}LOKAL2\n`);

    const doc = plugin.crdtManager.getContent(NOTE);
    // Genau EINMAL: der Write-Back hat FREMD in die .md gebracht, ein Diff gegen
    // eine veraltete Basis würde ihn als lokale Einfügung ein zweites Mal anwenden.
    expect(count(doc, 'FREMD')).toBe(1);
    expect(count(doc, 'LOKAL1')).toBe(1);
    expect(count(doc, 'LOKAL2')).toBe(1);
    expect(vault._textFiles.get(NOTE)).toBe(doc);
  });

  it('Handler-Ebene: der Doc-Vorlauf allein macht aus dem nächsten Diff keine Löschung', async () => {
    const vault = makeVaultMock() as any;
    const manager = new CrdtManager();
    const handler = new SyncHandler(vault, manager, OWN_ID);

    // Eigener Stand (Basis) auf der Platte + im Doc.
    vault._textFiles.set(NOTE, BASE);
    await handler.applyLocalContent(NOTE, BASE);

    // Fremd-Sidecar ohne zugehörige .md.
    placeForeignSidecar(vault);

    // Tastendruck 1: Fremd-Merge, Doc läuft der .md voraus (kein Write-Back auf
    // dieser Ebene — genau der Zustand, den der Fix aushalten muss).
    vault._textFiles.set(NOTE, `${BASE}LOKAL1\n`);
    await handler.applyLocalContent(NOTE, `${BASE}LOKAL1\n`);
    expect(manager.getContent(NOTE)).toContain('FREMD');
    expect(vault._textFiles.get(NOTE)).not.toContain('FREMD');

    // Tastendruck 2 auf derselben (vorlauf-freien) .md.
    vault._textFiles.set(NOTE, `${BASE}LOKAL1\nLOKAL2\n`);
    await handler.applyLocalContent(NOTE, `${BASE}LOKAL1\nLOKAL2\n`);

    const doc = manager.getContent(NOTE);
    expect(count(doc, 'FREMD')).toBe(1); // RED (ohne Fix): 0
    expect(count(doc, 'LOKAL1')).toBe(1);
    expect(count(doc, 'LOKAL2')).toBe(1);
  });

  it('Handler-Ebene: eine echte lokale Löschung bleibt eine Löschung', async () => {
    const vault = makeVaultMock() as any;
    const manager = new CrdtManager();
    const handler = new SyncHandler(vault, manager, OWN_ID);

    vault._textFiles.set(NOTE, `${BASE}WEG\n`);
    await handler.applyLocalContent(NOTE, `${BASE}WEG\n`);

    // Der Nutzer löscht seine eigene Zeile wieder.
    vault._textFiles.set(NOTE, BASE);
    await handler.applyLocalContent(NOTE, BASE);

    expect(manager.getContent(NOTE)).toBe(BASE);
  });

  it('Handler-Ebene: Sync-Overwrite mit dem gemergten Stand erzeugt kein Duplikat', async () => {
    // Abgrenzung zu Task 11: die .md kommt per Datei-Sync bereits MIT dem
    // Fremd-Edit, die Fremd-Sidecar liegt ungemergt daneben. Hier darf der Diff
    // die Fremd-Einfügung nicht als eigene Op erfinden (Duplikat) — der Vorlauf-Fix
    // darf diesen Pfad nicht aufweichen.
    const vault = makeVaultMock() as any;
    const manager = new CrdtManager();
    const handler = new SyncHandler(vault, manager, OWN_ID);

    vault._textFiles.set(NOTE, BASE);
    await handler.applyLocalContent(NOTE, BASE);
    placeForeignSidecar(vault);

    vault._textFiles.set(NOTE, WITH_FOREIGN);
    await handler.applyLocalContent(NOTE, WITH_FOREIGN);

    expect(count(manager.getContent(NOTE), 'FREMD')).toBe(1);
    const merged = await handler.loadAndMerge(NOTE);
    expect(count(merged as string, 'FREMD')).toBe(1);
  });
});
