import { SyncHandler } from '../src/sync-handler';
import { CrdtManager } from '../src/crdt-manager';
import { encodeStateFile, decodeStateFile } from '../src/state-file';
import { makeVaultMock, toArrayBuffer as toAB } from './helpers/vault-mock';

// Task 13 — Inkarnationswechsel (switchToGuid) und Adopt-Zweig (ensureDoc).
//
// Beide Pfade verwarfen den lokalen Stand per 2-Wege-`setContent(mdText)`: der
// Doc wurde nach dem Wechsel exakt auf den .md-Text gezwungen. Damit ging (a)
// Inhalt verloren, der nur im Verlierer-/lokalen Doc lebte, und (b) Inhalt des
// Gewinners, den die lokale .md noch nicht kannte — letzterer sogar als
// DELETE-Ops, die den Verlust über den CRDT-Merge zum Gewinner zurücktragen.
//
// Zwischen zwei Inkarnationen gibt es keinen gemeinsamen Vorfahren; ein
// 3-Wege-Patch mit .md ODER Doc als Basis liefert deshalb einen leeren Patch,
// sobald beide gleich sind (= Normalfall) und würde den kompletten lokalen
// Beitrag verwerfen. Erwartet wird daher die Vereinigung beider Stände.

const NOTE = 'note.md';
const OWN_YJS = '.qollab/note.md.10ca1000.yjs';
const FOREIGN_YJS = '.qollab/note.md.5e307e01.yjs';
const G_SMALL = '00000000000000000000000000000000'; // gewinnt den Tie-Break
const G_LARGE = 'ffffffffffffffffffffffffffffffff'; // verliert

// Sidecar mit GUID-Header und dem State eines Docs mit `text` schreiben.
function writeSidecar(vault: any, path: string, guid: string, text: string): Uint8Array {
  const m = new CrdtManager();
  m.setContent(NOTE, text);
  const update = m.encodeState(NOTE);
  vault._files.set(path, toAB(encodeStateFile(guid, update)));
  return update;
}

describe('Task 13/A: Inkarnationswechsel verliert keinen Inhalt', () => {
  // Test 1 (Brief): Verlierer-Doc trägt eine Zeile, die NICHT in seiner .md steht.
  it('switchToGuid: Inhalt, der nur im Verlierer-Doc lebt, überlebt den Wechsel', async () => {
    const vault = makeVaultMock() as any;
    const mdText = 'Zeile 1\nZeile 2\n';
    const ownDocText = 'Zeile 1\nZeile 2\nNur-im-Doc X\n';
    const winnerText = 'Zeile 1\nZeile 2\nGewinner Y\n';

    writeSidecar(vault, OWN_YJS, G_LARGE, ownDocText);
    writeSidecar(vault, FOREIGN_YJS, G_SMALL, winnerText);
    vault._textFiles.set(NOTE, mdText);

    const handler = new SyncHandler(vault, new CrdtManager(), '10ca1000');
    const merged = await handler.loadAndMerge(NOTE);

    expect(merged).toContain('Nur-im-Doc X'); // Verlierer-Doc-Inhalt
    expect(merged).toContain('Gewinner Y'); // Gewinner-Inhalt
    expect(merged).toContain('Zeile 1');
    expect(await handler.currentGuid(NOTE)).toBe(G_SMALL);
  });

  // Review C-1/I-1: dieselbe Lage mit Texten OHNE abschließendes Zeilenende —
  // in Obsidian der Normalfall (die S04-Realtest-Note endet auf Byte 0x31).
  it('switchToGuid: klebt ohne abschließendes Zeilenende keine Zeilen zusammen', async () => {
    const vault = makeVaultMock() as any;
    const mdText = 'Zeile 1\nZeile 2';
    const ownDocText = 'Zeile 1\nZeile 2\nNur-im-Doc X';
    const winnerText = 'Zeile 1\nZeile 2\nGewinner Y';

    writeSidecar(vault, OWN_YJS, G_LARGE, ownDocText);
    writeSidecar(vault, FOREIGN_YJS, G_SMALL, winnerText);
    vault._textFiles.set(NOTE, mdText);

    const handler = new SyncHandler(vault, new CrdtManager(), '10ca1000');
    const merged = (await handler.loadAndMerge(NOTE))!;

    // Jede Zeile bleibt eine eigene Zeile (RED: "Gewinner YNur-im-Doc X").
    const lines = merged.split('\n');
    expect(lines).toContain('Zeile 1');
    expect(lines).toContain('Zeile 2');
    expect(lines).toContain('Gewinner Y');
    expect(lines).toContain('Nur-im-Doc X');
    // Kein erfundenes Zeilenende: keine Seite hatte eins.
    expect(merged.endsWith('\n')).toBe(false);
  });

  it('Adopt-Zweig: reine Append-Divergenz ohne Zeilenende bleibt sauber', async () => {
    const vault = makeVaultMock() as any;
    writeSidecar(vault, FOREIGN_YJS, G_SMALL, 'a\nb\nc');
    vault._textFiles.set(NOTE, 'a\nb');

    const handler = new SyncHandler(vault, new CrdtManager(), '10ca1000');
    const merged = await handler.loadAndMerge(NOTE);

    expect(merged).toBe('a\nb\nc'); // RED: "a\nb\ncb"
  });

  // Test 3 (Brief): kein Delete-Op-Rückfluss auf den Gewinner.
  it('switchToGuid: der neue State löscht beim Gewinner nichts, was nur die Verlierer-.md nicht kannte', async () => {
    const vault = makeVaultMock() as any;
    const mdText = 'Zeile 1\nZeile 2\n';
    const winnerText = 'Zeile 1\nZeile 2\nGewinner Y\n';

    writeSidecar(vault, OWN_YJS, G_LARGE, mdText);
    const winnerUpdate = writeSidecar(vault, FOREIGN_YJS, G_SMALL, winnerText);
    vault._textFiles.set(NOTE, mdText);

    const handler = new SyncHandler(vault, new CrdtManager(), '10ca1000');
    await handler.loadAndMerge(NOTE);

    // Sicht des Gewinner-Geräts: eigene Historie + der frisch geschriebene
    // State des Verlierers. Enthielte dieser Delete-Ops für „Gewinner Y",
    // verschwände die Zeile auf dem Gewinner-Gerät (S05-Realbefund).
    const saved = decodeStateFile(new Uint8Array(vault._files.get(OWN_YJS)!));
    expect(saved.guid).toBe(G_SMALL);
    const winnerSide = new CrdtManager();
    winnerSide.applyUpdate(NOTE, winnerUpdate);
    winnerSide.applyUpdate(NOTE, saved.update);
    expect(winnerSide.getContent(NOTE)).toContain('Gewinner Y');
  });

  // Test 2 (Brief): Adopt-Zweig von ensureDoc, Weg über loadAndMerge.
  it('Adopt-Zweig (loadAndMerge): adoptierter Fremd-Inhalt überlebt eine .md, die ihn nicht kennt', async () => {
    const vault = makeVaultMock() as any;
    const foreignText = 'Zeile 1\nFremd F\n';
    const mdText = 'Zeile 1\nLokal L\n';

    writeSidecar(vault, FOREIGN_YJS, G_SMALL, foreignText);
    vault._textFiles.set(NOTE, mdText);

    const handler = new SyncHandler(vault, new CrdtManager(), '10ca1000');
    const merged = await handler.loadAndMerge(NOTE);

    expect(merged).toContain('Fremd F'); // adoptierter Fremd-Stand
    expect(merged).toContain('Lokal L'); // lokaler .md-Stand
    expect(await handler.currentGuid(NOTE)).toBe(G_SMALL); // adoptierte GUID
  });

  // Test 2 (Brief), zweiter Einstieg: derselbe Adopt-Zweig über applyLocalContent
  // (Sweep-/modify-Pfad). Der anschließende lokale Diff darf den adoptierten
  // Fremd-Inhalt nicht wieder herausdiffen.
  it('Adopt-Zweig (applyLocalContent): lokaler Diff löscht den adoptierten Fremd-Inhalt nicht', async () => {
    const vault = makeVaultMock() as any;
    const foreignText = 'Zeile 1\nFremd F\n';
    const mdText = 'Zeile 1\nLokal L\n';

    writeSidecar(vault, FOREIGN_YJS, G_SMALL, foreignText);
    vault._textFiles.set(NOTE, mdText);

    const crdt = new CrdtManager();
    const handler = new SyncHandler(vault, crdt, '10ca1000');
    await handler.applyLocalContent(NOTE, mdText);

    expect(crdt.getContent(NOTE)).toContain('Fremd F');
    expect(crdt.getContent(NOTE)).toContain('Lokal L');
    expect(await handler.currentGuid(NOTE)).toBe(G_SMALL);
  });
});

