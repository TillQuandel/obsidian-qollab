// R3-F4: Selektiver Sync (Dropbox „Selective Sync", OneDrive „Ordner auswählen")
// entfernt einen abgewählten Ordner VON DER PLATTE — die Auswahl gilt pro Gerät,
// die Notizen leben auf dem anderen Gerät unverändert weiter. Für jede so
// verschwundene `.md` feuert Obsidians `delete`-Handler.
//
// `.qollab/` ist ein eigener Top-Level-Baum und in der Ordnerauswahl gar nicht
// sichtbar; die Hilfsdateien bleiben also liegen. Der delete-Handler löschte sie
// trotzdem — ALLE, auch die des anderen Geräts — und der Datei-Sync trug diese
// Löschung zurück. Dazu setzte er einen Tombstone auf eine lebende Inkarnation.
//
// Unterscheidungskriterium (siehe main.ts, delete-Handler): Ist der ORDNER der
// Note mit verschwunden, war es kein auf diese Note gerichteter Löschbefehl.
// Test 2 hält die Gegenrichtung fest: bleibt der Ordner stehen, gilt unverändert
// die Task-15/F-1-Semantik (Tombstone auch auf Fremd-GUIDs, Aufräumen aller
// Hilfsdateien).

import { TFile } from 'obsidian';
import CrdtSyncPlugin from '../src/main';
import { CrdtManager } from '../src/crdt-manager';
import { encodeStateFile } from '../src/state-file';
import { makeVaultMock, makeLocalStorage, VaultMock } from './helpers/vault-mock';

const G = 'ee'.repeat(16);
const A_ID = 'deadbeef'; // fremdes Gerät A
const ORDNER = 'Projekte';
const NOTE = `${ORDNER}/note.md`;
const TEXT = 'inhalt der note\n';

function buildSidecar(guid: string, text: string, docKey: string): ArrayBuffer {
  const mgr = new CrdtManager();
  mgr.setContent(docKey, text);
  const buf = encodeStateFile(guid, mgr.encodeState(docKey));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

function tfile(path: string): TFile {
  const f = new TFile();
  f.path = path;
  f.name = path.split('/').pop() ?? path;
  f.stat = { mtime: 0, ctime: 0, size: 0 };
  return f;
}

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
    workspace: { on: () => ({}), offref: () => {}, onLayoutReady: () => {} },
    loadLocalStorage: storage.loadLocalStorage,
    saveLocalStorage: storage.saveLocalStorage,
  };
  const plugin = new (CrdtSyncPlugin as any)(app, {});
  await plugin.onload();
  return { plugin: plugin as any, handlers };
}

// --------------------------------------------------------------------------
// Test 1: Der abgewählte Ordner verschwindet — die Hilfsdateien müssen bleiben.
//
// RED (vor Fix): der Handler löscht eigene UND fremde .yjs (der Sync trägt das
//   zum Peer: dessen Historie ist weg) und tombstont (NOTE, G) — die lebende
//   Inkarnation des anderen Geräts.
// GREEN: Ordner weg → kein Tombstone, keine Löschung.
// --------------------------------------------------------------------------
describe('R3-F4 - selektiver Sync entfernt den Ordner', () => {
  async function setup() {
    const vault = makeVaultMock();
    const { plugin, handlers } = await bootPlugin(vault);
    const OWN_ID: string = plugin.clientId;
    const OWN_SIDECAR = `.qollab/${NOTE}.${OWN_ID}.yjs`;
    const A_SIDECAR = `.qollab/${NOTE}.${A_ID}.yjs`;

    vault._textFiles.set(NOTE, TEXT);
    vault._files.set(OWN_SIDECAR, buildSidecar(G, TEXT, NOTE));
    vault._files.set(A_SIDECAR, buildSidecar(G, TEXT, NOTE));

    // Vorbedingung: der Ordner existiert, solange die Note darin liegt.
    expect(await vault.adapter.exists(ORDNER)).toBe(true);

    // Selective Sync: der Ordner wird samt Inhalt von der Platte genommen.
    // `.qollab/` bleibt unangetastet (eigener Top-Level-Baum).
    vault._textFiles.delete(NOTE);
    expect(await vault.adapter.exists(ORDNER)).toBe(false);

    await handlers.get('delete')!(tfile(NOTE));
    return { vault, plugin, OWN_SIDECAR, A_SIDECAR };
  }

  it('die Hilfsdatei des anderen Geräts überlebt (der Sync trüge die Löschung dorthin zurück)', async () => {
    const { vault, A_SIDECAR } = await setup();
    expect(vault._files.has(A_SIDECAR)).toBe(true);
  });

  it('die eigene Hilfsdatei überlebt', async () => {
    const { vault, OWN_SIDECAR } = await setup();
    expect(vault._files.has(OWN_SIDECAR)).toBe(true);
  });

  it('es wird kein Tombstone auf die lebende Inkarnation gesetzt', async () => {
    const { plugin } = await setup();
    expect(plugin.settings.tombstones).toEqual({});
  });

  it('nach dem Wiedereinschalten des Ordners läuft dieselbe Inkarnation weiter', async () => {
    const { vault, plugin } = await setup();
    // Nutzer wählt den Ordner wieder an: der Sync legt die .md zurück.
    vault._textFiles.set(NOTE, TEXT);
    expect(await plugin.syncHandler.currentGuid(NOTE)).toBe(G);
  });
});

