// Tombstone-Scope-Tests (Task 15)
//
// Verifiziert, dass Tombstones nach Fix A/B per (notePath, guid)-Paar gelten statt
// GUID-global. Zwei Befunde aus audit-2026-07-27.json:
//
//   Befund 1/2: Sync-vermittelter Rename: delete(alt.md) setzt Tombstone auf G,
//               danach trifft Gerät-A-Sidecar fuer neu.md (GUID G) ein. Heute wird
//               sie geloescht (GUID-globaler Tombstone). Nach Fix: bleibt erhalten.
//
//   Befund 5:   Dieselbe GUID G an zwei Pfaden: pfad1 wird getombstont, eigene
//               Sidecar von pfad2 (GUID G) wird faelschlich geloescht. Nach Fix: bleibt.
//
// Jeder Test laeuft auf Plugin-Ebene, damit die ECHTE tombstoneStore-Implementierung
// (main.ts) verwendet wird — das ist der Schluessel zum RED/GREEN-Verhalten:
//   VOR Fix A/B: tombstoneStore.add(G) schreibt {G: timestamp} (global).
//                decodeSiblings prueft has(G) → findet G → Sidecar geloescht → RED.
//   NACH Fix A/B: tombstoneStore.add(G, path) schreibt {'path\0G': timestamp}.
//                decodeSiblings prueft has(G, otherPath) → kein Treffer → GREEN.

import { TFile } from 'obsidian';
import CrdtSyncPlugin from '../src/main';
import { CrdtManager } from '../src/crdt-manager';
import { encodeStateFile } from '../src/state-file';
import { makeVaultMock, makeLocalStorage, VaultMock } from './helpers/vault-mock';

// Bekannte GUID fuer alle Tests (reproduzierbar).
const G = 'ee'.repeat(16);
const A_ID = 'deadbeef'; // Fremdes Geraet A