describe('Task 13/C: Phantom-Sidecar-Guard', () => {
  // Test 5 (Brief): Fremd-Sidecar ohne zugehörige .md.
  it('Fremd-Sidecar ohne .md erzeugt weder eigenen State noch Doc noch Sidecar-Datei', async () => {
    const vault = makeVaultMock() as any;
    writeSidecar(vault, FOREIGN_YJS, G_SMALL, 'Zeile 1\nFremd F\n');
    // KEINE .md — sie ist per Datei-Sync noch nicht angekommen.

    const crdt = new CrdtManager();
    const handler = new SyncHandler(vault, crdt, '10ca1000');
    const merged = await handler.loadAndMerge(NOTE);

    expect(merged).toBeNull();
    expect(vault._files.has(OWN_YJS)).toBe(false); // keine eigene Sidecar
    expect(crdt.hasDoc(NOTE)).toBe(false); // kein Doc
    expect(await handler.currentGuid(NOTE)).toBeNull(); // keine geprägte GUID
    expect(vault._files.has(FOREIGN_YJS)).toBe(true); // Fremd-Datei bleibt liegen
  });

  it('nach Ankunft der .md wird sauber adoptiert (Fremd-GUID, kein Tie-Break)', async () => {
    const vault = makeVaultMock() as any;
    const foreignText = 'Zeile 1\nFremd F\n';
    writeSidecar(vault, FOREIGN_YJS, G_SMALL, foreignText);

    const handler = new SyncHandler(vault, new CrdtManager(), '10ca1000');
    await handler.loadAndMerge(NOTE);

    // Jetzt kommt die .md nach.
    vault._textFiles.set(NOTE, foreignText);
    const merged = await handler.loadAndMerge(NOTE);

    expect(merged).toBe(foreignText);
    expect(await handler.currentGuid(NOTE)).toBe(G_SMALL);
    const saved = decodeStateFile(new Uint8Array(vault._files.get(OWN_YJS)!));
    expect(saved.guid).toBe(G_SMALL);
  });
});
