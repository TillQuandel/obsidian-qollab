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
    // Review I-1: Die FREMDE Sidecar unter pfad2 ist die Fix-A-Sonde. Der
    // Fix-B-Guard schuetzt ausschliesslich stateFilePath(pfad2) — auf eine fremde
    // Datei wirkt er nicht. Faellt Fix A weg (GUID-globaler Schluessel), trifft der
    // Tombstone von pfad1 auch hier und loescht sie.
    const FOREIGN_SIDECAR_PFAD2 = `.qollab/${PFAD2}.${A_ID}.yjs`;

    // Beide Pfade tragen GUID G (Adopt-Szenario: gleiche Inkarnation, zwei Pfade).
    vault._files.set(
      `.qollab/${PFAD1}.${OWN_ID}.yjs`,
      buildSidecar(G, 'pfad1-inhalt', PFAD1)
    );
    vault._files.set(OWN_SIDECAR_PFAD2, buildSidecar(G, 'pfad2-inhalt', PFAD2));
    vault._files.set(FOREIGN_SIDECAR_PFAD2, buildSidecar(G, 'fremd-pfad2', PFAD2));
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

    // Fix-A-Sonde: pfad-spezifischer Tombstone (pfad1) greift nicht auf pfad2,
    // die fremde Sidecar bleibt liegen. Ohne Fix A wird sie geloescht.
    expect(vault._files.has(FOREIGN_SIDECAR_PFAD2)).toBe(true);
    // Fix-B-Sonde: die eigene Sidecar wird ueber den Tombstone-Zweig nie geloescht.
    expect(removedPfad2Own).toBe(false);
  });
});

// --------------------------------------------------------------------------
// Test 6 (Review C-1): rename VOR dem delete — der Tombstone muss die ganze
// Pfad-Historie der Inkarnation decken, nicht nur den zuletzt bewohnten Pfad.
//
// Szenario (nur Standard-Handler, Standard-Betriebsmodus Datei-Sync):
//   1. alt.md lebt mit Inkarnation G, eigene Sidecar vorhanden.
//   2. Nutzer benennt um: alt.md → neu.md (Sidecars ziehen mit, KEIN Tombstone).
//   3. Nutzer loescht neu.md → Tombstone.
//   4. Geraet A war offline und liefert verspaetet .qollab/alt.md.<A>.yjs (GUID G).
//   5. Nutzer legt eine neue, inhaltlich unbeteiligte Note alt.md an.
//
// RED (vor C-1-Fix): Tombstone steht nur auf (neu.md, G). Unter alt.md findet
//   decodeSiblings keinen Tombstone → ensureDoc adoptiert die Fremd-Inkarnation
//   und unionMerge schiebt den Inhalt der GELOESCHTEN Note in die neue alt.md.
//   Das ist eine Regression gegen master (dort griff der GUID-globale Tombstone).
//
// GREEN (nach C-1-Fix): der delete-Handler tombstont alle Pfade, unter denen die
//   Inkarnation auf DIESEM Geraet gelebt hat → (neu.md, G) UND (alt.md, G).
// --------------------------------------------------------------------------
describe('Test 6 - C-1: rename dann delete, Fremd-Sidecar unter dem ALTEN Pfad', () => {
  it('die neue, unbeteiligte alt.md bleibt unkontaminiert und die Leiche wird geraeumt', async () => {
    const vault = makeVaultMock();
    const { plugin, handlers } = await bootPlugin(vault);
    const OWN_ID: string = plugin.clientId;

    const GEHEIM = 'GEHEIM alter inhalt\n';
    const NEUTRAL = 'brandneu und unbeteiligt\n';
    const A_SIDECAR_ALT = `.qollab/alt.md.${A_ID}.yjs`;

    // 1. alt.md lebt mit Inkarnation G.
    vault._files.set(`.qollab/alt.md.${OWN_ID}.yjs`, buildSidecar(G, GEHEIM, 'alt.md'));
    vault._textFiles.set('alt.md', GEHEIM);

    // 2. Rename alt.md → neu.md.
    vault._textFiles.delete('alt.md');
    vault._textFiles.set('neu.md', GEHEIM);
    await handlers.get('rename')!(tfile('neu.md'), 'alt.md');

    // 3. Delete neu.md.
    vault._textFiles.delete('neu.md');
    await handlers.get('delete')!(tfile('neu.md'));

    // 4. Verspaetete Fremd-Sidecar von Geraet A unter dem ALTEN Pfad, GUID G.
    vault._files.set(A_SIDECAR_ALT, buildSidecar(G, GEHEIM, 'alt.md'));

    // 5. Neue, inhaltlich unbeteiligte Note unter dem alten Namen.
    vault._textFiles.set('alt.md', NEUTRAL);

    await plugin.onRemoteYjsUpdate('alt.md');

    expect(vault._textFiles.get('alt.md')).toBe(NEUTRAL);
    expect(vault._files.has(A_SIDECAR_ALT)).toBe(false);
  });
});

// --------------------------------------------------------------------------
// Test 7 (Review C-1, Gegenprobe): Der C-1-Fix darf Fix A nicht zuruecknehmen.
//
// Zweitgeraet-Sicht auf denselben Rename: B hat NIE einen Rename gesehen, der
// Datei-Sync stellt ihn als delete(alt.md) + create(neu.md) zu. Die Pfad-Historie
// dieser Inkarnation ist auf B also LEER — der Tombstone darf ausschliesslich auf
// alt.md landen, sonst entwertet er neu.md fuer eine LEBENDE Inkarnation und
// reisst genau die Luecke wieder auf, die Fix A geschlossen hat.
// --------------------------------------------------------------------------
describe('Test 7 - C-1-Grenze: ohne lokalen Rename bleibt der Tombstone auf dem geloeschten Pfad', () => {
  it('delete(alt.md) tombstont NUR alt.md; Fremd-Sidecar unter neu.md ueberlebt', async () => {
    const vault = makeVaultMock();
    const { plugin, handlers } = await bootPlugin(vault);
    const OWN_ID: string = plugin.clientId;

    // B kennt alt.md mit GUID G (eigene Sidecar) und hat neu.md nie umbenannt.
    vault._files.set(`.qollab/alt.md.${OWN_ID}.yjs`, buildSidecar(G, 'alt-inhalt', 'alt.md'));
    vault._textFiles.set('alt.md', 'alt-inhalt');

    // Sync-zugestelltes delete(alt.md).
    await handlers.get('delete')!(tfile('alt.md'));

    const keys = Object.keys(plugin.settings.tombstones);
    expect(keys).toContain(`alt.md\0${G}`);
    expect(keys).not.toContain(`neu.md\0${G}`);
    expect(keys).toHaveLength(1);

    // Die Inkarnation laeuft unter neu.md weiter: Geraet-A-Sidecar bleibt.
    const A_SIDECAR_NEU = `.qollab/neu.md.${A_ID}.yjs`;
    vault._textFiles.set('neu.md', 'alt-inhalt');
    vault._files.set(A_SIDECAR_NEU, buildSidecar(G, 'a-inhalt', 'neu.md'));

    await plugin.onRemoteYjsUpdate('neu.md');

    expect(vault._files.has(A_SIDECAR_NEU)).toBe(true);
  });
});
