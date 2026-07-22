// Task 11 — Duplikations-Race: eine per Datei-Sync (robocopy) überschriebene .md
// enthält bereits fremde Edits, deren Original noch in einer ungemergten
// Fremd-Sidecar liegt. Ohne vorheriges Einmergen difft applyLocalContent den
// gemergten .md-Text gegen den Doc (der die Fremd-Ops noch nicht hat) und ERFINDET
// die Fremd-Einfügung als neue lokale Op unter der eigenen Client-ID. Spielt der
// SidecarWatcher später die Fremd-Sidecar ein, dedupliziert Yjs nach Item-ID (nicht
// Inhalt) → der Fremd-Edit steht dauerhaft doppelt im CRDT.
//
// Fix-Runde (Review C-1/I-1): Der Bug trifft auch den Sweep-/Eigen-State-Zweig
// (docExisted === false, Sync bei geschlossener App) — permanent, nicht transient.
// Und rohes mergePendingForeign + 2-Wege-setContent LÖSCHT einen ungemergten
// Fremd-Edit, den die .md nicht enthält (Cross-Device-Datenverlust). Beide Fälle
// werden hier getestet.

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

const BASE_X = 'line-0\nEDIT-A\n'; // A editierte Punkt 1
const BASE_X_Y = 'line-0\nEDIT-A\nEDIT-B\n'; // B mergte A + editierte Punkt 2
const BASE_X_Z = 'line-0\nEDIT-A\nEDIT-Z\n'; // A editierte lokal Punkt Z (kein Y)

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

// Schreibt A's eigene Sidecar (base+X, GUID) auf die Platte, OHNE sie in einen
// Handler zu laden — Ausgangslage für den Sweep-/Restart-Fall.
function placeOwnSidecarA(vault: any, a: CrdtManager): void {
  vault._files.set(A_PATH, toArrayBuffer(encodeStateFile(GUID, a.encodeState('note.md'))));
}

// Lädt A's Doc (base+X) in einen frischen Handler und etabliert die GUID im Map —
// B's Sidecar existiert zu diesem Zeitpunkt noch NICHT (realer Zeitverlauf). Der
// Doc ist danach in-memory (docExisted === true beim nächsten applyLocalContent).
async function loadHandlerA(
  vault: any,
  a: CrdtManager
): Promise<{ handler: SyncHandler; manager: CrdtManager }> {
  placeOwnSidecarA(vault, a);
  vault._textFiles.set('note.md', BASE_X);
  const manager = new CrdtManager();
  const handler = new SyncHandler(vault, manager, A_ID);
  await handler.loadAndMerge('note.md'); // nur A's Sidecar → Doc = base+X, guid gesetzt
  return { handler, manager };
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
  it('Repro Laufzeit: Sync-Overwrite der .md dupliziert Fremd-Edit NICHT', async () => {
    const vault = makeVaultMock() as any;
    const a = buildBaseWithA();
    const { handler } = await loadHandlerA(vault, a); // Doc bereits in-memory

    // B's Sync trifft ein: Fremd-Sidecar landet + robocopy überschreibt die .md mit
    // B's bereits gemergtem Stand (base+X+Y).
    placeForeignSidecarB(vault, a);
    vault._textFiles.set('note.md', BASE_X_Y);

    // Obsidian modify-Event für die extern überschriebene .md → applyLocalContent.
    await handler.applyLocalContent('note.md', BASE_X_Y);

    // ~12 s später verarbeitet der SidecarWatcher B's Sidecar → loadAndMerge.
    const merged = await handler.loadAndMerge('note.md');

    expect(merged).not.toBeNull();
    expect(countB(merged as string)).toBe(1);
  });

  it('Repro Restart/Sweep: Sync bei geschlossener App dupliziert Fremd-Edit NICHT (C-1)', async () => {
    const vault = makeVaultMock() as any;
    const a = buildBaseWithA();

    // Bei GESCHLOSSENER App angekommen: A's eigene Sidecar (base+X) liegt unberührt,
    // B's Fremd-Sidecar (base+X+Y) ist dazugekommen, robocopy hat die .md auf B's
    // gemergten Stand (base+X+Y) überschrieben.
    placeOwnSidecarA(vault, a);
    placeForeignSidecarB(vault, a);
    vault._textFiles.set('note.md', BASE_X_Y);

    // Frischer Start: Doc ist NICHT in-memory (docExisted === false), eigener State
    // liegt auf der Platte → ensureDoc bootstrappt aus Eigen-State OHNE Fremd-Merge.
    const manager = new CrdtManager();
    const handler = new SyncHandler(vault, manager, A_ID);

    // onLayoutReady: erst Sweep (applyLocalContent mit der frischen .md) …
    await handler.applyLocalContent('note.md', BASE_X_Y);
    // … dann der Initial-Scan des Watchers (loadAndMerge zieht B's Sidecar ein).
    const merged = await handler.loadAndMerge('note.md');

    expect(merged).not.toBeNull();
    expect(countB(merged as string)).toBe(1); // RED (unfixed): 2
  });

  it('Gegenreihenfolge: erst Sidecar-Merge, dann identischer Content → einmal Y', async () => {
    const vault = makeVaultMock() as any;
    const a = buildBaseWithA();
    const { handler, manager } = await loadHandlerA(vault, a);

    placeForeignSidecarB(vault, a);
    vault._textFiles.set('note.md', BASE_X_Y);

    // Watcher zuerst: mergt B's Sidecar in den Doc (Doc = base+X+Y).
    const afterMerge = await handler.loadAndMerge('note.md');
    expect(countB(afterMerge as string)).toBe(1);

    // Danach das (identische) modify-Event: kein Rewrite-Bedarf, keine neue Op.
    const writesBefore = vault._writeCount.get(A_PATH) ?? 0;
    await handler.applyLocalContent('note.md', BASE_X_Y);

    expect(countB(manager.getContent('note.md'))).toBe(1);
    // Identischer State → saveState schreibt die eigene Sidecar nicht neu.
    expect(vault._writeCount.get(A_PATH) ?? 0).toBe(writesBefore);
  });

  it('Löschrichtung (I-1): lokales Z ohne Y in der .md → Fremd-Y UND Z überleben je einmal', async () => {
    const vault = makeVaultMock() as any;
    const a = buildBaseWithA();
    const { handler, manager } = await loadHandlerA(vault, a);

    // Ausstehende Fremd-Sidecar mit Y; die .md trägt einen echten lokalen Edit Z,
    // enthält den Fremd-Edit Y aber NICHT (Sidecar synct vor/ohne die zugehörige .md,
    // während lokal weitergetippt wird). Ein rohes 2-Wege-setContent(base+X+Z) würde
    // Ys Items tombstonen → cross-device Datenverlust.
    placeForeignSidecarB(vault, a);
    vault._textFiles.set('note.md', BASE_X_Z);

    await handler.applyLocalContent('note.md', BASE_X_Z);

    const content = manager.getContent('note.md');
    expect(countB(content)).toBe(1); // Fremd-Edit Y NICHT gelöscht
    expect(countZ(content)).toBe(1); // lokaler Edit Z angewandt

    // Cross-device stabil: der spätere Sidecar-Merge dupliziert Y nicht.
    const merged = await handler.loadAndMerge('note.md');
    expect(countB(merged as string)).toBe(1);
    expect(countZ(merged as string)).toBe(1);
  });
});