// Hilfsfunktion: Sidecar-ArrayBuffer mit GUID und beliebigem Text.
function buildSidecar(guid: string, text: string, docKey = 'note.md'): ArrayBuffer {
  const mgr = new CrdtManager();
  mgr.setContent(docKey, text);
  const state = mgr.encodeState(docKey);
  const buf = encodeStateFile(guid, state);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

function tfile(path: string): TFile {
  const f = new TFile();
  f.path = path;
  f.name = path.split('/').pop() ?? path;
  f.stat = { mtime: 0, ctime: 0, size: 0 };
  return f;
}

// Minimaler Plugin-Bootstrep — analog zu main-handlers.test.ts loadPlugin,
// ohne onLayoutReady (kein automatischer Sweep).
async function bootPlugin(vault: VaultMock) {
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

// --------------------------------------------------------------------------
// Test 1: Sync-Rename-Critical (Befund 1+2)
//
// Szenario: Geraet B hat alt.md und neu.md. Sync liefert delete(alt.md) →
// Tombstone auf G. Danach trifft Geraet-A-Sidecar fuer neu.md (GUID G) ein.
//
// RED (vor Fix A/B): tombstoneStore.add(G) → {G: timestamp} (global).
//   decodeSiblings fuer neu.md: has(G) → true → Geraet-A-Sidecar wird geloescht.
//   Assertion SCHEITERT.
//
// GREEN (nach Fix A/B): tombstoneStore.add(G, 'alt.md') → {'alt.md\0G': timestamp}.
//   decodeSiblings fuer neu.md: has(G, 'neu.md') → 'neu.md\0G' nicht gefunden → false
//   → Geraet-A-Sidecar bleibt. Assertion BESTEHT.
// --------------------------------------------------------------------------
describe('Test 1 - Sync-Rename: Geraet-A-Sidecar unter neu.md ueberlebt delete(alt.md)', () => {
  it('Geraet-A-Sidecar bleibt nach Tombstone auf alt.md und loadAndMerge(neu.md) erhalten', async () => {
    const vault = makeVaultMock();
    const { plugin, handlers } = await bootPlugin(vault);
    const OWN_ID: string = plugin.clientId;

    // alt.md existiert mit GUID G (eigene Sidecar, damit currentGuid G liefert).
    vault._files.set(`.qollab/alt.md.${OWN_ID}.yjs`, buildSidecar(G, 'alt-inhalt', 'alt.md'));
    vault._textFiles.set('alt.md', 'alt-inhalt');

    // neu.md existiert (nach Rename).
    vault._textFiles.set('neu.md', 'alt-inhalt');

    // Geraet-A-Sidecar fuer neu.md mit GUID G (Inkarnation laeuft auf neu.md weiter).
    const A_SIDECAR = `.qollab/neu.md.${A_ID}.yjs`;
    vault._files.set(A_SIDECAR, buildSidecar(G, 'a-inhalt', 'neu.md'));

    // Sync-zugestelltes delete(alt.md): Tombstone auf G wird gesetzt.
    await handlers.get('delete')!(tfile('alt.md'));

    // Geraet-A-Sidecar fuer neu.md darf NICHT durch den Tombstone geloescht werden.
    await plugin.onRemoteYjsUpdate('neu.md');

    expect(vault._files.has(A_SIDECAR)).toBe(true);
  });
});

// --------------------------------------------------------------------------
// Test 2: Eigene Sidecar ueberlebt (Befund 5)
//
// Szenario: Geraet B hat pfad1.md und pfad2.md, beide mit GUID G (Adopt-Szenario).
// pfad1.md wird geloescht → Tombstone auf G. loadAndMerge(pfad2.md) darf die
// eigene Sidecar von pfad2 NICHT loeschen.
//
// Technischer Hinweis: saveState re-erstellt die Datei nach der unerwuenschten
// Loeschung durch decodeSiblings. Daher pruefen wir nicht nur File-Existenz
// am Ende, sondern ob adapter.remove() auf die eigene Sidecar aufgerufen wurde.
//
// RED (vor Fix A/B): tombstoneStore.add(G) → {G: timestamp} (global).
//   decodeSiblings fuer pfad2: has(G) → true → removeSidecar() auf eigene Sidecar.
//   Spy faengt den Remove-Aufruf → removedPfad2Own = true → Assertion SCHEITERT.
//
// GREEN (nach Fix A/B): tombstoneStore.add(G, 'pfad1.md') → {'pfad1.md\0G': ...}.
//   decodeSiblings fuer pfad2: has(G, 'pfad2.md') → 'pfad2.md\0G' nicht gefunden → false
//   → kein removeSidecar auf eigene Sidecar → removedPfad2Own = false → Assertion BESTEHT.
// --------------------------------------------------------------------------
describe('Test 2 - Eigene Sidecar ueberlebt: Tombstone auf pfad1 greift nicht auf pfad2', () => {
  it('eigene .yjs von pfad2.md wird nicht von decodeSiblings geloescht (remove-Spy)', async () => {
    const vault = makeVaultMock();
    const { plugin, handlers } = await bootPlugin(vault);
    const OWN_ID: string = plugin.clientId;

    const PFAD1 = 'pfad1.md';
    const PFAD2 = 'pfad2.md';
    const OWN_SIDECAR_PFAD2 = `.qollab/${PFAD2}.${OWN_ID}.yjs`;

    // Beide Pfade tragen GUID G (Adopt-Szenario: gleiche Inkarnation, zwei Pfade).
    vault._files.set(
      `.qollab/${PFAD1}.${OWN_ID}.yjs`,
      buildSidecar(G, 'pfad1-inhalt', PFAD1)
    );
    vault._files.set(OWN_SIDECAR_PFAD2, buildSidecar(G, 'pfad2-inhalt', PFAD2));
    vault._textFiles.set(PFAD1, 'pfad1-inhalt');
    vault._textFiles.set(PFAD2, 'pfad2-inhalt');

    // Delete pfad1 → Tombstone auf G (global vor Fix, pfad-spezifisch nach Fix).
    await handlers.get('delete')!(tfile(PFAD1));

    // Remove-Spy: prueft ob eigene Sidecar von pfad2 durch decodeSiblings geloescht wird.
    // (saveState re-erstellt die Datei danach — Datei-Existenz am Ende ist kein Beleg.)
    let removedPfad2Own = false;
    const origRemove = vault.adapter.remove;
    vault.adapter.remove = async (path: string) => {
      if (path === OWN_SIDECAR_PFAD2) removedPfad2Own = true;
      return origRemove(path);
    };

    // loadAndMerge fuer pfad2 darf eigene Sidecar NICHT via Tombstone loeschen.
    await plugin.onRemoteYjsUpdate(PFAD2);

    // Vor Fix A/B: GUID-global-Tombstone fires → removeSidecar auf eigene Sidecar von pfad2.
    // Nach Fix A/B: pfad-spezifischer Tombstone fuer pfad1 greift nicht auf pfad2 → kein Remove.
    expect(removedPfad2Own).toBe(false);
  });
});