// --------------------------------------------------------------------------
// Test 2 (Gegenprobe): Bleibt der Ordner stehen, ändert sich NICHTS an der
// Task-15/F-1-Semantik. Die Note ist nur über eine FREMDE Hilfsdatei bekannt
// (per Sync angekommen, hier nie geöffnet) — genau der Fall, für den der
// Fremd-GUID-Fallback in `guidsToTombstone` gebaut wurde.
//
// Dieser Test ist OHNE den Fix grün und fällt bei jeder zu breiten Fassung des
// Kriteriums (z.B. „keine .md mehr im Ordner", „Hilfsdateien liegen noch da",
// invertierte Prüfung).
// --------------------------------------------------------------------------
describe('R3-F4 - Gegenprobe: der Ordner bleibt stehen', () => {
  it('einzeln gelöschte Note wird weiterhin getombstont und aufgeräumt', async () => {
    const vault = makeVaultMock();
    const { plugin, handlers } = await bootPlugin(vault);
    const A_SIDECAR = `.qollab/${NOTE}.${A_ID}.yjs`;

    // Eine zweite Note hält den Ordner am Leben.
    vault._textFiles.set(`${ORDNER}/andere.md`, 'bleibt liegen\n');
    vault._textFiles.set(NOTE, TEXT);
    // Nur die FREMDE Hilfsdatei — keine eigene, kein guids-Eintrag (F-1-Fall).
    vault._files.set(A_SIDECAR, buildSidecar(G, TEXT, NOTE));

    // Nutzer löscht genau diese eine Note.
    vault._textFiles.delete(NOTE);
    expect(await vault.adapter.exists(ORDNER)).toBe(true);

    await handlers.get('delete')!(tfile(NOTE));

    expect(Object.keys(plugin.settings.tombstones)).toEqual([`${NOTE}\0${G}`]);
    expect(vault._files.has(A_SIDECAR)).toBe(false);
  });
});

// --------------------------------------------------------------------------
// Test 3 (Wächter, vor und nach dem Fix grün): Ist der Ordner-Zustand wegen
// eines IO-Fehlers unbekannt, gilt dieselbe Regel wie überall sonst in diesem
// Pfad (`guidsToTombstone` → `null`): die nicht-destruktive Seite. Der Wert
// steht in der Mutationsprobe — lässt man den Fehler durch, reißt er den ganzen
// delete-Handler auf; wertet man ihn als „Ordner da", ist es wieder R3-F4.
// --------------------------------------------------------------------------
describe('R3-F4 - Wächter: unbekannter Ordner-Zustand', () => {
  it('ein Lesefehler auf dem Ordner löscht und tombstont nichts', async () => {
    const vault = makeVaultMock();
    const { plugin, handlers } = await bootPlugin(vault);
    const A_SIDECAR = `.qollab/${NOTE}.${A_ID}.yjs`;

    vault._textFiles.set(`${ORDNER}/andere.md`, 'bleibt liegen\n');
    vault._textFiles.set(NOTE, TEXT);
    vault._files.set(A_SIDECAR, buildSidecar(G, TEXT, NOTE));

    const origStat = vault.adapter.stat;
    vault.adapter.stat = async (p: string) => {
      if (p === ORDNER) throw new Error('EBUSY: resource busy or locked');
      return origStat(p);
    };

    vault._textFiles.delete(NOTE);
    await handlers.get('delete')!(tfile(NOTE));

    expect(plugin.settings.tombstones).toEqual({});
    expect(vault._files.has(A_SIDECAR)).toBe(true);
  });
});
