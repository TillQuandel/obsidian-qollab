// Task 11 — Duplikations-Race: eine per Datei-Sync (robocopy) überschriebene .md
// enthält bereits fremde Edits, deren Original noch in einer ungemergten
// Fremd-Sidecar liegt. Ohne vorheriges Einmergen difft applyLocalContent den
// gemergten .md-Text gegen den Doc (der die Fremd-Ops noch nicht hat) und ERFINDET
// die Fremd-Einfügung als neue lokale Op unter der eigenen Client-ID. Spielt der
// SidecarWatcher später die Fremd-Sidecar ein, dedupliziert Yjs nach Item-ID (nicht
// Inhalt) → der Fremd-Edit steht dauerhaft doppelt im CRDT.

import { SyncHandler } from '../src/sync-handler';
import { CrdtManager } from '../src/crdt-manager';
import { encodeStateFile } from '../src/state-file';
import { makeVaultMock, toArrayBuffer } from './helpers/vault-mock';

// Geteilte Doc-GUID der Inkarnation (A und B teilen sie im Realtest).
const GUID = 'aabbccddeeff00112233445566778899';
const A_ID = 'aaaaaaaa';
const B_ID = 'bbbbbbbb';
const A_PATH = `.qollab/note.md.${A_ID}.yjs`;
const B_PATH = `.qollab/note.md.${B_ID}.yjs`;

const BASE = 'line-0\n';
const BASE_X = 'line-0\nEDIT-A\n'; // A editierte Punkt 1
const BASE_X_Y = 'line-0\nEDIT-A\nEDIT-B\n'; // B mergte A + editierte Punkt 2

const countB = (s: string) => s.split('EDIT-B').length - 1;
const countZ = (s: string) => s.split('EDIT-Z').length - 1;

// Baut den geteilten Basis-Doc mit A's Edit X. Rückgabe: CrdtManager (Träger von
// A's Yjs-Item-IDs für "line-0\nEDIT-A\n"), der als gemeinsame Ableitungsbasis für
// A und B dient — so dedupliziert der Merge A's Edit korrekt.
function buildBaseWithA(): CrdtManager {
  const a = new CrdtManager();
  a.setContent('note.md', BASE_X);
  return a;
}

// Lädt A's Doc (base+X) in den Handler und etabliert GUID im Map — B's Sidecar
// existiert zu diesem Zeitpunkt noch NICHT (realer Zeitverlauf).
async function loadHandlerA(vault: any, a: CrdtManager): Promise<SyncHandler> {
  vault._files.set(A_PATH, toArrayBuffer(encodeStateFile(GUID, a.encodeState('note.md'))));
  vault._textFiles.set('note.md', BASE_X);
  const managerA = new CrdtManager();
  const handlerA = new SyncHandler(vault, managerA, A_ID);
  await handlerA.loadAndMerge('note.md'); // nur A's Sidecar → Doc = base+X, guid gesetzt
  return handlerA;
}

// Legt B's Fremd-Sidecar (base+X+Y, gleiche GUID) an. B leitet von A's Basis ab,
// damit A's Edit X dieselben Item-IDs trägt (dedupliziert), nur EDIT-B (Y) trägt
// B's eigene Client-ID.
function placeForeignSidecarB(vault: any, a: CrdtManager): void {
  const bDoc = new CrdtManager();
  bDoc.applyUpdate('note.md', a.encodeState('note.md')); // base + X von A
  bDoc.setContent('note.md', BASE_X_Y); // fügt EDIT-B unter B's Client-ID hinzu
  vault._files.set(B_PATH, toArrayBuffer(encodeStateFile(GUID, bDoc.encodeState('note.md'))));
}

describe('md-diff / ungemergte Fremd-Sidecar Race', () => {
  it('Repro: Sync-Overwrite der .md dupliziert Fremd-Edit NICHT (RED auf 49fef56)', async () => {
    const vault = makeVaultMock() as any;
    const a = buildBaseWithA();
    const handlerA = await loadHandlerA(vault, a);

    // B's Sync trifft ein: Fremd-Sidecar landet + robocopy überschreibt die .md mit
    // B's bereits gemergtem Stand (base+X+Y).
    placeForeignSidecarB(vault, a);
    vault._textFiles.set('note.md', BASE_X_Y);

    // Obsidian modify-Event für die extern überschriebene .md → applyLocalContent.
    await handlerA.applyLocalContent('note.md', BASE_X_Y);

    // ~12 s später verarbeitet der SidecarWatcher B's Sidecar → loadAndMerge.
    const merged = await handlerA.loadAndMerge('note.md');

    expect(merged).not.toBeNull();
    expect(countB(merged as string)).toBe(1); // RED (unfixed): 2
  });

  it('Gegenreihenfolge: erst Sidecar-Merge, dann identischer Content → einmal Y', async () => {
    const vault = makeVaultMock() as any;
    const a = buildBaseWithA();
    const handlerA = await loadHandlerA(vault, a);

    placeForeignSidecarB(vault, a);
    vault._textFiles.set('note.md', BASE_X_Y);

    // Watcher zuerst: mergt B's Sidecar in den Doc (Doc = base+X+Y).
    const afterMerge = await handlerA.loadAndMerge('note.md');
    expect(countB(afterMerge as string)).toBe(1);

    // Danach das (identische) modify-Event: kein Rewrite-Bedarf, keine neue Op.
    const writesBefore = vault._writeCount.get(A_PATH) ?? 0;
    await handlerA.applyLocalContent('note.md', BASE_X_Y);

    expect(countB(handlerA['crdtManager'].getContent('note.md'))).toBe(1);
    // Identischer State → saveState schreibt die eigene Sidecar nicht neu.
    expect(vault._writeCount.get(A_PATH) ?? 0).toBe(writesBefore);
  });

  it('Echter Simultan-Edit: lokales Z + ausstehendes Fremd-Y überleben je einmal', async () => {
    const vault = makeVaultMock() as any;
    const a = buildBaseWithA();
    const handlerA = await loadHandlerA(vault, a);

    // Fremd-Sidecar mit Y liegt ausstehend vor; die .md trägt zusätzlich ein echtes
    // lokales Z (nicht aus einer Sidecar stammend). Der gemergte Fremd-Stand (Y) ist
    // per Datei-Sync in der .md, das lokale Z wurde obendrauf getippt.
    placeForeignSidecarB(vault, a);
    vault._textFiles.set('note.md', 'line-0\nEDIT-A\nEDIT-B\nEDIT-Z\n');

    await handlerA.applyLocalContent('note.md', 'line-0\nEDIT-A\nEDIT-B\nEDIT-Z\n');

    const content = handlerA['crdtManager'].getContent('note.md');
    expect(countB(content)).toBe(1); // Fremd-Edit Y aus der Sidecar, einmal
    expect(countZ(content)).toBe(1); // lokaler Edit Z, einmal
  });
});
